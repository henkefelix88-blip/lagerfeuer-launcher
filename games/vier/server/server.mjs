/**
 * Vier in Reihe – Host-Server (rundenbasiert). Zwei Spieler am Brett, weitere schauen zu und kommen
 * danach dran (der Gewinner bleibt sitzen). Bots spielen mit Minimax + Alpha-Beta-Suche.
 */
const COLS = 7, ROWS = 6, TURN_TIME = 30;

export async function createServer(opts) {
  return opts.sdk.createRoom(opts, new FourGame(), { tickRate: 10, version: 1, maxPlayers: 8 });
}

function winLine(b, who) {
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) for (const [dx, dy] of dirs) {
    const line = [];
    for (let k = 0; k < 4; k++) { const xx = x + dx * k, yy = y + dy * k; if (xx < 0 || yy < 0 || xx >= COLS || yy >= ROWS || b[yy][xx] !== who) break; line.push([xx, yy]); }
    if (line.length === 4) return line;
  }
  return null;
}
const dropRow = (b, c) => { for (let y = ROWS - 1; y >= 0; y--) if (!b[y][c]) return y; return -1; };

/** Bewertung einer Stellung aus Sicht von "me" (Fenster mit 4 Feldern zählen). */
function score(b, me, op) {
  let s = 0;
  for (let y = 0; y < ROWS; y++) if (b[y][3] === me) s += 3;
  const win = (cells) => {
    const m = cells.filter((v) => v === me).length, o = cells.filter((v) => v === op).length, e = cells.filter((v) => !v).length;
    if (m === 4) return 1000; if (m === 3 && e === 1) return 6; if (m === 2 && e === 2) return 2; if (o === 3 && e === 1) return -8; return 0;
  };
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    const cells = [];
    for (let k = 0; k < 4; k++) { const xx = x + dx * k, yy = y + dy * k; if (xx < 0 || yy < 0 || xx >= COLS || yy >= ROWS) break; cells.push(b[yy][xx]); }
    if (cells.length === 4) s += win(cells);
  }
  return s;
}
function minimax(b, depth, alpha, beta, maxing, me, op) {
  if (winLine(b, me)) return [null, 100000 + depth];
  if (winLine(b, op)) return [null, -100000 - depth];
  const moves = [3, 2, 4, 1, 5, 0, 6].filter((c) => dropRow(b, c) >= 0);
  if (!moves.length) return [null, 0];
  if (depth === 0) return [null, score(b, me, op)];
  let best = moves[0], val = maxing ? -Infinity : Infinity;
  for (const c of moves) {
    const y = dropRow(b, c);
    b[y][c] = maxing ? me : op;
    const [, v] = minimax(b, depth - 1, alpha, beta, !maxing, me, op);
    b[y][c] = 0;
    if (maxing ? v > val : v < val) { val = v; best = c; }
    if (maxing) alpha = Math.max(alpha, val); else beta = Math.min(beta, val);
    if (alpha >= beta) break;
  }
  return [best, val];
}

class FourGame {
  constructor() { this.queue = []; this.seats = [null, null]; this.reset(); }
  init(opts) { for (let i = 0; i < Math.min(1, opts.bots ?? 0); i++) this.room.addBot(); }
  reset() { this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(0)); this.turn = 0; this.winner = null; this.line = null; this.phase = 'wait'; this.turnEnd = 0; this.last = null; }
  welcome() { return { cols: COLS, rows: ROWS }; }

  onJoin(p) { this.queue.push(p); this.fill(); }
  onLeave(p) {
    this.queue = this.queue.filter((q) => q !== p);
    const seat = this.seats.indexOf(p);
    if (seat >= 0) {
      this.seats[seat] = null;
      if (this.phase === 'play') { this.end(this.seats[1 - seat], 'Gegner hat das Spiel verlassen'); }
    }
    this.fill();
  }
  fill() {
    for (let i = 0; i < 2; i++) if (!this.seats[i] && this.queue.length) this.seats[i] = this.queue.shift();
    if (this.phase === 'wait' && this.seats[0] && this.seats[1]) this.start();
  }
  start() {
    const keep = this.seats.slice();
    this.reset();
    this.seats = keep;
    this.phase = 'play';
    this.turn = Math.random() < 0.5 ? 0 : 1;
    this.turnEnd = this.room.time + TURN_TIME;
    this.botAt = this.room.time + 0.9;
    this.room.broadcast({ t: 'start' });
  }
  onMessage(p, m) {
    if (m.t === 'drop' && this.phase === 'play' && this.seats[this.turn] === p) this.drop(m.col | 0);
  }
  drop(c) {
    if (c < 0 || c >= COLS) return;
    const y = dropRow(this.board, c);
    if (y < 0) return;
    const who = this.turn + 1;
    this.board[y][c] = who;
    this.last = [c, y];
    this.room.broadcast({ t: 'drop', col: c, row: y, who });
    const line = winLine(this.board, who);
    if (line) { this.line = line; return this.end(this.seats[this.turn]); }
    if (this.board[0].every(Boolean)) return this.end(null, 'Unentschieden');
    this.turn = 1 - this.turn;
    this.turnEnd = this.room.time + TURN_TIME;
    this.botAt = this.room.time + 0.6 + Math.random() * 0.6;
  }
  end(winner, reason) {
    this.phase = 'over';
    this.winner = winner;
    this.overEnd = this.room.time + 4;
    if (winner) { winner.score++; this.room.sendScores(); }
    this.room.broadcast({ t: 'over', winner: winner?.id ?? null, reason: reason || null, line: this.line });
  }
  tick(dt, time) {
    if (this.phase === 'play') {
      const p = this.seats[this.turn];
      if (p?.bot && time >= this.botAt) {
        const [col] = minimax(this.board.map((r) => r.slice()), 5, -Infinity, Infinity, true, this.turn + 1, 2 - this.turn);
        this.drop(col ?? [3, 2, 4, 1, 5, 0, 6].find((c) => dropRow(this.board, c) >= 0));
      } else if (time >= this.turnEnd) {
        this.drop([3, 2, 4, 1, 5, 0, 6].find((c) => dropRow(this.board, c) >= 0)); // Zeit abgelaufen → automatischer Zug
      }
    } else if (this.phase === 'over' && time >= this.overEnd) {
      // Gewinner bleibt, Verlierer stellt sich hinten an
      const loser = this.winner ? this.seats.find((s) => s && s !== this.winner) : this.seats[1];
      if (loser && this.queue.length) { this.seats[this.seats.indexOf(loser)] = null; this.queue.push(loser); }
      this.phase = 'wait';
      this.fill();
      if (this.phase === 'wait' && this.seats[0] && this.seats[1]) this.start();
    }
  }
  state() {
    return {
      b: this.board.map((r) => r.join('')).join(''), ph: this.phase, turn: this.turn,
      seats: this.seats.map((s) => s?.id ?? 0), left: Math.max(0, Math.round(this.turnEnd - this.room.time)),
      q: this.queue.map((p) => p.id), last: this.last, line: this.line, winner: this.winner?.id ?? 0,
    };
  }
}
