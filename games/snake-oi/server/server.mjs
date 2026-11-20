/**
 * Snake Oi – Host-Server.
 * Klassisches Snake (Äpfel fressen → länger werden) trifft Online-Arena:
 * freie Lenkung, Boost (kostet Länge), wer mit dem Kopf in eine andere Schlange fährt, zerfällt zu Futter.
 * Der Server simuliert alles; Clients schicken nur Richtung + Boost.
 */
const HALF = 1300;            // Arena: 2600 × 2600
const SPEED = 170, BOOST = 300, TURN = 4.2;
const START_LEN = 110, SEG = 12;
const DOTS = 700, APPLES = 30;

export async function createServer(opts) {
  return opts.sdk.createRoom(opts, new SnakeGame(opts.sdk.util), { tickRate: 30, version: 1, maxPlayers: 16 });
}

class SnakeGame {
  constructor(util) {
    this.u = util;
    this.food = new Map();
    this.nextFood = 1;
    this.added = [];
    this.removed = [];
    this.snakes = new Map();
  }

  init(opts) {
    for (let i = 0; i < DOTS; i++) this.spawnFood('dot');
    for (let i = 0; i < APPLES; i++) this.spawnFood('apple');
    for (let i = 0; i < (opts.bots ?? 0); i++) this.room.addBot();
  }

  spawnFood(kind, x, y, value) {
    const id = this.nextFood++;
    const f = {
      id, kind,
      x: x ?? (Math.random() * 2 - 1) * (HALF - 30),
      y: y ?? (Math.random() * 2 - 1) * (HALF - 30),
      v: value ?? (kind === 'apple' ? 14 : 1.5 + Math.random()),
      c: Math.floor(Math.random() * 6),
    };
    this.food.set(id, f);
    this.added.push(this.foodInfo(f));
    return f;
  }
  foodInfo(f) { return [f.id, f.kind === 'apple' ? 1 : 0, Math.round(f.x), Math.round(f.y), f.c, Math.round(f.v * 10) / 10]; }
  eatFood(f) { this.food.delete(f.id); this.removed.push(f.id); }

  welcome() { return { half: HALF, food: [...this.food.values()].map((f) => this.foodInfo(f)) }; }

  onJoin(p) {
    const s = { p, alive: false, respawnAt: 0, len: START_LEN, path: [], ang: 0, target: 0, boost: false, best: 0, ai: p.bot ? { t: 0 } : null };
    this.snakes.set(p.id, s);
    this.spawn(s);
  }
  onLeave(p) { const s = this.snakes.get(p.id); if (s?.alive) this.die(s, null); this.snakes.delete(p.id); }

  onMessage(p, m) {
    const s = this.snakes.get(p.id);
    if (!s || m.t !== 'in') return;
    if (Number.isFinite(m.a)) s.target = m.a;
    s.boost = !!m.b;
  }

  /** Freien Startplatz suchen (weit weg von Köpfen). */
  spawn(s) {
    let best = null, bestD = -1;
    for (let i = 0; i < 20; i++) {
      const x = (Math.random() * 2 - 1) * (HALF - 200), y = (Math.random() * 2 - 1) * (HALF - 200);
      let d = 1e9;
      for (const o of this.snakes.values()) if (o.alive && o !== s) for (let k = 0; k < o.path.length; k += 4) d = Math.min(d, Math.hypot(o.path[k][0] - x, o.path[k][1] - y));
      if (d > bestD) { bestD = d; best = [x, y]; }
    }
    s.ang = s.target = Math.atan2(-best[1], -best[0]);
    s.path = [];
    for (let i = 0; i < START_LEN / 4; i++) s.path.push([best[0] - Math.cos(s.ang) * i * 4, best[1] - Math.sin(s.ang) * i * 4]);
    s.len = START_LEN;
    s.alive = true;
    s.p.score = Math.floor(s.len);
  }

  radius(s) { return 8 + Math.sqrt(s.len) * 0.35; }

  /** Körperpunkte im Abstand SEG entlang des Pfads (Kopf zuerst). */
  body(s) {
    const out = [s.path[0]];
    let acc = 0, need = SEG, total = 0;
    for (let i = 1; i < s.path.length && total < s.len; i++) {
      const [ax, ay] = s.path[i - 1], [bx, by] = s.path[i];
      const d = Math.hypot(bx - ax, by - ay);
      acc += d; total += d;
      while (acc >= need) {
        const k = 1 - (acc - need) / d;
        out.push([ax + (bx - ax) * k, ay + (by - ay) * k]);
        need += SEG;
      }
    }
    return out;
  }

  die(s, killer) {
    s.alive = false;
    s.respawnAt = this.room.time + 2.5;
    // Körper zerfällt zu Futter
    const pts = s.bodyCache || this.body(s);
    const per = Math.max(1.5, (s.len * 0.6) / Math.max(1, pts.length));
    for (let i = 0; i < pts.length; i += 1) this.spawnFood('dot', pts[i][0] + (Math.random() - 0.5) * 14, pts[i][1] + (Math.random() - 0.5) * 14, per);
    if (killer && killer.p) { killer.p.kills = (killer.p.kills || 0) + 1; }
    this.room.broadcast({ t: 'die', id: s.p.id, k: killer?.p?.id ?? null, len: Math.floor(s.len) });
  }

  updateBot(s, dt) {
    const [hx, hy] = s.path[0];
    const ai = s.ai;
    ai.t -= dt;
    if (ai.t <= 0) {
      ai.t = 0.25;
      // nächstes Futter (Äpfel bevorzugt)
      let best = null, bestScore = Infinity;
      for (const f of this.food.values()) {
        const d = Math.hypot(f.x - hx, f.y - hy);
        if (d > 500) continue;
        const score = d / (f.kind === 'apple' ? 4 : 1);
        if (score < bestScore) { bestScore = score; best = f; }
      }
      ai.goal = best ? Math.atan2(best.y - hy, best.x - hx) : ai.goal ?? Math.random() * 6.28;
    }
    let target = ai.goal;
    // Gefahr voraus? (Wand oder fremde Körper) → ausweichen
    const look = 70 + this.radius(s) * 2;
    const danger = (a) => {
      const x = hx + Math.cos(a) * look, y = hy + Math.sin(a) * look;
      if (Math.abs(x) > HALF - 30 || Math.abs(y) > HALF - 30) return true;
      for (const o of this.snakes.values()) {
        if (o === s || !o.alive || !o.bodyCache) continue;
        const r = this.radius(o) + this.radius(s) + 10;
        for (const [bx, by] of o.bodyCache) if (Math.abs(bx - x) < r && Math.abs(by - y) < r && Math.hypot(bx - x, by - y) < r) return true;
      }
      return false;
    };
    if (danger(target)) {
      for (const off of [0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6]) if (!danger(s.ang + off)) { target = s.ang + off; break; }
    }
    s.target = target;
    s.boost = s.len > 120 && bestBoost(this, s);
  }

  tick(dt) {
    const time = this.room.time;
    for (const s of this.snakes.values()) {
      if (!s.alive) { if (time >= s.respawnAt) this.spawn(s); continue; }
      if (s.ai) this.updateBot(s, dt);
      const diff = this.u.angleDiff(s.ang, s.target);
      s.ang += Math.max(-TURN * dt, Math.min(TURN * dt, diff));
      const boosting = s.boost && s.len > START_LEN;
      const sp = boosting ? BOOST : SPEED;
      const [hx, hy] = s.path[0];
      const nx = hx + Math.cos(s.ang) * sp * dt, ny = hy + Math.sin(s.ang) * sp * dt;
      s.path.unshift([nx, ny]);
      if (boosting) {
        s.len -= 14 * dt;
        s.dropT = (s.dropT || 0) - dt;
        if (s.dropT <= 0) { s.dropT = 0.12; const t = s.path[s.path.length - 1]; this.spawnFood('dot', t[0], t[1], 1.2); }
      }
      // Pfad kürzen
      let total = 0;
      for (let i = 1; i < s.path.length; i++) {
        total += Math.hypot(s.path[i][0] - s.path[i - 1][0], s.path[i][1] - s.path[i - 1][1]);
        if (total > s.len + SEG) { s.path.length = i + 1; break; }
      }
      s.boosting = boosting;
    }
    for (const s of this.snakes.values()) if (s.alive) s.bodyCache = this.body(s);

    // Fressen & Kollisionen
    for (const s of this.snakes.values()) {
      if (!s.alive) continue;
      const [hx, hy] = s.path[0];
      const r = this.radius(s);
      if (Math.abs(hx) > HALF - r || Math.abs(hy) > HALF - r) { this.die(s, null); continue; }
      for (const f of this.food.values()) {
        if (Math.abs(f.x - hx) > r + 14 || Math.abs(f.y - hy) > r + 14) continue;
        if (Math.hypot(f.x - hx, f.y - hy) < r + (f.kind === 'apple' ? 14 : 6)) {
          s.len += f.v;
          this.eatFood(f);
          if (s.p.ws) this.room.send(s.p, { t: 'eat', k: f.kind });
        }
      }
      let dead = null;
      for (const o of this.snakes.values()) {
        if (o === s || !o.alive || !o.bodyCache) continue;
        const ro = this.radius(o) * 0.85;
        for (let i = 0; i < o.bodyCache.length; i++) {
          const [bx, by] = o.bodyCache[i];
          if (Math.abs(bx - hx) < r + ro && Math.abs(by - hy) < r + ro && Math.hypot(bx - hx, by - hy) < r * 0.8 + ro) { dead = o; break; }
        }
        if (dead) break;
      }
      if (dead) this.die(s, dead);
      s.best = Math.max(s.best, s.len);
      s.p.score = s.alive ? Math.floor(s.len) : 0;
    }
    // Futter nachfüllen
    let dots = 0, apples = 0;
    for (const f of this.food.values()) f.kind === 'apple' ? apples++ : dots++;
    if (dots < DOTS) for (let i = 0; i < Math.min(10, DOTS - dots); i++) this.spawnFood('dot');
    if (apples < APPLES) this.spawnFood('apple');
  }

  state() {
    const sn = [];
    for (const s of this.snakes.values()) {
      if (!s.alive) { sn.push([s.p.id, 0]); continue; }
      const pts = [];
      for (const [x, y] of s.bodyCache) pts.push(Math.round(x), Math.round(y));
      sn.push([s.p.id, 1, Math.round(s.len), s.boosting ? 1 : 0, Math.round(s.ang * 100) / 100, pts]);
    }
    const out = { sn, fa: this.added, fr: this.removed };
    this.added = [];
    this.removed = [];
    return out;
  }
}

/** Bots boosten nur, wenn ein Apfel nah vor ihnen liegt. */
function bestBoost(game, s) {
  const [hx, hy] = s.path[0];
  for (const f of game.food.values()) {
    if (f.kind !== 'apple') continue;
    const d = Math.hypot(f.x - hx, f.y - hy);
    if (d < 220 && Math.abs(game.u.angleDiff(s.ang, Math.atan2(f.y - hy, f.x - hx))) < 0.4) return true;
  }
  return false;
}
