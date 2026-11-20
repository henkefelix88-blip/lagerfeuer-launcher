/**
 * Bombenlabyrinth – Client. Steuerung: Pfeiltasten/WASD laufen, Leertaste/E Bombe legen.
 */
import { startGame, draw, lerp } from 'app://sdk/client.js';

const S = { cols: 15, rows: 13, grid: '', pl: new Map(), bo: [], fl: [], pu: [], ph: 'play', fx: [], winner: undefined, sendT: 0 };
const PU = { bomb: ['#2b2f36', '●'], range: ['#f08c32', '✸'], speed: ['#3fd0c9', '»'] };

let ctx;
ctx = await startGame({
  title: 'Bombenlabyrinth',
  help: [['Pfeile / WASD', 'Laufen'], ['Leertaste / E', 'Bombe legen']],
  music: [[131, 262, 311, 392], [117, 233, 294, 349], [104, 208, 262, 311], [117, 233, 294, 349]],
  onWelcome(m, c) { ctx = c; S.cols = m.cols; S.rows = m.rows; },
  onMessage(m, c) {
    ctx = c;
    if (m.t === 's') {
      S.grid = m.g; S.bo = m.bo; S.fl = m.fl; S.pu = m.pu; S.ph = m.ph;
      const seen = new Set();
      for (const [id, x, y, alive, face, max, range, speed] of m.pl) {
        seen.add(id);
        const p = S.pl.get(id) || { x, y, walk: 0 };
        Object.assign(p, { tx: x, ty: y, alive: !!alive, face, max, range, speed });
        S.pl.set(id, p);
      }
      for (const id of S.pl.keys()) if (!seen.has(id)) S.pl.delete(id);
    } else if (m.t === 'fx') {
      if (m.k === 'drop') ctx.sfx.tone(220, 0.08, 'square', 0.12);
      if (m.k === 'boom') { ctx.sfx.noise(0.6, 1200, 'lowpass', 0.45); ctx.sfx.tone(90, 0.4, 'sine', 0.4, 40); shake = 6; }
      if (m.k === 'pu') { ctx.sfx.chord([660, 880, 1100]); ctx.toast({ bomb: '+1 Bombe', range: '+1 Reichweite', speed: 'Schneller!' }[m.pu]); }
      if (m.k === 'die') { const p = S.pl.get(m.id); if (p) for (let i = 0; i < 16; i++) S.fx.push({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, life: 0.8, color: ctx.players.get(m.id)?.color || '#fff' }); ctx.sfx.tone(500, 0.5, 'sawtooth', 0.2, 100); }
    } else if (m.t === 'over') {
      S.winner = m.winner;
      const name = m.winner ? ctx.players.get(m.winner)?.name : null;
      ctx.toast(name ? `${name} gewinnt die Runde!` : 'Unentschieden!');
      if (m.winner === ctx.myId) ctx.sfx.chord([523, 659, 784, 1046], 0.25);
    } else if (m.t === 'round') { S.winner = undefined; }
  },
  onFrame,
  debug: () => ({ players: S.pl.size, crates: (S.grid.match(/x/g) || []).length }),
});
let shake = 0;

function onFrame(dt) {
  const g = ctx.g, W = ctx.width, H = ctx.height;
  S.sendT -= dt;
  if (S.sendT <= 0) {
    S.sendT = 1 / 30;
    ctx.send({ t: 'in', keys: { up: ctx.down('ArrowUp', 'KeyW'), down: ctx.down('ArrowDown', 'KeyS'), left: ctx.down('ArrowLeft', 'KeyA'), right: ctx.down('ArrowRight', 'KeyD'), fire: ctx.pressed('Space', 'KeyE') } });
  }
  const T = Math.floor(Math.min((W - 40) / S.cols, (H - 90) / S.rows));
  const ox = (W - T * S.cols) / 2 + (Math.random() - 0.5) * shake, oy = 70 + (H - 90 - T * S.rows) / 2 + (Math.random() - 0.5) * shake;
  shake = Math.max(0, shake - dt * 30);
  g.fillStyle = '#26301f'; g.fillRect(0, 0, W, H);
  if (!S.grid) return;
  g.save(); g.translate(ox, oy);
  // Boden
  for (let y = 0; y < S.rows; y++) for (let x = 0; x < S.cols; x++) { g.fillStyle = (x + y) % 2 ? '#7fbf5a' : '#74b450'; g.fillRect(x * T, y * T, T, T); }
  // Power-Ups
  for (const [x, y, k] of S.pu) { draw.hex(g, x * T + T / 2, y * T + T / 2, T * 0.36, '#fff'); draw.hex(g, x * T + T / 2, y * T + T / 2, T * 0.3, PU[k][0]); draw.text(g, PU[k][1], x * T + T / 2, y * T + T / 2, { size: T * 0.36, shadow: false }); }
  // Flammen
  for (const [x, y] of S.fl) {
    g.fillStyle = '#ff8a2a'; g.fillRect(x * T + 2, y * T + 2, T - 4, T - 4);
    g.fillStyle = '#ffd25a'; g.fillRect(x * T + T * 0.2, y * T + T * 0.2, T * 0.6, T * 0.6);
    g.fillStyle = '#fff6d0'; g.fillRect(x * T + T * 0.38, y * T + T * 0.38, T * 0.24, T * 0.24);
  }
  // Säulen & Kisten (mit Seitenflächen)
  for (let y = 0; y < S.rows; y++) for (let x = 0; x < S.cols; x++) {
    const c = S.grid[y * S.cols + x];
    if (c === '#') { g.fillStyle = '#5d6068'; g.fillRect(x * T, y * T + 4, T, T); g.fillStyle = '#9aa0a8'; g.fillRect(x * T, y * T, T, T - 6); g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x * T + 4, y * T + 4, T - 12, 5); }
    else if (c === 'x') {
      g.fillStyle = '#7a5230'; g.fillRect(x * T + 2, y * T + 5, T - 4, T - 6);
      g.fillStyle = '#c99556'; g.fillRect(x * T + 2, y * T + 2, T - 4, T - 9);
      g.strokeStyle = '#8a5a2e'; g.lineWidth = 3; g.strokeRect(x * T + 4, y * T + 4, T - 8, T - 13);
      g.beginPath(); g.moveTo(x * T + 5, y * T + T - 10); g.lineTo(x * T + T - 5, y * T + 5); g.stroke();
    }
  }
  // Bomben
  for (const [x, y, t] of S.bo) {
    const pulse = 1 + Math.sin(ctx.time * (12 - t * 3)) * 0.08;
    const cx = x * T + T / 2, cy = y * T + T / 2 + 2;
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(cx + 3, cy + T * 0.3, T * 0.32, T * 0.12, 0, 0, 7); g.fill();
    g.fillStyle = '#23272d'; g.beginPath(); g.arc(cx, cy, T * 0.34 * pulse, 0, 7); g.fill();
    g.fillStyle = '#4a5260'; g.beginPath(); g.arc(cx - T * 0.1, cy - T * 0.1, T * 0.1, 0, 7); g.fill();
    g.strokeStyle = '#a0703f'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx + T * 0.15, cy - T * 0.28); g.lineTo(cx + T * 0.28, cy - T * 0.42); g.stroke();
    if (Math.random() < 0.7) draw.hex(g, cx + T * 0.3, cy - T * 0.45, 3 + Math.random() * 3, Math.random() < 0.5 ? '#ffd25a' : '#ff8a2a');
  }
  // Spieler
  for (const [id, p] of S.pl) {
    const k = Math.min(1, dt * 18);
    const moved = Math.hypot(p.tx - p.x, p.ty - p.y);
    p.x = lerp(p.x, p.tx, k); p.y = lerp(p.y, p.ty, k);
    p.walk += moved * 25;
    if (!p.alive) continue;
    const info = ctx.players.get(id) || { color: '#ccc', name: '?' };
    const cx = p.x * T + T / 2, cy = p.y * T + T / 2 - Math.abs(Math.sin(p.walk)) * 4;
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(cx, p.y * T + T * 0.85, T * 0.3, T * 0.1, 0, 0, 7); g.fill();
    g.fillStyle = draw.shade(info.color, -0.15); g.fillRect(cx - T * 0.2, cy + T * 0.12, T * 0.14, T * 0.22); g.fillRect(cx + T * 0.06, cy + T * 0.12, T * 0.14, T * 0.22);
    g.fillStyle = info.color; g.beginPath(); g.arc(cx, cy, T * 0.32, 0, 7); g.fill();
    g.fillStyle = '#f4e3c8'; g.beginPath(); g.arc(cx, cy - T * 0.02, T * 0.2, 0, 7); g.fill();
    const fx = [0, 1, 0, -1][p.face] * T * 0.06, fy = [-1, 0, 1, 0][p.face] * T * 0.04;
    if (p.face !== 0) { g.fillStyle = '#1b222c'; g.fillRect(cx - T * 0.1 + fx, cy - T * 0.06 + fy, T * 0.05, T * 0.08); g.fillRect(cx + T * 0.05 + fx, cy - T * 0.06 + fy, T * 0.05, T * 0.08); }
    g.fillStyle = draw.shade(info.color, 0.2); g.beginPath(); g.arc(cx, cy - T * 0.3, T * 0.08, 0, 7); g.fill();
    draw.text(g, info.name, cx, cy - T * 0.55, { size: Math.max(10, T * 0.24), color: id === ctx.myId ? '#ffd25a' : '#fff' });
  }
  for (let i = S.fx.length - 1; i >= 0; i--) {
    const f = S.fx[i]; f.life -= dt; if (f.life <= 0) { S.fx.splice(i, 1); continue; }
    f.x += f.vx * dt; f.y += f.vy * dt;
    g.globalAlpha = f.life; draw.hex(g, f.x * T + T / 2, f.y * T + T / 2, T * 0.12, f.color); g.globalAlpha = 1;
  }
  g.restore();
  // HUD oben
  const me = S.pl.get(ctx.myId);
  draw.panel(g, 16, 12, W - 32, 46);
  if (me) draw.text(g, `● ${me.max}   ✸ ${me.range}   » ${me.speed.toFixed(1)}`, 32, 35, { size: 16, align: 'left' });
  let xx = W - 30;
  for (const p of [...ctx.players.values()].sort((a, b) => a.score - b.score)) {
    const txt = `${p.name}: ${p.score}`;
    g.font = '800 13px Segoe UI'; const w = g.measureText(txt).width;
    draw.text(g, txt, xx, 35, { size: 13, align: 'right', color: p.id === ctx.myId ? '#ffd25a' : p.color, shadow: false });
    xx -= w + 22;
  }
  if (S.ph === 'over') {
    const name = S.winner ? ctx.players.get(S.winner)?.name : null;
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, H / 2 - 50, W, 100);
    draw.text(g, name ? `${name} gewinnt!` : 'Unentschieden!', W / 2, H / 2 - 8, { size: 40 });
    draw.text(g, 'Nächste Runde startet gleich …', W / 2, H / 2 + 28, { size: 16, color: '#b9c3cf' });
  } else if (me && !me.alive) draw.text(g, 'Erwischt! Warte auf die nächste Runde …', W / 2, H - 30, { size: 18 });
}
