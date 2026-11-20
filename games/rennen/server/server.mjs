/**
 * Turbo-Rennen – Host-Server. Autos mit Driftphysik, Gras bremst, Boost-Felder, Rempeln.
 * 3 Runden; nach dem ersten Zieleinlauf haben die anderen 20 s. Danach Ergebnis und neues Rennen.
 */
import { buildTrack, nearest, WIDTH } from '../shared/track.mjs';

const LAPS = 3, MAX = 520, ACC = 360, BRAKE = 600, TURN = 2.7, CAR_R = 18;
const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

export async function createServer(opts) {
  return opts.sdk.createRoom(opts, new RaceGame(opts.sdk.util), { tickRate: 30, version: 1, maxPlayers: 8 });
}

class RaceGame {
  constructor(u) { this.u = u; this.track = buildTrack(); this.cars = new Map(); }
  init(opts) { this.newRace(); for (let i = 0; i < (opts.bots ?? 0); i++) this.room.addBot(); }
  welcome() { return { laps: LAPS }; }

  newRace() {
    this.phase = 'countdown'; this.phaseEnd = this.room.time + 4; this.finishOrder = []; this.firstFinish = null;
    let k = 0;
    for (const c of this.cars.values()) this.grid(c, k++);
  }
  /** Startaufstellung hinter der Linie (2 nebeneinander). */
  grid(c, k) {
    const P = this.track.pts, n = P.length;
    const s = P[(n - 6 - Math.floor(k / 2) * 5) % n];
    const nx = -s.ty, ny = s.tx;
    const side = k % 2 ? 1 : -1;
    Object.assign(c, { x: s.x + nx * side * 30, y: s.y + ny * side * 30, a: Math.atan2(s.ty, s.tx), vx: 0, vy: 0, lap: -1, idx: n - 6 - Math.floor(k / 2) * 5, quarters: new Set([0, 1, 2, 3]), lapProgress: 0, finished: null, boostT: 0, drift: false });
  }
  onJoin(p) { const c = { p, in: {}, ai: p.bot ? { skill: 0.82 + Math.random() * 0.15 } : null }; this.cars.set(p.id, c); this.grid(c, this.cars.size - 1); if (this.phase === 'race') c.finished = 'spectate'; }
  onLeave(p) { this.cars.delete(p.id); }
  onMessage(p, m) {
    const c = this.cars.get(p.id);
    if (c && m.t === 'in' && m.keys) c.in = { gas: !!m.keys.up, brake: !!m.keys.down, left: !!m.keys.left, right: !!m.keys.right, drift: !!m.keys.fire };
  }

  updateBot(c) {
    const P = this.track.pts;
    const ahead = P[(c.idx + 10) % P.length];
    const want = Math.atan2(ahead.y - c.y, ahead.x - c.x);
    const diff = this.u.angleDiff(c.a, want);
    const far = P[(c.idx + 25) % P.length];
    const curve = Math.abs(this.u.angleDiff(Math.atan2(ahead.ty, ahead.tx), Math.atan2(far.ty, far.tx)));
    const speed = Math.hypot(c.vx, c.vy);
    c.in = { gas: speed < MAX * c.ai.skill * (curve > 0.6 ? 0.6 : 1), brake: curve > 0.9 && speed > 300, left: diff < -0.06, right: diff > 0.06, drift: curve > 0.8 && speed > 260 };
  }

  tick(dt, time) {
    if (this.phase === 'countdown') { if (time >= this.phaseEnd) { this.phase = 'race'; this.raceStart = time; this.room.broadcast({ t: 'go' }); } }
    else if (this.phase === 'race') {
      const racing = [...this.cars.values()].filter((c) => c.finished == null);
      if (!racing.length || (this.firstFinish && time > this.firstFinish + 20)) { this.phase = 'results'; this.phaseEnd = time + 7; this.room.broadcast({ t: 'results' }); }
    } else if (this.phase === 'results' && time >= this.phaseEnd) this.newRace();

    for (const c of this.cars.values()) {
      if (c.ai) this.updateBot(c);
      const frozen = this.phase === 'countdown' || c.finished === 'spectate';
      const i = frozen ? {} : c.in;
      const speed = Math.hypot(c.vx, c.vy);
      const near = nearest(this.track, c.x, c.y, c.idx);
      c.idx = near.i;
      const off = near.d > WIDTH / 2;
      // Lenken (abhängig vom Tempo), Gas/Bremse
      const steer = (i.right ? 1 : 0) - (i.left ? 1 : 0);
      c.a += steer * TURN * dt * Math.min(1, speed / 160) * (i.drift ? 1.35 : 1);
      const fx = Math.cos(c.a), fy = Math.sin(c.a);
      let fwd = c.vx * fx + c.vy * fy;
      let side = -c.vx * fy + c.vy * fx;
      const max = (off ? MAX * 0.45 : MAX) * (c.boostT > 0 ? 1.45 : 1);
      if (i.gas) fwd += ACC * dt; else if (i.brake) fwd -= (fwd > 0 ? BRAKE : ACC * 0.6) * dt; else fwd *= 1 - dt * 0.8;
      fwd = Math.max(-150, Math.min(max, fwd));
      if (fwd > max) fwd = max;
      side *= Math.pow(i.drift ? 0.35 : 0.0015, dt); // Haftung: ohne Drift kaum Seitwärtsrutschen
      if (off) fwd *= 1 - dt * 1.5;
      c.vx = fx * fwd - fy * side; c.vy = fy * fwd + fx * side;
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.drift = Math.abs(side) > 60;
      c.boostT -= dt;
      for (const b of this.track.boosts) if (Math.hypot(b.x - c.x, b.y - c.y) < 45 && c.boostT < 0.6) { c.boostT = 1.6; if (c.p.ws) this.room.send(c.p, { t: 'boost' }); }
      // Rundenzählung: alle vier Viertel müssen durchfahren werden
      const P = this.track.pts;
      const q = Math.floor((c.idx / P.length) * 4);
      c.quarters.add(q);
      if (c.prevIdx != null && c.prevIdx > P.length * 0.9 && c.idx < P.length * 0.1 && c.finished == null && this.phase === 'race') {
        if (c.quarters.size === 4) {
          c.lap++;
          c.quarters = new Set([0]);
          this.room.broadcast({ t: 'lap', id: c.p.id, lap: c.lap });
          if (c.lap >= LAPS) {
            c.finished = time - this.raceStart;
            const place = this.finishOrder.push(c);
            c.p.score += POINTS[place - 1] ?? 1;
            this.firstFinish ??= time;
            this.room.broadcast({ t: 'finish', id: c.p.id, place, time: Math.round(c.finished * 100) / 100 });
            this.room.sendScores();
          }
        }
      }
      c.prevIdx = c.idx;
      c.lapProgress = c.lap * P.length + c.idx;
    }
    // Rempeln
    const list = [...this.cars.values()];
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const A = list[a], B = list[b];
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
      if (d < CAR_R * 2 && d > 0.01) {
        const push = (CAR_R * 2 - d) / 2, nx = dx / d, ny = dy / d;
        A.x -= nx * push; A.y -= ny * push; B.x += nx * push; B.y += ny * push;
        const rel = (B.vx - A.vx) * nx + (B.vy - A.vy) * ny;
        if (rel < 0) { A.vx += nx * rel * 0.8; A.vy += ny * rel * 0.8; B.vx -= nx * rel * 0.8; B.vy -= ny * rel * 0.8; }
      }
    }
  }

  state() {
    const order = [...this.cars.values()].sort((a, b) => (a.finished != null && typeof a.finished === 'number' ? -1e9 + a.finished : -a.lapProgress) - (b.finished != null && typeof b.finished === 'number' ? -1e9 + b.finished : -b.lapProgress));
    const r = this.u.r1;
    return {
      ph: this.phase, ends: Math.round(this.phaseEnd * 10) / 10, start: this.raceStart ?? 0,
      c: order.map((c, k) => [c.p.id, r(c.x), r(c.y), Math.round(c.a * 100) / 100, Math.round(Math.hypot(c.vx, c.vy)), Math.max(1, Math.min(c.lap + 1, LAPS)), k + 1, typeof c.finished === 'number' ? Math.round(c.finished * 100) / 100 : 0, c.drift ? 1 : 0, c.boostT > 0 ? 1 : 0]),
    };
  }
}
