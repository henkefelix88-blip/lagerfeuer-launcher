/**
 * Vier in Reihe – Client. Klick auf eine Spalte (oder ←/→ und Leertaste) wirft einen Stein ein.
 */
import { startGame, draw } from 'app://sdk/client.js';

const S = { cols: 7, rows: 6, b: '', ph: 'wait', turn: 0, seats: [0, 0], left: 0, q: [], line: null, winner: 0, anim: [], cursor: 3, layout: null };
const SEAT_COLORS = ['#e2534a', '#ffd25a'];

let ctx;
ctx = await startGame({
  title: 'Vier in Reihe',
  help: [['Maus-Klick', 'Stein einwerfen'], ['← / →', 'Spalte wählen'], ['Leertaste / Enter', 'Einwerfen']],
  music: [[131, 262, 330, 392], [147, 294, 349, 440], [117, 233, 294, 349], [131, 262, 330, 392]],
  onWelcome(m, c) { ctx = c; S.cols = m.cols; S.rows = m.rows; },
  onMessage(m, c) {
    ctx = c;
    if (m.t === 's') Object.assign(S, { b: m.b, ph: m.ph, turn: m.turn, seats: m.seats, left: m.left, q: m.q, line: m.line, winner: m.winner });
    else if (m.t === 'drop') { S.anim.push({ col: m.col, row: m.row, who: m.who, y: -1, v: 0 }); ctx.sfx.tone(300 + m.row * 40, 0.08, 'square', 0.15); }
    else if (m.t === 'over') {
      const name = m.winner ? ctx.players.get(m.winner)?.name : null;
      ctx.toast(name ? `${name} gewinnt!` : m.reason || 'Unentschieden');
      if (m.winner === ctx.myId) ctx.sfx.chord([523, 659, 784, 1046], 0.25); else if (m.winner) ctx.sfx.tone(300, 0.4, 'sawtooth', 0.15, 150);
    } else if (m.t === 'start') ctx.sfx.chord([440, 550]);
  },
  onFrame,
  debug: () => ({ phase: S.ph, seats: S.seats.filter(Boolean).length }),
});

function onFrame(dt) {
  const g = ctx.g, W = ctx.width, H = ctx.height;
  const cell = Math.floor(Math.min((W - 360) / S.cols, (H - 180) / S.rows));
  const bw = cell * S.cols, bh = cell * S.rows, bx = (W - bw) / 2 - 120, by = (H - bh) / 2 + 40;
  const mySeat = S.seats.indexOf(ctx.myId);
  const myTurn = S.ph === 'play' && mySeat === S.turn;
  // Eingabe
  const hover = Math.floor((ctx.mouse.x - bx) / cell);
  if (hover >= 0 && hover < S.cols) S.cursor = hover;
  if (ctx.pressed('ArrowLeft', 'KeyA')) S.cursor = Math.max(0, S.cursor - 1);
  if (ctx.pressed('ArrowRight', 'KeyD')) S.cursor = Math.min(S.cols - 1, S.cursor + 1);
  if (myTurn && (ctx.pressed('Space', 'Enter') || (ctx.mouse.clicked && hover >= 0 && hover < S.cols))) ctx.send({ t: 'drop', col: S.cursor });

  g.fillStyle = '#1b222c'; g.fillRect(0, 0, W, H);
  // Vorschau-Stein über dem Brett
  if (myTurn) { g.globalAlpha = 0.6 + Math.sin(ctx.time * 6) * 0.2; draw.hex(g, bx + S.cursor * cell + cell / 2, by - cell * 0.55, cell * 0.38, SEAT_COLORS[mySeat]); g.globalAlpha = 1; }
  // gefallene Steine (hinter dem Brett) mit Fall-Animation
  const animating = new Set();
  for (let i = S.anim.length - 1; i >= 0; i--) {
    const a = S.anim[i];
    a.v += 40 * dt; a.y += a.v * dt;
    if (a.y >= a.row) { a.y = a.row; if (!a.done) { a.done = true; } if (a.v > 0.5 && !a.bounced) { a.bounced = true; a.v = -a.v * 0.25; } else S.anim.splice(i, 1); }
    animating.add(a.col + a.row * S.cols);
    draw.hex(g, bx + a.col * cell + cell / 2, by + a.y * cell + cell / 2, cell * 0.4, SEAT_COLORS[a.who - 1]);
  }
  for (let y = 0; y < S.rows; y++) for (let x = 0; x < S.cols; x++) {
    const v = Number(S.b[y * S.cols + x] || 0);
    if (!v || animating.has(x + y * S.cols)) continue;
    const cx = bx + x * cell + cell / 2, cy = by + y * cell + cell / 2;
    draw.hex(g, cx, cy, cell * 0.4, SEAT_COLORS[v - 1]);
    draw.hex(g, cx - cell * 0.06, cy - cell * 0.06, cell * 0.22, draw.shade(SEAT_COLORS[v - 1], 0.15));
  }
  // Brett mit Löchern (evenodd)
  g.beginPath();
  g.rect(bx - 12, by - 12, bw + 24, bh + 24);
  for (let y = 0; y < S.rows; y++) for (let x = 0; x < S.cols; x++) { const cx = bx + x * cell + cell / 2, cy = by + y * cell + cell / 2; g.moveTo(cx + cell * 0.36, cy); g.arc(cx, cy, cell * 0.36, 0, Math.PI * 2, true); }
  g.fillStyle = '#3d6fd6'; g.fill('evenodd');
  g.fillStyle = '#2f58b0'; g.fillRect(bx - 12, by + bh + 12, bw + 24, 14);
  g.fillRect(bx - 30, by + bh + 26, 40, 30); g.fillRect(bx + bw - 10, by + bh + 26, 40, 30);
  if (S.line) { g.strokeStyle = '#fff'; g.lineWidth = 6; g.beginPath(); S.line.forEach(([x, y], i) => { const cx = bx + x * cell + cell / 2, cy = by + y * cell + cell / 2; i ? g.lineTo(cx, cy) : g.moveTo(cx, cy); }); g.stroke(); }
  // Seitenleiste
  const sx = bx + bw + 60;
  draw.panel(g, sx, by, 240, 230);
  draw.text(g, 'AM BRETT', sx + 16, by + 22, { size: 11, align: 'left', color: '#b9c3cf' });
  S.seats.forEach((id, i) => {
    const p = ctx.players.get(id);
    draw.hex(g, sx + 30, by + 58 + i * 46, 14, SEAT_COLORS[i]);
    draw.text(g, p ? `${p.name}${id === ctx.myId ? ' (du)' : ''}` : 'frei …', sx + 54, by + 52 + i * 46, { size: 14, align: 'left', color: S.ph === 'play' && S.turn === i ? '#ffd25a' : '#fff' });
    draw.text(g, p ? `${p.score} Siege` : '', sx + 54, by + 70 + i * 46, { size: 11, align: 'left', color: '#9aa7b8', shadow: false });
  });
  const turnName = ctx.players.get(S.seats[S.turn])?.name;
  draw.text(g, S.ph === 'play' ? (myTurn ? `Du bist dran! (${S.left} s)` : `${turnName} ist dran … (${S.left} s)`) : S.ph === 'over' ? (S.winner ? `${ctx.players.get(S.winner)?.name} gewinnt!` : 'Unentschieden') : 'Warte auf Gegner …', sx + 120, by + 170, { size: 15, color: myTurn ? '#6abf4b' : '#fff' });
  if (S.q.length) {
    draw.text(g, `Warteschlange: ${S.q.map((id) => ctx.players.get(id)?.name || '?').join(', ')}`, sx + 120, by + 205, { size: 11, color: '#9aa7b8', shadow: false });
  }
  if (mySeat < 0) draw.text(g, 'Du schaust zu – du bist nach diesem Spiel dran.', W / 2, 40, { size: 16, color: '#b9c3cf' });
}
