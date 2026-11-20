/**
 * Bombenlabyrinth – Host-Server. Rasterbasiert: Säulen, Kisten, Bomben mit Kettenreaktion, Power-Ups.
 * Runden: Wer als Letzter übrig bleibt, gewinnt einen Punkt. Bots weichen Explosionen per Breitensuche aus.
 */
const COLS = 15, ROWS = 13, FUSE = 2.4, FLAME = 0.55;
const EMPTY = '.', PILLAR = '#', CRATE = 'x';
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const SPAWNS = [[1, 1], [13, 11], [13, 1], [1, 11], [7, 1], [7, 11], [1, 6], [13, 6]];

export async function createServer(opts) {
  return opts.sdk.createRoom(opts, new BombGame(), { tickRate: 30, version: 1, maxPlayers: 8 });
}

class BombGame {
  constructor() { this.ps = new Map(); this.round = 0; }
  init(opts) { this.newRound(); for (let i = 0; i < (opts.bots ?? 0); i++) this.room.addBot(); }

  newRound() {
    this.round++;
    this.grid = [];
    for (let y = 0; y < ROWS; y++) {
      const row = [];
      for (let x = 0; x < COLS; x++) {
        if (x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || (x % 2 === 0 && y % 2 === 0)) row.push(PILLAR);
        else row.push(Math.random() < 0.68 ? CRATE : EMPTY);
      }
      this.grid.push(row);
    }
    for (const [sx, sy] of SPAWNS) for (const [dx, dy] of [[0, 0], ...DIRS]) if (this.grid[sy + dy]?.[sx + dx] === CRATE) this.grid[sy + dy][sx + dx] = EMPTY;
    this.bombs = []; this.flames = []; this.pus = [];
    this.phase = 'play'; this.phaseEnd = 0;
    let i = 0;
    for (const p of this.ps.values()) this.place(p, i++);
    this.room?.broadcast({ t: 'round', n: this.round });
  }
  place(p, i) {
    const [x, y] = SPAWNS[i % SPAWNS.length];
    Object.assign(p, { x, y, alive: true, max: 1, range: 2, speed: 3.4, dir: [0, 0], face: 2 });
  }

  welcome() { return { cols: COLS, rows: ROWS }; }
  onJoin(pl) {
    const p = { pl, in: [0, 0], bomb: false, ai: pl.bot ? { path: null, t: 0 } : null };
    this.ps.set(pl.id, p);
    this.place(p, this.ps.size - 1);
    // Wer mitten in einer Runde kommt, wartet (außer man ist allein)
    if (this.ps.size > 2 && this.phase === 'play') p.alive = false;
  }
  onLeave(pl) { this.ps.delete(pl.id); }
  onMessage(pl, m) {
    const p = this.ps.get(pl.id);
    if (!p || m.t !== 'in') return;
    const k = m.keys || {};
    p.in = [(k.right ? 1 : 0) - (k.left ? 1 : 0), (k.down ? 1 : 0) - (k.up ? 1 : 0)];
    if (k.fire) p.bomb = true;
  }

  cell(x, y) { return this.grid[y]?.[x] ?? PILLAR; }
  bombAt(x, y) { return this.bombs.find((b) => b.x === x && b.y === y); }
  blocked(x, y, p) {
    const c = this.cell(x, y);
    if (c !== EMPTY) return true;
    const b = this.bombAt(x, y);
    return b && !b.passable.has(p);
  }

  move(p, dt) {
    let [dx, dy] = p.in;
    if (dx && dy) dy = 0;
    if (!dx && !dy) return;
    p.face = dx > 0 ? 1 : dx < 0 ? 3 : dy > 0 ? 2 : 0;
    const step = p.speed * dt;
    const cx = Math.round(p.x), cy = Math.round(p.y);
    if (dx) {
      // erst auf die Zeilenmitte einrasten (Ecken umrunden)
      if (Math.abs(p.y - cy) > 0.05) { const nx = cx + dx; if (!this.blocked(nx, cy, p)) p.y += Math.sign(cy - p.y) * Math.min(step, Math.abs(cy - p.y)); return; }
      p.y = cy;
      const tx = p.x + dx * step;
      const ahead = dx > 0 ? Math.ceil(tx - 0.001) : Math.floor(tx + 0.001);
      if (ahead !== cx && this.blocked(ahead, cy, p)) p.x = cx; else p.x = tx;
    } else {
      if (Math.abs(p.x - cx) > 0.05) { const ny = cy + dy; if (!this.blocked(cx, ny, p)) p.x += Math.sign(cx - p.x) * Math.min(step, Math.abs(cx - p.x)); return; }
      p.x = cx;
      const ty = p.y + dy * step;
      const ahead = dy > 0 ? Math.ceil(ty - 0.001) : Math.floor(ty + 0.001);
      if (ahead !== cy && this.blocked(cx, ahead, p)) p.y = cy; else p.y = ty;
    }
  }

  placeBomb(p) {
    const x = Math.round(p.x), y = Math.round(p.y);
    if (this.bombAt(x, y) || this.bombs.filter((b) => b.owner === p).length >= p.max) return false;
    const passable = new Set();
    for (const q of this.ps.values()) if (q.alive && Math.round(q.x) === x && Math.round(q.y) === y) passable.add(q);
    this.bombs.push({ x, y, t: FUSE, owner: p, range: p.range, passable });
    this.room.broadcast({ t: 'fx', k: 'drop' });
    return true;
  }

  /** Zellen, die eine Bombe treffen würde. */
  blast(b) {
    const cells = [[b.x, b.y]];
    for (const [dx, dy] of DIRS) for (let i = 1; i <= b.range; i++) {
      const x = b.x + dx * i, y = b.y + dy * i, c = this.cell(x, y);
      if (c === PILLAR) break;
      cells.push([x, y]);
      if (c === CRATE) break;
    }
    return cells;
  }

  explode(b) {
    this.bombs.splice(this.bombs.indexOf(b), 1);
    for (const [x, y] of this.blast(b)) {
      this.flames.push({ x, y, t: FLAME });
      if (this.cell(x, y) === CRATE) {
        this.grid[y][x] = EMPTY;
        if (Math.random() < 0.32) this.pus.push({ x, y, k: ['bomb', 'range', 'speed'][Math.floor(Math.random() * 3)] });
      } else this.pus = this.pus.filter((u) => u.x !== x || u.y !== y);
      const other = this.bombAt(x, y);
      if (other) other.t = Math.min(other.t, 0.05); // Kettenreaktion
    }
    this.room.broadcast({ t: 'fx', k: 'boom', x: b.x, y: b.y });
  }

  // ---------- Bots ----------
  dangerMap() {
    const d = new Set();
    for (const f of this.flames) d.add(f.x + f.y * COLS);
    for (const b of this.bombs) for (const [x, y] of this.blast(b)) d.add(x + y * COLS);
    return d;
  }
  bfs(p, sx, sy, goal, danger, avoidDanger = true) {
    const seen = new Set([sx + sy * COLS]);
    const q = [[sx, sy, null]];
    while (q.length) {
      const [x, y, first] = q.shift();
      if (goal(x, y) && (x !== sx || y !== sy)) return first || [x, y];
      if (goal(x, y) && first === null && x === sx && y === sy && !danger.has(x + y * COLS)) return [x, y];
      for (const [dx, dy] of DIRS) {
        const nx = x + dx, ny = y + dy, k = nx + ny * COLS;
        if (seen.has(k) || this.blocked(nx, ny, p) || (avoidDanger && danger.has(k) && !goal(nx, ny))) continue;
        seen.add(k);
        q.push([nx, ny, first || [nx, ny]]);
      }
    }
    return null;
  }
  updateBot(p, dt) {
    const cx = Math.round(p.x), cy = Math.round(p.y);
    const danger = this.dangerMap();
    let next = null;
    if (danger.has(cx + cy * COLS)) {
      next = this.bfs(p, cx, cy, (x, y) => !danger.has(x + y * COLS), danger, false);
    } else {
      const nearCrate = DIRS.some(([dx, dy]) => this.cell(cx + dx, cy + dy) === CRATE);
      const nearEnemy = [...this.ps.values()].some((q) => q !== p && q.alive && Math.hypot(q.x - p.x, q.y - p.y) < 2.2);
      if ((nearCrate || nearEnemy) && Math.random() < 0.08) {
        // nur legen, wenn danach ein Fluchtweg existiert
        const fake = { x: cx, y: cy, range: p.range };
        const d2 = new Set(danger); for (const [x, y] of this.blast(fake)) d2.add(x + y * COLS);
        if (this.bfs(p, cx, cy, (x, y) => !d2.has(x + y * COLS), d2, false)) this.placeBomb(p);
      }
      next = this.bfs(p, cx, cy, (x, y) => this.pus.some((u) => u.x === x && u.y === y) || DIRS.some(([dx, dy]) => this.cell(x + dx, y + dy) === CRATE) || [...this.ps.values()].some((q) => q !== p && q.alive && Math.round(q.x) === x && Math.round(q.y) === y), danger);
    }
    if (next && (next[0] !== cx || next[1] !== cy)) p.in = [Math.sign(next[0] - cx), Math.sign(next[1] - cy)];
    else p.in = [0, 0];
  }

  tick(dt, time) {
    if (this.phase === 'over') { if (time >= this.phaseEnd) this.newRound(); return; }
    for (const p of this.ps.values()) {
      if (!p.alive) continue;
      if (p.ai) this.updateBot(p, dt);
      this.move(p, dt);
      if (p.bomb) { this.placeBomb(p); p.bomb = false; }
      for (let i = this.pus.length - 1; i >= 0; i--) {
        const u = this.pus[i];
        if (Math.round(p.x) === u.x && Math.round(p.y) === u.y) {
          if (u.k === 'bomb') p.max = Math.min(6, p.max + 1); else if (u.k === 'range') p.range = Math.min(8, p.range + 1); else p.speed = Math.min(6, p.speed + 0.5);
          this.pus.splice(i, 1);
          this.room.send(p.pl, { t: 'fx', k: 'pu', pu: u.k });
        }
      }
    }
    for (const b of this.bombs) for (const q of [...b.passable]) if (Math.abs(q.x - b.x) > 0.75 || Math.abs(q.y - b.y) > 0.75) b.passable.delete(q);
    for (const b of [...this.bombs]) { b.t -= dt; if (b.t <= 0 && this.bombs.includes(b)) this.explode(b); }
    for (let i = this.flames.length - 1; i >= 0; i--) { this.flames[i].t -= dt; if (this.flames[i].t <= 0) this.flames.splice(i, 1); }
    for (const p of this.ps.values()) {
      if (!p.alive) continue;
      if (this.flames.some((f) => f.x === Math.round(p.x) && f.y === Math.round(p.y))) {
        p.alive = false;
        this.room.broadcast({ t: 'fx', k: 'die', id: p.pl.id });
      }
    }
    const players = [...this.ps.values()];
    const alive = players.filter((p) => p.alive);
    if ((players.length > 1 && alive.length <= 1) || (players.length === 1 && alive.length === 0)) {
      this.phase = 'over'; this.phaseEnd = time + 3.5;
      const winner = players.length > 1 ? alive[0] : null;
      if (winner) { winner.pl.score++; this.room.sendScores(); }
      this.room.broadcast({ t: 'over', winner: winner?.pl.id ?? null });
    }
  }

  state() {
    return {
      g: this.grid.map((r) => r.join('')).join(''),
      pl: [...this.ps.values()].map((p) => [p.pl.id, Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, p.alive ? 1 : 0, p.face, p.max, p.range, Math.round(p.speed * 10) / 10]),
      bo: this.bombs.map((b) => [b.x, b.y, Math.round(b.t * 10) / 10]),
      fl: this.flames.map((f) => [f.x, f.y]),
      pu: this.pus.map((u) => [u.x, u.y, u.k]),
      ph: this.phase,
    };
  }
}
