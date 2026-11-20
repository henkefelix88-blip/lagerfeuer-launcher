/**
 * Parkour – Host-Server.
 * Bewegung läuft (für perfektes Sprunggefühl) auf dem Client; der Server ist Schiedsrichter für das Rennen:
 * Level, Startzeit, Checkpoints, Zieleinläufe, Punkte, Levelwechsel – und steuert die Geister-Bots.
 */
import { buildLevel } from '../shared/levels.mjs';

const RACE_TIME = 180, RESULTS_TIME = 7, COUNTDOWN = 3;
const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

export async function createServer(opts) {
  return opts.sdk.createRoom(opts, new ParkourGame(), { tickRate: 20, version: 1, maxPlayers: 16 });
}

class ParkourGame {
  constructor() {
    this.runners = new Map();
    this.levelIndex = 0;
  }

  init(opts) {
    this.startLevel(0);
    for (let i = 0; i < (opts.bots ?? 0); i++) this.room.addBot();
  }

  startLevel(n) {
    this.levelIndex = n % 3;
    this.level = buildLevel(this.levelIndex);
    this.phase = 'countdown';
    this.phaseEnd = this.room.time + COUNTDOWN;
    this.finishers = [];
    for (const r of this.runners.values()) this.resetRunner(r);
    this.room.broadcast({ t: 'level', n: this.levelIndex, phase: this.phase, ends: this.phaseEnd });
  }

  resetRunner(r) {
    const [sx, sy, sz] = this.level.start;
    const k = r.p.id % 6;
    Object.assign(r, { x: sx + (k - 2.5) * 1.1, y: sy, z: sz - 1, yaw: Math.PI, cp: -1, finished: null, wp: 0, prog: 0, anim: 0 });
    if (r.p.ws) this.room.send(r.p, { t: 'spawn', x: r.x, y: r.y, z: r.z });
  }

  welcome() { return { n: this.levelIndex, phase: this.phase, ends: this.phaseEnd }; }

  onJoin(p) {
    const r = { p, ai: p.bot ? { speed: 0.75 + Math.random() * 0.45, wait: 0 } : null };
    this.runners.set(p.id, r);
    this.resetRunner(r);
  }
  onLeave(p) { this.runners.delete(p.id); }

  onMessage(p, m) {
    const r = this.runners.get(p.id);
    if (!r) return;
    if (m.t === 'in' && [m.x, m.y, m.z, m.yaw].every(Number.isFinite)) {
      Object.assign(r, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, anim: m.an | 0 });
    } else if (m.t === 'cp' && Number.isInteger(m.i) && m.i === r.cp + 1) {
      const cp = this.level.cps[m.i];
      if (cp && Math.hypot(cp.x - r.x, cp.z - r.z) < 6) { r.cp = m.i; this.room.send(p, { t: 'cpok', i: m.i }); }
    } else if (m.t === 'fin') this.finish(r);
  }

  finish(r) {
    if (r.finished != null || this.phase !== 'race') return;
    const g = this.level.goal;
    if (Math.hypot(g.x - r.x, g.z - r.z) > 6 || r.cp < this.level.cps.length - 1) return; // Abkürzungen zählen nicht
    r.finished = this.room.time - this.raceStart;
    const place = this.finishers.length;
    this.finishers.push(r);
    r.p.score += POINTS[place] ?? 1;
    this.room.broadcast({ t: 'finish', id: r.p.id, time: Math.round(r.finished * 100) / 100, place: place + 1 });
    this.room.sendScores();
  }

  /** Geister-Bots: laufen die Ideallinie des Levels mit eigenem Tempo ab (mit kleinen Patzern). */
  updateBot(r, dt) {
    if (this.phase !== 'race' || r.finished != null) { r.anim = 0; return; }
    const route = this.level.route;
    if (r.ai.wait > 0) { r.ai.wait -= dt; r.anim = 0; return; }
    const target = route[Math.min(route.length - 1, r.wp + 1)];
    const dx = target[0] - r.x, dy = target[1] - r.y, dz = target[2] - r.z;
    const d = Math.hypot(dx, dz);
    const step = 6.5 * r.ai.speed * dt;
    if (d < step || d < 0.05) {
      r.wp++;
      if (Math.random() < 0.04) r.ai.wait = 1.5; // Patzer: kurz zögern
      for (const cp of this.level.cps) if (cp.i === r.cp + 1 && Math.hypot(cp.x - target[0], cp.z - target[2]) < 1) r.cp = cp.i;
      if (r.wp >= route.length - 1) { r.cp = this.level.cps.length - 1; this.finish(r); }
    } else {
      const k = step / d;
      r.x += dx * k; r.z += dz * k;
      // kleiner Sprungbogen zwischen den Plattformen
      const seg = route[r.wp];
      const total = Math.hypot(target[0] - seg[0], target[2] - seg[2]) || 1;
      const prog = 1 - d / total;
      r.y = seg[1] + (target[1] - seg[1]) * prog + Math.sin(prog * Math.PI) * Math.min(2.2, total * 0.35);
      r.yaw = Math.atan2(-dx, -dz);
      r.anim = Math.sin(prog * Math.PI) > 0.3 ? 2 : 1;
    }
  }

  tick(dt, time) {
    if (this.phase === 'countdown' && time >= this.phaseEnd) {
      this.phase = 'race'; this.raceStart = time; this.phaseEnd = time + RACE_TIME;
      this.room.broadcast({ t: 'phase', phase: 'race', ends: this.phaseEnd });
    } else if (this.phase === 'race') {
      const humans = [...this.runners.values()].filter((r) => !r.p.bot);
      const allDone = humans.length > 0 && humans.every((r) => r.finished != null);
      if (time >= this.phaseEnd || allDone) {
        this.phase = 'results'; this.phaseEnd = time + RESULTS_TIME;
        this.room.broadcast({ t: 'phase', phase: 'results', ends: this.phaseEnd });
      }
    } else if (this.phase === 'results' && time >= this.phaseEnd) {
      this.startLevel(this.levelIndex + 1);
    }
    for (const r of this.runners.values()) if (r.ai) this.updateBot(r, dt);
  }

  state() {
    return {
      ph: this.phase, ends: Math.round(this.phaseEnd * 100) / 100,
      r: [...this.runners.values()].map((r) => [r.p.id, Math.round(r.x * 100) / 100, Math.round(r.y * 100) / 100, Math.round(r.z * 100) / 100, Math.round(r.yaw * 100) / 100, r.anim, r.cp, r.finished != null ? 1 : 0]),
    };
  }
}
