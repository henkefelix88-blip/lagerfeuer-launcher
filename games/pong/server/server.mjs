/**
 * Viereck-Pong – Host-Server. Quadratische Arena, bis zu 4 Spieler (je eine Seite), freie Seiten sind Wände.
 * Jeder hat 5 Leben; wer zuletzt übrig ist, gewinnt das Match. Ab 3 Spielern gibt es zwei Bälle.
 * Die Clients drehen ihre Ansicht, sodass die eigene Seite unten ist; "rechts" wird hier je Seite umgerechnet.
 */
const SIZE = 600, PAD = 110, PAD_SPEED = 470, LIVES = 5, BALL_R = 9;
const AXIS_SIGN = [1, 1, -1, -1]; // Bildschirm-rechts je Seite (0 unten, 1 links, 2 oben, 3 rechts)

export async function createServer(opts) {
  return opts.sdk.createRoom(opts, new PongGame(), { tickRate: 60, version: 1, maxPlayers: 8 });
}

class PongGame {
  constructor() { this.sides = [null, null, null, null]; this.balls = []; this.phase = 'wait'; this.queue = []; this.phaseEnd = 0; }
  init(opts) { for (let i = 0; i < Math.min(3, opts.bots ?? 0); i++) this.room.addBot(); }
  welcome() { return { size: SIZE, pad: PAD }; }

  onJoin(p) {
    const free = this.sides.findIndex((s) => !s);
    if (free >= 0 && this.phase !== 'play') this.sides[free] = this.newSide(p);
    else this.queue.push(p);
    this.maybeStart();
  }
  onLeave(p) {
    const i = this.sides.findIndex((s) => s?.p === p);
    if (i >= 0) this.sides[i] = null;
    this.queue = this.queue.filter((q) => q !== p);
  }
  newSide(p) { return { p, pos: SIZE / 2, lives: LIVES, dir: 0 }; }
  onMessage(p, m) {
    if (m.t !== 'in') return;
    const s = this.sides.find((x) => x?.p === p);
    if (s) s.dir = Math.max(-1, Math.min(1, Number(m.dir) || 0));
  }

  maybeStart() {
    if (this.phase === 'play') return;
    if (this.sides.filter(Boolean).length >= 1) { this.phase = 'countdown'; this.phaseEnd = this.room.time + 3; }
  }
  startMatch() {
    // Warteschlange auf freie Seiten verteilen
    for (let i = 0; i < 4; i++) if (!this.sides[i] && this.queue.length) this.sides[i] = this.newSide(this.queue.shift());
    for (const s of this.sides) if (s) { s.lives = LIVES; s.pos = SIZE / 2; }
    this.phase = 'play';
    const n = this.sides.filter(Boolean).length;
    this.balls = [];
    for (let i = 0; i < (n >= 3 ? 2 : 1); i++) this.balls.push(this.newBall(i * 0.6));
    this.room.broadcast({ t: 'start' });
  }
  newBall(delay = 0) {
    const a = Math.random() * Math.PI * 2;
    const d = [Math.cos(a), Math.sin(a)];
    if (Math.abs(d[0]) < 0.35 || Math.abs(d[1]) < 0.35) { d[0] = Math.sign(d[0] || 1) * 0.7; d[1] = Math.sign(d[1] || 1) * 0.7; }
    return { x: SIZE / 2, y: SIZE / 2, vx: d[0] * 290, vy: d[1] * 290, wait: 1 + delay, trail: [] };
  }

  /** Wo würde der Ball die Seite i treffen? (für Bots, ohne Abpraller) */
  predict(b, i) {
    const t = i === 0 ? (SIZE - b.y) / b.vy : i === 2 ? -b.y / b.vy : i === 1 ? -b.x / b.vx : (SIZE - b.x) / b.vx;
    if (!(t > 0)) return null;
    let v = i === 0 || i === 2 ? b.x + b.vx * t : b.y + b.vy * t;
    // Wände spiegeln
    v = ((v % (2 * SIZE)) + 2 * SIZE) % (2 * SIZE);
    if (v > SIZE) v = 2 * SIZE - v;
    return { v, t };
  }

  tick(dt, time) {
    if (this.phase === 'countdown') { if (time >= this.phaseEnd) this.startMatch(); return; }
    if (this.phase === 'over') { if (time >= this.phaseEnd) { this.phase = 'countdown'; this.phaseEnd = time + 2; } return; }
    if (this.phase !== 'play') return;
    this.sides.forEach((s, i) => {
      if (!s || s.lives <= 0) return;
      if (s.p.bot) {
        let best = null;
        for (const b of this.balls) { const pr = this.predict(b, i); if (pr && (!best || pr.t < best.t)) best = pr; }
        const target = best ? best.v + (Math.sin(time * 1.7 + s.p.id) * 25) : SIZE / 2;
        s.dir = Math.abs(target - s.pos) < 10 ? 0 : Math.sign(target - s.pos) * AXIS_SIGN[i];
      }
      s.pos = Math.max(PAD / 2, Math.min(SIZE - PAD / 2, s.pos + s.dir * AXIS_SIGN[i] * PAD_SPEED * dt));
    });
    for (const b of this.balls) {
      if (b.wait > 0) { b.wait -= dt; continue; }
      b.x += b.vx * dt; b.y += b.vy * dt;
      const checks = [[0, b.y + BALL_R >= SIZE && b.vy > 0, b.x], [2, b.y - BALL_R <= 0 && b.vy < 0, b.x], [1, b.x - BALL_R <= 0 && b.vx < 0, b.y], [3, b.x + BALL_R >= SIZE && b.vx > 0, b.y]];
      for (const [i, crossing, along] of checks) {
        if (!crossing) continue;
        const s = this.sides[i];
        const horiz = i === 0 || i === 2;
        if (!s || s.lives <= 0) { // Wand
          if (horiz) b.vy = -b.vy; else b.vx = -b.vx;
          this.room.broadcast({ t: 'fx', k: 'wall' });
        } else if (Math.abs(along - s.pos) <= PAD / 2 + BALL_R) { // Schläger getroffen → Winkel je nach Trefferpunkt
          const off = (along - s.pos) / (PAD / 2);
          const speed = Math.min(720, Math.hypot(b.vx, b.vy) * 1.06);
          const out = [0, -1, 0, 1][i] !== 0 ? [0, -1, 0, 1][i] : 0;
          if (horiz) { b.vx = off * speed * 0.75; b.vy = (i === 0 ? -1 : 1) * Math.sqrt(Math.max(0.1, speed ** 2 - b.vx ** 2)); }
          else { b.vy = off * speed * 0.75; b.vx = (i === 1 ? 1 : -1) * Math.sqrt(Math.max(0.1, speed ** 2 - b.vy ** 2)); }
          void out;
          s.p.score += 0; // Treffer zählen nicht, nur Siege
          this.room.broadcast({ t: 'fx', k: 'hit', side: i });
        } else { // Tor!
          s.lives--;
          this.room.broadcast({ t: 'fx', k: 'goal', side: i, id: s.p.id, lives: s.lives });
          Object.assign(b, this.newBall(0));
          break;
        }
      }
      b.x = Math.max(BALL_R, Math.min(SIZE - BALL_R, b.x)); b.y = Math.max(BALL_R, Math.min(SIZE - BALL_R, b.y));
    }
    const alive = this.sides.filter((s) => s && s.lives > 0);
    const total = this.sides.filter(Boolean).length;
    if ((total > 1 && alive.length <= 1) || (total === 1 && alive.length === 0)) {
      const winner = total > 1 ? alive[0] : null;
      if (winner) { winner.p.score++; this.room.sendScores(); }
      this.room.broadcast({ t: 'over', winner: winner?.p.id ?? null });
      this.phase = 'over'; this.phaseEnd = time + 3.5;
      this.balls = [];
    }
  }

  state() {
    return {
      ph: this.phase,
      sd: this.sides.map((s) => (s ? [s.p.id, Math.round(s.pos), s.lives] : 0)),
      bl: this.balls.map((b) => [Math.round(b.x), Math.round(b.y), b.wait > 0 ? 1 : 0]),
      q: this.queue.length,
    };
  }
}
