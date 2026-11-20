/**
 * Sternenjäger – Host-Server (Koop). Alle Spieler gegen Wellen aus Asteroiden (zerbrechen in kleinere)
 * und Drohnen (verfolgen und schießen). Gemeinsamer Lebens-Pool; sind alle aufgebraucht, beginnt es von vorn.
 */
const W = 1600, H = 1000, SHIP_R = 16;
const TEAM_LIVES = 6;

export async function createServer(opts) {
  return opts.sdk.createRoom(opts, new StarGame(opts.sdk.util), { tickRate: 30, version: 1, maxPlayers: 8 });
}

class StarGame {
  constructor(u) { this.u = u; this.ships = new Map(); this.rocks = []; this.drones = []; this.shots = []; this.eshots = []; this.pus = []; this.nextId = 1; }
  init(opts) { this.reset(); for (let i = 0; i < (opts.bots ?? 0); i++) this.room.addBot(); }
  welcome() { return { w: W, h: H }; }

  reset() {
    this.wave = 0; this.lives = TEAM_LIVES; this.rocks = []; this.drones = []; this.shots = []; this.eshots = []; this.pus = [];
    this.phase = 'break'; this.phaseEnd = (this.room?.time ?? 0) + 3;
    for (const s of this.ships.values()) this.spawnShip(s);
  }
  spawnShip(s) { Object.assign(s, { x: W / 2 + (Math.random() - 0.5) * 300, y: H / 2 + (Math.random() - 0.5) * 200, vx: 0, vy: 0, a: -Math.PI / 2, alive: true, inv: 2.5, cd: 0, rapid: 0, shield: 0 }); }
  onJoin(p) { const s = { p, in: {}, ai: p.bot ? { t: 0 } : null }; this.ships.set(p.id, s); this.spawnShip(s); }
  onLeave(p) { this.ships.delete(p.id); }
  onMessage(p, m) {
    const s = this.ships.get(p.id);
    if (s && m.t === 'in' && m.keys) s.in = { up: !!m.keys.up, down: !!m.keys.down, left: !!m.keys.left, right: !!m.keys.right, fire: !!m.keys.fire, aim: Number.isFinite(m.aim) ? m.aim : s.a };
  }

  startWave() {
    this.wave++;
    this.phase = 'wave';
    const edge = () => { const side = Math.floor(Math.random() * 4); return side === 0 ? [Math.random() * W, -40] : side === 1 ? [W + 40, Math.random() * H] : side === 2 ? [Math.random() * W, H + 40] : [-40, Math.random() * H]; };
    for (let i = 0; i < 3 + this.wave; i++) { const [x, y] = edge(); this.rock(x, y, 3); }
    for (let i = 0; i < Math.floor(this.wave / 2); i++) { const [x, y] = edge(); this.drones.push({ id: this.nextId++, x, y, vx: 0, vy: 0, hp: 3 + Math.floor(this.wave / 3), cd: 2 }); }
    this.room.broadcast({ t: 'wave', n: this.wave });
  }
  rock(x, y, size) {
    const a = Math.random() * 6.28, sp = 40 + Math.random() * 50 + (3 - size) * 30 + this.wave * 3;
    this.rocks.push({ id: this.nextId++, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, size, r: size * 16, rot: Math.random() * 6, spin: (Math.random() - 0.5) * 2, hp: size, seed: Math.floor(Math.random() * 1000) });
  }

  nearestShip(x, y) { let best = null, bd = 1e9; for (const s of this.ships.values()) if (s.alive) { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = s; } } return best; }

  updateBot(s) {
    let target = null, bd = 1e9;
    for (const e of [...this.rocks, ...this.drones]) { const d = Math.hypot(e.x - s.x, e.y - s.y); if (d < bd) { bd = d; target = e; } }
    const inp = { fire: !!target && bd < 600, aim: target ? Math.atan2(target.y - s.y, target.x - s.x) : s.a };
    // Abstand halten: zu nah → wegfliegen, sonst Richtung Mitte driften
    let mx = (W / 2 - s.x) * 0.002, my = (H / 2 - s.y) * 0.002;
    if (target && bd < 220) { mx -= (target.x - s.x) / bd; my -= (target.y - s.y) / bd; }
    Object.assign(inp, { right: mx > 0.15, left: mx < -0.15, down: my > 0.15, up: my < -0.15 });
    s.in = inp;
  }

  hitShip(s) {
    if (s.inv > 0 || !s.alive) return;
    if (s.shield > 0) { s.shield = 0; s.inv = 1; this.room.broadcast({ t: 'fx', k: 'shield', x: s.x, y: s.y }); return; }
    s.alive = false; s.respawn = this.room.time + 3;
    this.lives--;
    this.room.broadcast({ t: 'fx', k: 'shipboom', x: Math.round(s.x), y: Math.round(s.y), id: s.p.id });
    if (this.lives < 0) { this.room.broadcast({ t: 'gameover', wave: this.wave }); this.phase = 'over'; this.phaseEnd = this.room.time + 5; }
  }

  tick(dt, time) {
    if (this.phase === 'over') { if (time >= this.phaseEnd) this.reset(); return; }
    if (this.phase === 'break' && time >= this.phaseEnd) this.startWave();
    if (this.phase === 'wave' && !this.rocks.length && !this.drones.length) { this.phase = 'break'; this.phaseEnd = time + 3; this.lives = Math.min(TEAM_LIVES, this.lives + 1); this.room.broadcast({ t: 'cleared', n: this.wave }); }

    for (const s of this.ships.values()) {
      if (!s.alive) { if (time >= s.respawn && this.lives >= 0) this.spawnShip(s); continue; }
      if (s.ai) this.updateBot(s);
      const i = s.in;
      const ax = (i.right ? 1 : 0) - (i.left ? 1 : 0), ay = (i.down ? 1 : 0) - (i.up ? 1 : 0);
      s.vx += ax * 900 * dt; s.vy += ay * 900 * dt;
      s.vx *= Math.pow(0.25, dt); s.vy *= Math.pow(0.25, dt);
      const sp = Math.hypot(s.vx, s.vy); if (sp > 380) { s.vx *= 380 / sp; s.vy *= 380 / sp; }
      s.x = Math.max(SHIP_R, Math.min(W - SHIP_R, s.x + s.vx * dt)); s.y = Math.max(SHIP_R, Math.min(H - SHIP_R, s.y + s.vy * dt));
      s.a = i.aim ?? s.a;
      s.cd -= dt; s.inv -= dt; s.rapid -= dt; s.shield -= dt;
      if (i.fire && s.cd <= 0) {
        s.cd = s.rapid > 0 ? 0.08 : 0.18;
        this.shots.push({ x: s.x + Math.cos(s.a) * 20, y: s.y + Math.sin(s.a) * 20, vx: Math.cos(s.a) * 720, vy: Math.sin(s.a) * 720, life: 1.1, owner: s });
      }
      for (let k = this.pus.length - 1; k >= 0; k--) {
        const u = this.pus[k];
        if (Math.hypot(u.x - s.x, u.y - s.y) < 26) { s[u.k] = u.k === 'shield' ? 999 : 8; this.pus.splice(k, 1); this.room.send(s.p, { t: 'fx', k: 'pu', pu: u.k, x: 0, y: 0 }); }
      }
    }
    // Asteroiden (Wrap-around)
    for (const r of this.rocks) {
      r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.spin * dt;
      if (r.x < -60) r.x = W + 60; if (r.x > W + 60) r.x = -60; if (r.y < -60) r.y = H + 60; if (r.y > H + 60) r.y = -60;
      for (const s of this.ships.values()) if (s.alive && Math.hypot(s.x - r.x, s.y - r.y) < r.r + SHIP_R * 0.7) this.hitShip(s);
    }
    // Drohnen
    for (const d of this.drones) {
      const t = this.nearestShip(d.x, d.y);
      if (t) {
        const a = Math.atan2(t.y - d.y, t.x - d.x), dist = Math.hypot(t.x - d.x, t.y - d.y);
        const want = dist > 260 ? 1 : -0.6;
        d.vx += Math.cos(a) * 260 * want * dt; d.vy += Math.sin(a) * 260 * want * dt;
        d.cd -= dt;
        if (d.cd <= 0 && dist < 650) { d.cd = Math.max(0.8, 2 - this.wave * 0.08); this.eshots.push({ x: d.x, y: d.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, life: 3 }); }
      }
      d.vx *= Math.pow(0.4, dt); d.vy *= Math.pow(0.4, dt);
      d.x = Math.max(-30, Math.min(W + 30, d.x + d.vx * dt)); d.y = Math.max(-30, Math.min(H + 30, d.y + d.vy * dt));
      d.a = t ? Math.atan2(t.y - d.y, t.x - d.x) : 0;
      for (const s of this.ships.values()) if (s.alive && Math.hypot(s.x - d.x, s.y - d.y) < 30) this.hitShip(s);
    }
    // Schüsse
    for (let k = this.shots.length - 1; k >= 0; k--) {
      const b = this.shots[k];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let hit = b.life <= 0;
      for (let j = this.rocks.length - 1; j >= 0 && !hit; j--) {
        const r = this.rocks[j];
        if (Math.hypot(r.x - b.x, r.y - b.y) < r.r) {
          hit = true;
          if (--r.hp <= 0) {
            this.rocks.splice(j, 1);
            b.owner.p.score += r.size === 3 ? 20 : r.size === 2 ? 50 : 100;
            if (r.size > 1) for (let n = 0; n < 2; n++) this.rock(r.x, r.y, r.size - 1);
            if (Math.random() < 0.08) this.pus.push({ x: r.x, y: r.y, k: Math.random() < 0.5 ? 'rapid' : 'shield', life: 12 });
            this.room.broadcast({ t: 'fx', k: 'rock', x: Math.round(r.x), y: Math.round(r.y), s: r.size });
          } else this.room.broadcast({ t: 'fx', k: 'chip', x: Math.round(b.x), y: Math.round(b.y) });
        }
      }
      for (let j = this.drones.length - 1; j >= 0 && !hit; j--) {
        const d = this.drones[j];
        if (Math.hypot(d.x - b.x, d.y - b.y) < 24) {
          hit = true;
          if (--d.hp <= 0) { this.drones.splice(j, 1); b.owner.p.score += 150; this.room.broadcast({ t: 'fx', k: 'drone', x: Math.round(d.x), y: Math.round(d.y) }); }
          else this.room.broadcast({ t: 'fx', k: 'chip', x: Math.round(b.x), y: Math.round(b.y) });
        }
      }
      if (hit || b.x < 0 || b.y < 0 || b.x > W || b.y > H) this.shots.splice(k, 1);
    }
    for (let k = this.eshots.length - 1; k >= 0; k--) {
      const b = this.eshots[k];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let hit = b.life <= 0;
      for (const s of this.ships.values()) if (!hit && s.alive && Math.hypot(s.x - b.x, s.y - b.y) < SHIP_R) { this.hitShip(s); hit = true; }
      if (hit) this.eshots.splice(k, 1);
    }
    for (let k = this.pus.length - 1; k >= 0; k--) if ((this.pus[k].life -= dt) <= 0) this.pus.splice(k, 1);
  }

  state() {
    const r = this.u.r1;
    return {
      ph: this.phase, wave: this.wave, lives: this.lives,
      sh: [...this.ships.values()].map((s) => [s.p.id, s.alive ? 1 : 0, r(s.x), r(s.y), Math.round(s.a * 100) / 100, s.inv > 0 ? 1 : 0, s.shield > 0 ? 1 : 0, s.rapid > 0 ? 1 : 0, Math.hypot(s.vx, s.vy) > 60 ? 1 : 0]),
      rk: this.rocks.map((x) => [x.id, r(x.x), r(x.y), x.size, Math.round(x.rot * 100) / 100, x.seed]),
      dr: this.drones.map((d) => [d.id, r(d.x), r(d.y), Math.round(d.a * 100) / 100]),
      bs: this.shots.map((b) => [r(b.x), r(b.y)]),
      es: this.eshots.map((b) => [r(b.x), r(b.y)]),
      pu: this.pus.map((u) => [r(u.x), r(u.y), u.k]),
    };
  }
}
