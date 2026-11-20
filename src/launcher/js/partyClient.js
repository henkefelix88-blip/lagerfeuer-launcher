/**
 * Party-Client: Verbindung des Launchers zur Party-Lobby (auch der Host verbindet sich so mit seinem
 * eigenen Party-Server – dadurch gibt es nur EINEN Codepfad für alle Mitglieder).
 *
 * Events (EventTarget, detail = Nachricht): welcome, state, notice, error, closed, launch, hostRequest, disconnected
 */
export const PARTY_PROTOCOL = 1;

export class PartyClient extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.myId = null;
    this.state = null;
    this.address = null;
    this.port = null;
    this.isHost = false;
  }

  get connected() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN && this.myId != null;
  }

  /** Verbindet und wartet auf "welcome" bzw. Fehler. */
  connect({ address, port, name, password, hostToken }) {
    this.disconnect(true);
    this.address = address;
    this.port = port;
    this.isHost = !!hostToken;
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (msg) => {
        if (settled) return;
        settled = true;
        reject(new Error(msg));
      };
      const timer = setTimeout(() => {
        fail('Zeitüberschreitung – Host nicht erreichbar (Firewall/Portfreigabe prüfen).');
        this.disconnect(true);
      }, 7000);
      let ws;
      try {
        ws = new WebSocket(`ws://${address.includes(':') ? `[${address}]` : address}:${port}`);
      } catch (e) {
        clearTimeout(timer);
        return fail(e.message);
      }
      this.ws = ws;
      ws.onopen = () => this.send({ t: 'hello', name, password, hostToken, protocol: PARTY_PROTOCOL });
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'welcome') {
          this.myId = msg.id;
          clearTimeout(timer);
          if (!settled) { settled = true; resolve(msg); }
        } else if (msg.t === 'error' && !settled) {
          clearTimeout(timer);
          fail(msg.msg);
          return;
        } else if (msg.t === 'state') {
          this.state = msg.party;
        }
        this.dispatchEvent(new CustomEvent(msg.t, { detail: msg }));
      };
      ws.onerror = () => {};
      ws.onclose = () => {
        clearTimeout(timer);
        if (!settled) fail('Verbindung zur Party fehlgeschlagen (Code/Adresse, Firewall und Portfreigabe prüfen).');
        if (this.ws === ws) {
          const wasConnected = this.myId != null;
          this.ws = null;
          this.myId = null;
          this.state = null;
          if (wasConnected) this.dispatchEvent(new CustomEvent('disconnected'));
        }
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  me() {
    return this.state?.members.find((m) => m.id === this.myId) || null;
  }

  disconnect(silent = false) {
    if (!this.ws) return;
    const ws = this.ws;
    this.ws = null;
    this.myId = null;
    this.state = null;
    try { ws.close(); } catch {}
    if (!silent) this.dispatchEvent(new CustomEvent('disconnected'));
  }
}
