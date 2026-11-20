'use strict';
/**
 * Lagerfeuer Spiele-SDK – Server-Teil.
 * Wird vom Launcher an jeden Spielserver übergeben (createServer({ sdk, … })).
 *
 * Übernimmt alles, was jedes Mehrspieler-Spiel braucht:
 *  - WebSocket-Server, Beitritt mit Passwort- und Versionsprüfung, Spielerliste, Farben
 *  - feste Tickrate mit Zustands-Broadcast, Ping, Chat (mit Abfang-Hook für Ratespiele)
 *  - Bots als normale Spieler (bot: true)
 *
 * Ein Spiel implementiert nur noch (alles optional außer tick):
 *   init(opts)            – einmalig, opts = { bots, botDifficulty, … }
 *   welcome(player)       – Zusatzdaten für die Begrüßung
 *   onJoin(player), onLeave(player)
 *   onMessage(player, msg)
 *   onChat(player, text)  – true zurückgeben = Nachricht nicht an alle senden
 *   tick(dt, time)
 *   state(player?)        – Zustand, der jeden Tick an alle (bzw. pro Spieler) geht
 *   statePerPlayer        – true, wenn state(player) je Spieler unterschiedlich ist
 */
const crypto = require('node:crypto');

const COLORS = ['#e85934', '#5b8def', '#f2c14e', '#3fbf7f', '#b467d6', '#3fd0c9', '#ef7aa8', '#9acd32', '#ff9f43', '#7f8cff', '#d4a373', '#e2e2e2', '#ff6b6b', '#4ecdc4', '#ffe66d', '#a29bfe'];
const BOT_NAMES = ['Gänseblümchen', 'Löwenzahn', 'Klatschmohn', 'Kornblume', 'Butterblume', 'Rotklee', 'Wiesensalbei', 'Margerite', 'Schafgarbe', 'Glockenblume', 'Vergissmeinnicht', 'Hahnenfuß', 'Sauerampfer', 'Wegwarte', 'Akelei'];

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

class Room {
  constructor(opts, game, cfg) {
    this.opts = opts;
    this.game = game;
    this.cfg = { tickRate: 20, version: 1, maxPlayers: 16, ...cfg };
    this.players = new Map();
    this.nextId = 1;
    this.time = 0;
    this.log = opts.log || (() => {});
    game.room = this;
  }

  get list() { return [...this.players.values()]; }
  humans() { return this.list.filter((p) => !p.bot); }

  addPlayer(name, bot = false) {
    const id = this.nextId++;
    const usedColors = new Set(this.list.map((p) => p.color));
    const color = COLORS.find((c) => !usedColors.has(c)) || COLORS[id % COLORS.length];
    const p = { id, name: String(name).slice(0, 20) || 'Spieler', color, bot, ws: null, score: 0 };
    this.players.set(id, p);
    return p;
  }

  /** Bot hinzufügen (Spiel bekommt onJoin wie bei Menschen). */
  addBot(name) {
    const used = new Set(this.list.map((p) => p.name));
    const base = name || BOT_NAMES.find((n) => !used.has(`${n} [Bot]`)) || 'Bot';
    const p = this.addPlayer(name || `${base} [Bot]`, true);
    this.broadcast({ t: 'pjoin', p: this.info(p) });
    this.game.onJoin?.(p);
    return p;
  }

  removePlayer(p) {
    if (!this.players.has(p.id)) return;
    this.game.onLeave?.(p);
    this.players.delete(p.id);
    this.broadcast({ t: 'pleave', id: p.id });
    if (!p.bot) this.broadcast({ t: 'msg', text: `${p.name} hat das Spiel verlassen.` });
  }

  info(p) { return { id: p.id, name: p.name, color: p.color, bot: p.bot, score: p.score }; }

  onConnection(ws, req) {
    let player = null;
    const timeout = setTimeout(() => ws.close(4000, 'join timeout'), 6000);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (!player) {
        if (msg.t !== 'join') return;
        clearTimeout(timeout);
        player = this.join(ws, msg, req.socket.remoteAddress);
        return;
      }
      if (msg.t === 'ping') { this.send(player, { t: 'pong', c: msg.c }); player.ping = Math.round(msg.rtt || 0); return; }
      if (msg.t === 'chat') return this.chat(player, msg.text);
      try { this.game.onMessage?.(player, msg); } catch (e) { this.log(`Fehler in onMessage: ${e.stack}`); }
    });
    ws.on('close', () => { clearTimeout(timeout); if (player) this.removePlayer(player); });
    ws.on('error', () => {});
  }

  join(ws, msg, addr) {
    const reject = (text) => { ws.send(JSON.stringify({ t: 'error', text })); ws.close(4001, 'rejected'); return null; };
    if (msg.version !== this.cfg.version) return reject('Spielversion passt nicht zum Host (bitte alle denselben Launcher verwenden).');
    if (this.opts.password && !safeEqual(msg.password, this.opts.password)) return reject('Falsches Passwort.');
    if (this.humans().length >= this.cfg.maxPlayers) return reject('Der Server ist voll.');
    if (this.players.size >= this.cfg.maxPlayers) { const bot = this.list.find((p) => p.bot); if (bot) this.removePlayer(bot); }
    const p = this.addPlayer(msg.name || 'Spieler', false);
    p.ws = ws;
    this.log(`${p.name} verbunden (${addr})`);
    this.send(p, { t: 'welcome', id: p.id, players: this.list.map((x) => this.info(x)), ...(this.game.welcome?.(p) || {}) });
    this.broadcast({ t: 'pjoin', p: this.info(p) }, p);
    this.broadcast({ t: 'msg', text: `${p.name} ist beigetreten.` }, p);
    this.game.onJoin?.(p);
    return p;
  }

  chat(p, raw) {
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!text || this.time - (p.chatAt ?? -10) < 0.3) return;
    p.chatAt = this.time;
    if (this.game.onChat?.(p, text) === true) return;
    this.broadcast({ t: 'chat', id: p.id, name: p.name, color: p.color, text });
  }

  tick(dt) {
    this.time += dt;
    try { this.game.tick(dt, this.time); } catch (e) { this.log(`Fehler im Tick: ${e.stack}`); }
    if (!this.game.state) return;
    if (this.game.statePerPlayer) for (const p of this.humans()) this.send(p, { t: 's', time: this.time, ...this.game.state(p) });
    else this.broadcast({ t: 's', time: Math.round(this.time * 1000) / 1000, ...this.game.state() });
  }

  /** Punktestand an alle (für Scoreboard). */
  sendScores() {
    this.broadcast({ t: 'scores', s: this.list.map((p) => [p.id, p.score, p.ping || 0]) });
  }

  send(p, obj) { if (p && p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(obj)); }
  broadcast(obj, except) {
    const data = JSON.stringify(obj);
    for (const p of this.players.values()) if (p !== except && p.ws && p.ws.readyState === 1) p.ws.send(data);
  }
}

/**
 * Startet einen Raum für ein Spiel.
 * @returns {Promise<{port:number, room:Room, stop:()=>Promise<void>}>}
 */
async function createRoom(opts, game, cfg = {}) {
  const room = new Room(opts, game, cfg);
  game.init?.(opts);
  const wss = new opts.WebSocketServer({ port: opts.port, host: opts.host, maxPayload: 64 * 1024 });
  await new Promise((resolve, reject) => { wss.once('listening', resolve); wss.once('error', reject); });
  wss.on('connection', (ws, req) => room.onConnection(ws, req));
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    room.tick(dt);
  }, 1000 / room.cfg.tickRate);
  const scoreTimer = setInterval(() => room.sendScores(), 1000);
  room.log(`Läuft auf ${opts.host}:${wss.address().port}`);
  return {
    port: wss.address().port,
    room,
    game,
    stop: () => new Promise((resolve) => {
      clearInterval(timer);
      clearInterval(scoreTimer);
      room.broadcast({ t: 'msg', text: 'Der Host hat das Spiel beendet.', end: true });
      for (const c of wss.clients) c.close(1001, 'server stop');
      wss.close(() => resolve());
    }),
  };
}

/** Kleine Helfer für Spiele. */
const util = {
  rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
  angleDiff: (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI,
  r2: (v) => Math.round(v * 100) / 100,
  r1: (v) => Math.round(v * 10) / 10,
};

module.exports = { createRoom, Room, util, COLORS, BOT_NAMES };
