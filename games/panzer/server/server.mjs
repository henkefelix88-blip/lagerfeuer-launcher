/**
 * Panzerduell – Host-Server. Top-Down-Panzer, Geschosse prallen zweimal von Wänden ab.
 * Jeder gegen jeden, 3 Treffer = zerstört, Respawn nach 3 s. Power-Ups: Schild, Dreifachschuss, Tempo.
 */
const T = 40, COLS = 32, ROWS = 20;           // Kachelgröße und Raster (1280 × 800)
const W = COLS * T, H = ROWS * T, R = 16;
const SPEED = 150, TURN = 3, BULLET = 380, COOLDOWN = 0.55, BOUNCES = 2;

export async function createServer(opts) {
  return opts.sdk.createRoom(opts, new TankGame(opts.sdk.util), { tickRate: 30, version: 1, maxPlayers: 12 });
}

/** Feste, symmetrische Karte mit Mauerblöcken. */
function buildMap() {
  const g = Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 ? 1 : 0)));
  const blocks = [[5, 4, 3, 1], [5, 5, 1, 2], [12, 3, 1, 4], [9, 9, 4, 1], [15, 7, 2, 2], [4, 13, 1, 3], [10, 14, 4, 1], [13, 11, 1, 3], [7, 7, 1, 1], [2, 9, 2, 1]];
  for (const [bx, by, bw, bh] of blocks) {
    for (const [mx, my] of [[bx, by], [COLS - bx - bw, by], [bx, ROWS - by - bh], [COLS - bx - bw, ROWS - by - bh]]) {
      for (let y = my; y < my + bh; y++) for (let x = mx; x < mx + bw; x++) if (g[y]?.[x] !== undefined) g[y][x] = 1;
    }
  }
  return g;
}

class TankGame {
  constructor(u) {
    this.u = u;
    this.map = buildMap();
    this.tanks = new Map();
    this.bullets = [];
    this.powerups = [];
    this.puTimer = 5;
    this.nextId = 1;
  }
  init(opts) { for (let i = 0; i < (opts.bots ?? 0); i++) this.room.addBot(); }
  welcome() { return { map: this.map, tile: T }; }

  wall(x, y) { const cx = Math.floor(x / T), cy = Math.floor(y / T); return cy < 0 || cx < 0 || cy >= ROWS || cx >= COLS || this.map[cy][cx] === 1; }
  /** Kreis gegen Mauern auflösen. */
  push(o, r) {
    const cx0 = Math.floor((o.x - r) / T), cx1 = Math.floor((o.x + r) / T), cy0 = Math.floor((o.y - r) / T), cy1 = Math.floor((o.y + r) / T);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      if (!this.wall(cx * T + 1, cy * T + 1)) continue;
      const nx = Math.max(cx * T, Math.min(o.x, cx * T + T)), ny = Math.max(cy * T, Math.min(o.y, cy * T + T));
      const dx = o.x - nx, dy = o.y - ny, d = Math.hypot(dx, dy);
      if (d < r && d > 0.001) { o.x = nx + (dx / d) * r; o.y = ny + (dy / d) * r; }
    }
  }
  spawnPoint() {
    let best = null, bestD = -1;
    for (let i = 0; i < 30; i++) {
      const x = T * 1.5 + Math.random() * (W - T * 3), y = T * 1.5 + Math.random() * (H - T * 3);
      if (this.wall(x, y) || this.wall(x + R, y) || this.wall(x - R, y) || this.wall(x, y + R) || this.wall(x, y - R)) continue;
      let d = 1e9;
      for (const t of this.tanks.values()) if (t.alive) d = Math.min(d, Math.hypot(t.x - x, t.y - y));
      if (d > bestD) { bestD = d; best = { x, y }; }
    }
    return best || { x: W / 2, y: H / 2 };
  }

  onJoin(p) {
    const t = { p, alive: false, respawnAt: 0, in: {}, cd: 0, ai: p.bot ? { t: 0, wander: null } : null };
    this.tanks.set(p.id, t);
    this.spawn(t);
  }
  onLeave(p) { this.tanks.delete(p.id); }
  spawn(t) {
    const s = this.spawnPoint();
    Object.assign(t, { x: s.x, y: s.y, ba: Math.random() * 6.28, ta: 0, hp: 3, alive: true, shield: 0, triple: 0, fast: 0, cd: 0 });
    t.ta = t.ba;
  }
  onMessage(p, m) {
    const t = this.tanks.get(p.id);
    if (t && m.t === 'in' && m.keys) t.in = { up: !!m.keys.up, down: !!m.keys.down, left: !!m.keys.left, right: !!m.keys.right, fire: !!m.keys.fire, aim: Number.isFinite(m.aim) ? m.aim : t.ta };
  }

  fire(t) {
    if (t.cd > 0 || this.bullets.filter((b) => b.owner === t).length >= 6) return;
    t.cd = COOLDOWN;
    const angles = t.triple > 0 ? [-0.2, 0, 0.2] : [0];
    for (const off of angles) {
      const a = t.ta + off;
      this.bullets.push({ id: this.nextId++, owner: t, x: t.x + Math.cos(a) * 26, y: t.y + Math.sin(a) * 26, vx: Math.cos(a) * BULLET, vy: Math.sin(a) * BULLET, b: 0, life: 3 });
    }
    this.room.broadcast({ t: 'fx', k: 'shot', x: Math.round(t.x), y: Math.round(t.y) });
  }

  lineOfSight(a, b) {
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / 12);
    for (let i = 1; i < n; i++) if (this.wall(a.x + (b.x - a.x) * (i / n), a.y + (b.y - a.y) * (i / n))) return false;
    return true;
  }

  updateBot(t, dt) {
    const ai = t.ai;
    let target = null, bd = 1e9;
    for (const o of this.tanks.values()) if (o !== t && o.alive) { const d = Math.hypot(o.x - t.x, o.y - t.y); if (d < bd) { bd = d; target = o; } }
    const inp = { up: true, down: false, left: false, right: false, fire: false, aim: t.ta };
    let goal = ai.wander;
    if (target) {
      const los = this.lineOfSight(t, target);
      // mit Vorhalt zielen
      const lead = bd / BULLET;
      const tx = target.x + Math.cos(target.ba) * SPEED * lead * (target.moving ? 1 : 0), ty = target.y + Math.sin(target.ba) * SPEED * lead * (target.moving ? 1 : 0);
      inp.aim = Math.atan2(ty - t.y, tx - t.x) + (Math.random() - 0.5) * 0.15;
      inp.fire = los && bd < 600 && Math.random() < 0.6;
      goal = los && bd < 250 ? { x: t.x - (target.x - t.x), y: t.y - (target.y - t.y) } : { x: target.x, y: target.y };
    }
    ai.t -= dt;
    if (!goal || ai.t <= 0) { ai.t = 2 + Math.random() * 2; ai.wander = this.spawnPoint(); goal = goal || ai.wander; }
    const want = Math.atan2(goal.y - t.y, goal.x - t.x);
    // Wand voraus → ausweichen
    const ahead = { x: t.x + Math.cos(t.ba) * 40, y: t.y + Math.sin(t.ba) * 40 };
    const diff = this.wall(ahead.x, ahead.y) ? 1 : this.u.angleDiff(t.ba, want);
    if (diff > 0.15) inp.right = true; else if (diff < -0.15) inp.left = true;
    if (Math.abs(diff) > 1.4) inp.up = false;
    t.in = inp;
  }

  hit(t, by) {
    if (t.shield > 0) { this.room.broadcast({ t: 'fx', k: 'shield', x: Math.round(t.x), y: Math.round(t.y) }); return; }
    t.hp--;
    this.room.broadcast({ t: 'fx', k: 'hit', x: Math.round(t.x), y: Math.round(t.y) });
    if (t.hp <= 0) {
      t.alive = false; t.respawnAt = this.room.time + 3;
      if (by && by !== t) by.p.score++;
      this.room.broadcast({ t: 'fx', k: 'boom', x: Math.round(t.x), y: Math.round(t.y), id: t.p.id, by: by?.p.id });
      this.room.broadcast({ t: 'kill', k: by?.p.id, v: t.p.id });
      this.room.sendScores();
    }
  }

  tick(dt, time) {
    for (const t of this.tanks.values()) {
      if (!t.alive) { if (time >= t.respawnAt) this.spawn(t); continue; }
      if (t.ai) this.updateBot(t, dt);
      t.cd -= dt; t.shield -= dt; t.triple -= dt; t.fast -= dt;
      const i = t.in;
      if (i.left) t.ba -= TURN * dt;
      if (i.right) t.ba += TURN * dt;
      const sp = (i.up ? 1 : 0) - (i.down ? 0.6 : 0);
      const speed = SPEED * (t.fast > 0 ? 1.5 : 1);
      t.x += Math.cos(t.ba) * sp * speed * dt; t.y += Math.sin(t.ba) * sp * speed * dt;
      t.moving = sp !== 0;
      this.push(t, R);
      for (const o of this.tanks.values()) { // Panzer schieben sich gegenseitig
        if (o === t || !o.alive) continue;
        const dx = t.x - o.x, dy = t.y - o.y, d = Math.hypot(dx, dy);
        if (d < R * 2 && d > 0.01) { t.x += (dx / d) * (R * 2 - d) / 2; t.y += (dy / d) * (R * 2 - d) / 2; }
      }
      t.ta += Math.max(-6 * dt, Math.min(6 * dt, this.u.angleDiff(t.ta, i.aim ?? t.ta)));
      if (i.fire) this.fire(t);
      for (let k = this.powerups.length - 1; k >= 0; k--) {
        const pu = this.powerups[k];
        if (Math.hypot(pu.x - t.x, pu.y - t.y) < 26) { t[pu.k] = 8; this.powerups.splice(k, 1); if (t.p.ws) this.room.send(t.p, { t: 'fx', k: 'pu', x: 0, y: 0, pu: pu.k }); }
      }
    }
    for (let k = this.bullets.length - 1; k >= 0; k--) {
      const b = this.bullets[k];
      b.life -= dt;
      let dead = b.life <= 0;
      const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;
      if (this.wall(nx, b.y)) { b.vx = -b.vx; b.b++; } else b.x = nx;
      if (this.wall(b.x, ny)) { b.vy = -b.vy; b.b++; } else b.y = ny;
      if (b.b > BOUNCES) dead = true;
      for (const t of this.tanks.values()) {
        if (!t.alive || dead) continue;
        if (t === b.owner && b.b === 0 && b.life > 2.8) continue; // eigener Schuss direkt nach dem Abfeuern
        if (Math.hypot(t.x - b.x, t.y - b.y) < R + 3) { this.hit(t, b.owner); dead = true; }
      }
      if (dead) this.bullets.splice(k, 1);
    }
    this.puTimer -= dt;
    if (this.puTimer <= 0 && this.powerups.length < 3) {
      this.puTimer = 9;
      const s = this.spawnPoint();
      this.powerups.push({ x: s.x, y: s.y, k: ['shield', 'triple', 'fast'][Math.floor(Math.random() * 3)] });
    }
  }

  state() {
    const r = this.u.r1;
    return {
      tk: [...this.tanks.values()].map((t) => [t.p.id, t.alive ? 1 : 0, r(t.x), r(t.y), r(t.ba), r(t.ta), t.hp, t.shield > 0 ? 1 : 0, t.triple > 0 ? 1 : 0, t.fast > 0 ? 1 : 0]),
      bl: this.bullets.map((b) => [b.id, r(b.x), r(b.y)]),
      pu: this.powerups.map((p) => [r(p.x), r(p.y), p.k]),
    };
  }
}
