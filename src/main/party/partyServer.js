'use strict';
/**
 * Party-Server (läuft im Launcher des Party-Hosts, gilt für alle Spiele).
 *
 * Protokoll: JSON über WebSocket. Jede Nachricht hat ein Feld `t` (Typ).
 *
 *  Client → Server
 *   hello        { name, password, hostToken?, protocol }   – Anmelden
 *   ready        { ready }                                   – Bereit-Status
 *   perf         { perf: { score, cpu, cores, ramGb, gpu } } – Ergebnis des Leistungschecks
 *   setGame      { gameId }                 (nur Host)       – Spiel für die Party wählen
 *   setGameHost  { memberId | 'auto' }      (nur Host)       – wer hostet das Spiel
 *   start        {}                         (nur Host)       – Spiel für alle starten
 *   kick         { memberId }               (nur Host)
 *   hostReady    { port }                   (Spiel-Host)     – Spielserver läuft
 *   hostFailed   { error }                  (Spiel-Host)
 *   gameEnded    {}                         (Spiel-Host)     – Spielserver wurde beendet
 *
 *  Server → Client
 *   welcome      { id, protocol }
 *   state        { party }                                   – kompletter Lobby-Zustand
 *   hostRequest  { gameId, password }                        – "Starte bitte den Spielserver"
 *   launch       { gameId, address, port, password }         – "Tritt dem Spiel bei"
 *   notice       { msg }                                     – Hinweis für die Lobby
 *   error        { msg }                                     – Fehler (z. B. falsches Passwort)
 *   closed       { reason }                                  – Party wurde aufgelöst
 */
const crypto = require('node:crypto');

const PROTOCOL = 1;
const MAX_MEMBERS = 16;
const HOST_TIMEOUT_MS = 20000;

/** Zeitkonstanter Passwortvergleich. */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function cleanAddress(addr) {
  if (!addr) return '';
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr;
}

class PartyServer {
  /**
   * @param {object} opts
   * @param {typeof import('ws').WebSocketServer} opts.WebSocketServer
   * @param {number} opts.port
   * @param {string} opts.password  leer = kein Passwort
   * @param {string} [opts.gameId]  vorausgewähltes Spiel
   * @param {(msg:string)=>void} [opts.log]
   */
  constructor({ WebSocketServer, port, password = '', gameId = null, log = () => {} }) {
    this.password = password;
    this.hostToken = crypto.randomBytes(16).toString('hex');
    this.log = log;
    this.members = new Map(); // id -> Mitglied
    this.nextId = 1;
    this.gameId = gameId;
    this.gameHostMode = 'auto'; // 'auto' oder Mitglieds-ID
    this.inGame = false;
    this.pendingStart = null;
    this.wss = new WebSocketServer({ port, host: '0.0.0.0', maxPayload: 16 * 1024 });
    this.ready = new Promise((resolve, reject) => {
      this.wss.once('listening', resolve);
      this.wss.once('error', reject);
    });
    this.wss.on('connection', (ws, req) => this.onConnection(ws, req));
  }

  get port() {
    return this.wss.address()?.port;
  }

  onConnection(ws, req) {
    let member = null;
    const address = cleanAddress(req.socket.remoteAddress);
    const helloTimer = setTimeout(() => ws.close(4000, 'hello timeout'), 5000);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;

      if (!member) {
        if (msg.t !== 'hello') return;
        clearTimeout(helloTimer);
        member = this.handleHello(ws, msg, address);
        return;
      }
      this.handleMessage(member, msg);
    });

    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (member) this.removeMember(member, 'hat die Party verlassen');
    });
    ws.on('error', () => {});
  }

  handleHello(ws, msg, address) {
    const isHost = msg.hostToken === this.hostToken;
    if (msg.protocol !== PROTOCOL) {
      this.sendTo(ws, { t: 'error', msg: 'Launcher-Version passt nicht zur Party (bitte aktualisieren).' });
      ws.close();
      return null;
    }
    if (!isHost && this.password && !safeEqual(msg.password, this.password)) {
      this.sendTo(ws, { t: 'error', msg: 'Falsches Party-Passwort.' });
      ws.close();
      return null;
    }
    if (this.members.size >= MAX_MEMBERS) {
      this.sendTo(ws, { t: 'error', msg: 'Die Party ist voll.' });
      ws.close();
      return null;
    }
    const member = {
      id: this.nextId++,
      name: String(msg.name || 'Spieler').slice(0, 20),
      ready: isHost,
      perf: null,
      isHost,
      address,
      ws,
    };
    this.members.set(member.id, member);
    this.sendTo(ws, { t: 'welcome', id: member.id, protocol: PROTOCOL });
    this.log(`${member.name} ist beigetreten (${address})`);
    this.broadcast({ t: 'notice', msg: `${member.name} ist der Party beigetreten.` });
    this.broadcastState();
    return member;
  }

  handleMessage(m, msg) {
    switch (msg.t) {
      case 'ready':
        m.ready = !!msg.ready;
        break;
      case 'perf':
        if (msg.perf && Number.isFinite(msg.perf.score)) {
          m.perf = {
            score: Math.max(0, Math.min(100000, Math.round(msg.perf.score))),
            cpu: String(msg.perf.cpu || '').slice(0, 80),
            cores: Number(msg.perf.cores) || 0,
            ramGb: Number(msg.perf.ramGb) || 0,
            gpu: String(msg.perf.gpu || '').slice(0, 80),
          };
        }
        break;
      case 'setGame':
        if (m.isHost && typeof msg.gameId === 'string') this.gameId = msg.gameId.slice(0, 64);
        break;
      case 'setGameHost':
        if (m.isHost) this.gameHostMode = msg.memberId === 'auto' ? 'auto' : Number(msg.memberId) || 'auto';
        break;
      case 'kick': {
        const target = this.members.get(Number(msg.memberId));
        if (m.isHost && target && !target.isHost) {
          this.sendTo(target.ws, { t: 'closed', reason: 'Du wurdest aus der Party entfernt.' });
          target.ws.close();
        }
        return;
      }
      case 'start':
        if (m.isHost) this.startGame();
        return;
      case 'hostReady':
        this.onHostReady(m, Number(msg.port));
        return;
      case 'hostFailed':
        if (this.pendingStart && this.pendingStart.hostId === m.id) {
          clearTimeout(this.pendingStart.timer);
          this.pendingStart = null;
          this.broadcast({ t: 'notice', msg: `Spielserver konnte nicht starten: ${String(msg.error || '').slice(0, 120)}` });
        }
        return;
      case 'gameEnded':
        if (this.inGame && this.currentGameHostId === m.id) {
          this.inGame = false;
          this.broadcast({ t: 'notice', msg: 'Das Spiel wurde beendet – zurück in der Lobby.' });
        }
        break;
      default:
        return;
    }
    this.broadcastState();
  }

  /** Stärkster PC nach Leistungscheck (ohne Check: der Party-Host). */
  suggestedHost() {
    let best = null;
    for (const m of this.members.values()) {
      if (m.perf && (!best || m.perf.score > best.perf.score)) best = m;
    }
    return best || this.partyHost();
  }

  partyHost() {
    for (const m of this.members.values()) if (m.isHost) return m;
    return null;
  }

  effectiveGameHost() {
    if (this.gameHostMode !== 'auto') {
      const chosen = this.members.get(this.gameHostMode);
      if (chosen) return chosen;
    }
    return this.suggestedHost();
  }

  startGame() {
    if (!this.gameId) return this.broadcast({ t: 'notice', msg: 'Bitte zuerst ein Spiel auswählen.' });
    if (this.pendingStart) return;
    const host = this.effectiveGameHost();
    if (!host) return;
    const password = crypto.randomBytes(9).toString('base64url');
    const timer = setTimeout(() => {
      this.pendingStart = null;
      this.broadcast({ t: 'notice', msg: `${host.name} hat den Spielserver nicht rechtzeitig gestartet.` });
    }, HOST_TIMEOUT_MS);
    this.pendingStart = { hostId: host.id, password, gameId: this.gameId, timer };
    this.broadcast({ t: 'notice', msg: `Spiel wird auf dem PC von ${host.name} gestartet …` });
    this.sendTo(host.ws, { t: 'hostRequest', gameId: this.gameId, password });
  }

  onHostReady(m, port) {
    const p = this.pendingStart;
    if (!p || p.hostId !== m.id || !(port > 0 && port < 65536)) return;
    clearTimeout(p.timer);
    this.pendingStart = null;
    this.inGame = true;
    this.currentGameHostId = m.id;
    for (const member of this.members.values()) {
      let address;
      if (member.id === m.id) address = '127.0.0.1';
      else if (m.isHost) address = '$PARTY_HOST'; // Client nutzt dieselbe Adresse wie für die Party
      else address = m.address;
      this.sendTo(member.ws, { t: 'launch', gameId: p.gameId, address, port, password: p.password });
    }
    this.broadcastState();
  }

  removeMember(m, why) {
    if (!this.members.has(m.id)) return;
    this.members.delete(m.id);
    this.log(`${m.name} ${why}`);
    if (m.isHost) {
      this.broadcast({ t: 'closed', reason: 'Der Party-Host hat die Party aufgelöst.' });
      this.close();
      return;
    }
    if (this.gameHostMode === m.id) this.gameHostMode = 'auto';
    this.broadcast({ t: 'notice', msg: `${m.name} ${why}.` });
    this.broadcastState();
  }

  snapshot() {
    const gameHost = this.effectiveGameHost();
    const suggested = this.suggestedHost();
    return {
      gameId: this.gameId,
      gameHostMode: this.gameHostMode,
      gameHostId: gameHost ? gameHost.id : null,
      suggestedHostId: suggested ? suggested.id : null,
      inGame: this.inGame,
      hasPassword: !!this.password,
      members: [...this.members.values()].map((m) => ({
        id: m.id, name: m.name, ready: m.ready, isHost: m.isHost, perf: m.perf,
      })),
    };
  }

  broadcastState() {
    this.broadcast({ t: 'state', party: this.snapshot() });
  }

  broadcast(obj) {
    const data = JSON.stringify(obj);
    for (const m of this.members.values()) if (m.ws.readyState === 1) m.ws.send(data);
  }

  sendTo(ws, obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  close() {
    if (this.pendingStart) clearTimeout(this.pendingStart.timer);
    for (const m of this.members.values()) try { m.ws.close(); } catch {}
    this.members.clear();
    return new Promise((res) => this.wss.close(() => res()));
  }
}

module.exports = { PartyServer, PROTOCOL, safeEqual };
