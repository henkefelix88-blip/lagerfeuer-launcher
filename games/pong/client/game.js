/**
 * Viereck-Pong – Client. Die eigene Seite ist immer unten. Steuerung: A/D oder Pfeil links/rechts.
 */
import { startGame, draw, lerp } from 'app://sdk/client.js';

const S = { size: 600, pad: 110, sides: [0, 0, 0, 0], balls: [], ph: 'wait', trails: [[], []], fx: [], view: 0, q: 0, winner: undefined, sendT: 0 };
const ROT = [0, -Math.PI / 2, Math.PI, Math.PI / 2];

let ctx;
ctx = await startGame({
  title: 'Viereck-Pong',
  help: [['A / D, ← / →', 'Schläger bewegen']],
  music: [[110, 220, 330, 440], [98, 196, 294, 392], [87, 174, 262, 349], [98, 196, 294, 392]],
  onWelcome(m, c) { ctx = c; S.size = m.size; S.pad = m.pad; },
  onMessage(m, c) {
    ctx = c;
    if (m.t === 's') {
      S.ph = m.ph; S.q = m.q;
      S.sides = m.sd.map((s, i) => (s ? { id: s[0], pos: s[1], lives: s[2], shown: S.sides[i]?.shown ?? s[1] } : null));
      S.balls = m.bl;
      const mine = S.sides.findIndex((s) => s?.id === ctx.myId);
      if (mine >= 0) S.view = mine;
    } else if (m.t === 'fx') {
      if (m.k === 'hit') ctx.sfx.tone(m.side === S.view ? 660 : 520, 0.06, 'square', 0.15);
      if (m.k === 'wall') ctx.sfx.tone(330, 0.05, 'square', 0.1);
      if (m.k === 'goal') {
        ctx.sfx.tone(m.id === ctx.myId ? 160 : 880, 0.3, 'sawtooth', 0.15, m.id === ctx.myId ? 80 : 1200);
        S.fx.push({ side: m.side, t: 0.6 });
        if (m.lives === 0) ctx.toast(`${ctx.players.get(m.id)?.name || '?'} ist raus!`);
      }
    } else if (m.t === 'over') {
      S.winner = m.winner;
      if (m.winner === ctx.myId) ctx.sfx.chord([523, 659, 784, 1046], 0.25);
    } else if (m.t === 'start') { S.winner = undefined; ctx.sfx.chord([440, 660]); }
  },
  onFrame,
  debug: () => ({ balls: S.balls.length, sides: S.sides.filter(Boolean).length }),
});

function onFrame(dt) {
  const g = ctx.g, W = ctx.width, H = ctx.height;
  S.sendT -= dt;
  if (S.sendT <= 0) {
    S.sendT = 1 / 40;
    ctx.send({ t: 'in', dir: (ctx.down('KeyD', 'ArrowRight') ? 1 : 0) - (ctx.down('KeyA', 'ArrowLeft') ? 1 : 0) });
  }
  g.fillStyle = '#161c24'; g.fillRect(0, 0, W, H);
  const scale = Math.min(W, H) * 0.82 / S.size;
  g.save();
  g.translate(W / 2, H / 2 + 10);
  g.rotate(ROT[S.view]);
  g.scale(scale, scale);
  g.translate(-S.size / 2, -S.size / 2);
  const N = S.size, P = S.pad;
  // Spielfeld
  g.fillStyle = '#1f2833'; g.fillRect(-14, -14, N + 28, N + 28);
  g.fillStyle = '#243041'; g.fillRect(0, 0, N, N);
  g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 2;
  for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(i * N / 6, 0); g.lineTo(i * N / 6, N); g.moveTo(0, i * N / 6); g.lineTo(N, i * N / 6); g.stroke(); }
  draw.hex(g, N / 2, N / 2, 60, 'rgba(240,140,50,.12)');
  // Seiten: Wand oder Schläger
  const geo = [[0, N, N, 14, true], [-14, 0, 14, N, false], [0, -14, N, 14, true], [N, 0, 14, N, false]];
  S.sides.forEach((s, i) => {
    const [x, y, w, h, horiz] = geo[i];
    const flash = S.fx.find((f) => f.side === i);
    if (!s || s.lives <= 0) { g.fillStyle = flash ? '#e2534a' : '#5d6068'; g.fillRect(x, y, w, h); return; }
    const info = ctx.players.get(s.id) || { color: '#ccc', name: '?' };
    s.shown = lerp(s.shown, s.pos, Math.min(1, dt * 25));
    g.fillStyle = flash ? 'rgba(226,83,74,.5)' : 'rgba(255,255,255,.04)'; g.fillRect(x, y, w, h);
    g.fillStyle = info.color;
    if (horiz) g.fillRect(s.shown - P / 2, i === 0 ? N - 18 : 4, P, 14); else g.fillRect(i === 1 ? 4 : N - 18, s.shown - P / 2, 14, P);
    g.fillStyle = 'rgba(255,255,255,.35)';
    if (horiz) g.fillRect(s.shown - P / 2, i === 0 ? N - 18 : 4, P, 4); else g.fillRect(i === 1 ? 4 : N - 18, s.shown - P / 2, 4, P);
  });
  // Bälle mit Schweif
  S.balls.forEach(([x, y, wait], k) => {
    const tr = S.trails[k] || (S.trails[k] = []);
    tr.push([x, y]); if (tr.length > 10) tr.shift();
    tr.forEach(([tx, ty], j) => { g.globalAlpha = j / tr.length * 0.35; draw.hex(g, tx, ty, 8, '#ffd25a'); });
    g.globalAlpha = wait ? 0.4 + Math.sin(ctx.time * 12) * 0.3 : 1;
    draw.hex(g, x, y, 10, '#fff6d0'); draw.hex(g, x, y, 6, '#ffd25a');
    g.globalAlpha = 1;
  });
  g.restore();
  for (let i = S.fx.length - 1; i >= 0; i--) { S.fx[i].t -= dt; if (S.fx[i].t <= 0) S.fx.splice(i, 1); }
  // Leben (immer in Bildschirmrichtung beschriftet)
  const rel = (i) => (i - S.view + 4) % 4; // 0 unten, 1 links, 2 oben, 3 rechts (aus eigener Sicht)
  const half = S.size * scale / 2;
  S.sides.forEach((s, i) => {
    if (!s) return;
    const info = ctx.players.get(s.id) || { name: '?', color: '#ccc' };
    const r = rel(i);
    const [lx, ly] = [[W / 2, H / 2 + 10 + half + 34], [W / 2 - half - 70, H / 2 + 10], [W / 2, H / 2 + 10 - half - 34], [W / 2 + half + 70, H / 2 + 10]][r];
    draw.text(g, `${info.name}${s.id === ctx.myId ? ' (du)' : ''}`, lx, ly - 10, { size: 13, color: s.id === ctx.myId ? '#ffd25a' : info.color });
    for (let k = 0; k < 5; k++) draw.hex(g, lx - 40 + k * 20, ly + 10, 6, k < s.lives ? info.color : 'rgba(255,255,255,.12)');
  });
  if (S.ph === 'countdown' || S.ph === 'wait') draw.text(g, S.sides.filter(Boolean).length ? 'Gleich geht\'s los …' : 'Warte auf Spieler …', W / 2, H / 2 - 60, { size: 28 });
  if (S.ph === 'over') {
    const name = S.winner ? ctx.players.get(S.winner)?.name : null;
    draw.text(g, name ? `${name} gewinnt!` : 'Match vorbei!', W / 2, H / 2 - 30, { size: 40 });
  }
  if (!S.sides.some((s) => s?.id === ctx.myId)) draw.text(g, `Du schaust zu – du bist im nächsten Match dabei (Warteschlange: ${S.q})`, W / 2, 40, { size: 15, color: '#b9c3cf' });
}
