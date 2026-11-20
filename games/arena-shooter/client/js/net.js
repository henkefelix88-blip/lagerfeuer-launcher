/**
 * Netzwerk-Client: WebSocket zum Host, JSON-Nachrichten, Ping-Messung.
 */
export class Net extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.rtt = 0;
    this.pingTimer = null;
  }

  connect(address, port) {
    return new Promise((resolve, reject) => {
      const host = address.includes(':') && !address.startsWith('[') ? `[${address}]` : address;
      const ws = new WebSocket(`ws://${host}:${port}`);
      this.ws = ws;
      const timer = setTimeout(() => { ws.close(); reject(new Error('Zeitüberschreitung – Host nicht erreichbar.')); }, 8000);
      ws.onopen = () => {
        clearTimeout(timer);
        this.pingTimer = setInterval(() => this.send({ t: 'ping', c: performance.now(), rtt: this.rtt }), 2000);
        resolve();
      };
      ws.onerror = () => {};
      ws.onclose = (e) => {
        clearTimeout(timer);
        clearInterval(this.pingTimer);
        reject(new Error('Verbindung fehlgeschlagen (Adresse, Port, Firewall prüfen).'));
        this.dispatchEvent(new CustomEvent('close', { detail: { code: e.code } }));
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.t === 'pong') this.rtt = Math.round(performance.now() - msg.c);
        this.dispatchEvent(new CustomEvent('msg', { detail: msg }));
      };
    });
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  close() {
    clearInterval(this.pingTimer);
    this.ws?.close();
  }
}
