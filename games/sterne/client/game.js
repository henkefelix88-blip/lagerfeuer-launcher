/**
 * Sternenjäger – Client. Steuerung: WASD fliegen, Maus zielen, Linksklick/Leertaste feuern.
 */
import { startGame, draw, lerp } from 'app://sdk/client.js';

const S = { w: 1600, h: 1000, ships: new Map(), rocks: new Map(), drones: new Map(), bs: [], es: [], pu: [], wave: 0, lives: 0, ph: 'break', fx: [], stars: [], sendT: 0, banner: null };
for (let i = 0; i < 220; i++) S.stars.push({ x: Math.random() * 1600, y: Math.random() * 1000, z: Math.random(), tw: Math.random() * 6 });
const rockShape = (seed, n = 9) => { const out = []; let s = seed + 1; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; out.push(0.72 + (s / 2147483647) * 0.38); } return out; };

let ctx;
ctx = await startGame({
  title: 'Sternenjäger',
  help: [['WASD', 'Fliegen'], ['Maus', 'Zielen'], ['LMB / Leertaste', 'Feuern']],
  music: [[110, 220, 262, 330], [98, 196, 233, 294], [87, 174, 220, 262], [82, 165, 208, 247]],
  onWelcome(m, c) { ctx = c; S.w = m.w; S.h = m.h; },
  onMessage(m, c) {
    ctx = c;
    if (m.t === 's') {
      S.ph = m.ph; S.wave = m.wave; S.lives = m.lives; S.bs = m.bs; S.es = m.es; S.pu = m.pu;
      sync(S.ships, m.sh, ([id, alive, x, y, a, inv, sh, rapid, thrust]) => ({ id, alive, tx: x, ty: y, a, inv, sh, rapid, thrust }));
      sync(S.rocks, m.rk, ([id, x, y, size, rot, seed]) => ({ id, tx: x, ty: y, size, rot, shape: rockShape(seed) }));
      sync(S.drones, m.dr, ([id, x, y, a]) => ({ id, tx: x, ty: y, a }));
    } else if (m.t === 'fx') {
      if (m.k === 'rock') { boom(m.x, m.y, '#a3a8b0', 10 + m.s * 6, 1); ctx.sfx.noise(0.3 + m.s * 0.1, 900, 'lowpass', 0.3); }
      if (m.k === 'chip') { boom(m.x, m.y, '#ffd25a', 4, 0.5); ctx.sfx.tone(1200, 0.03, 'square', 0.05); }
      if (m.k === 'drone') { boom(m.x, m.y, '#e2534a', 22, 1.4); ctx.sfx.noise(0.5, 1500, 'lowpass', 0.35); }
      if (m.k === 'shipboom') { boom(m.x, m.y, ctx.players.get(m.id)?.color || '#fff', 30, 1.6); ctx.sfx.tone(300, 0.7, 'sawtooth', 0.25, 50); }
      if (m.k === 'shield') ctx.sfx.tone(900, 0.2, 'sine', 0.2, 300);
      if (m.k === 'pu') { ctx.sfx.chord([660, 880, 1100]); ctx.toast(m.pu === 'rapid' ? 'Schnellfeuer!' : 'Schild!'); }
    } else if (m.t === 'wave') { S.banner = { text: `Welle ${m.n}`, t: 2 }; ctx.sfx.chord([330, 440, 550]); }
    else if (m.t === 'cleared') { S.banner = { text: `Welle ${m.n} geschafft! +1 Leben`, t: 2.5 }; }
    else if (m.t === 'gameover') { S.banner = { text: `Game Over – Welle ${m.wave} erreicht`, t: 5 }; ctx.sfx.tone(200, 1, 'sawtooth', 0.2, 60); }
  },
  onFrame,
  debug: () => ({ wave: S.wave, rocks: S.rocks.size, ships: S.ships.size }),
});

function sync(map, list, f) {
  const seen = new Set();
  for (const row of list) {
    const o = f(row); seen.add(o.id);
    const cur = map.get(o.id) || { x: o.tx, y: o.ty };
    if (Math.abs(cur.x - o.tx) > 200 || Math.abs(cur.y - o.ty) > 200) { cur.x = o.tx; cur.y = o.ty; } // Wrap-around
    map.set(o.id, Object.assign(cur, o));
  }
  for (const id of map.keys()) if (!seen.has(id)) map.delete(id);
}
function boom(x, y, color, n, sp) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, v = (50 + Math.random() * 200) * sp; S.fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.5, color, r: 2 + Math.random() * 3 * sp }); } }

function onFrame(dt) {
  const g = ctx.g, W = ctx.width, H = ctx.height;
  const sc = Math.min(W / S.w, H / S.h), ox = (W - S.w * sc) / 2, oy = (H - S.h * sc) / 2;
  const me = S.ships.get(ctx.myId);
  S.sendT -= dt;
  if (S.sendT <= 0 && me) {
    S.sendT = 1 / 30;
    const mx = (ctx.mouse.x - ox) / sc, my = (ctx.mouse.y - oy) / sc;
    ctx.send({ t: 'in', aim: Math.round(Math.atan2(my - me.y, mx - me.x) * 1000) / 1000, keys: { up: ctx.down('KeyW', 'ArrowUp'), down: ctx.down('KeyS', 'ArrowDown'), left: ctx.down('KeyA', 'ArrowLeft'), right: ctx.down('KeyD', 'ArrowRight'), fire: ctx.down('Mouse0', 'Space') } });
  }
  if (me?.alive && ctx.down('Mouse0', 'Space') && Math.random() < dt * 8) ctx.sfx.tone(880 + Math.random() * 100, 0.05, 'square', 0.04, 440);
  g.fillStyle = '#0d1018'; g.fillRect(0, 0, W, H);
  g.save(); g.translate(ox, oy); g.scale(sc, sc);
  // Sterne (Parallaxe zur eigenen Position)
  for (const s of S.stars) {
    const px = ((s.x - (me?.x || 800) * s.z * 0.05) % S.w + S.w) % S.w, py = ((s.y - (me?.y || 500) * s.z * 0.05) % S.h + S.h) % S.h;
    g.globalAlpha = 0.3 + s.z * 0.6 * (0.7 + Math.sin(ctx.time * 2 + s.tw) * 0.3);
    g.fillStyle = s.z > 0.8 ? '#ffd25a' : '#dfe8ff'; g.fillRect(px, py, 1 + s.z * 2, 1 + s.z * 2);
  }
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(127,140,255,.25)'; g.lineWidth = 3; g.strokeRect(0, 0, S.w, S.h);
  const k = Math.min(1, dt * 15);
  // Asteroiden (Low-Poly-Vielecke)
  for (const r of S.rocks.values()) {
    r.x = lerp(r.x, r.tx, k); r.y = lerp(r.y, r.ty, k);
    const R = r.size * 16;
    g.save(); g.translate(r.x, r.y); g.rotate(r.rot);
    g.beginPath(); r.shape.forEach((f, i) => { const a = (i / r.shape.length) * Math.PI * 2; g.lineTo(Math.cos(a) * R * f, Math.sin(a) * R * f); }); g.closePath();
    g.fillStyle = '#7a828c'; g.fill();
    g.beginPath(); g.moveTo(0, 0); for (let i = 0; i < 4; i++) { const a = (i / r.shape.length) * Math.PI * 2; g.lineTo(Math.cos(a) * R * r.shape[i], Math.sin(a) * R * r.shape[i]); } g.closePath();
    g.fillStyle = '#9aa1a9'; g.fill();
    g.fillStyle = '#5d6068'; g.beginPath(); g.arc(R * 0.25, R * 0.2, R * 0.15, 0, 7); g.fill();
    g.restore();
  }
  // Drohnen
  for (const d of S.drones.values()) {
    d.x = lerp(d.x, d.tx, k); d.y = lerp(d.y, d.ty, k);
    g.save(); g.translate(d.x, d.y); g.rotate(d.a);
    draw.hex(g, 0, 0, 20, '#3a2230'); draw.hex(g, 0, 0, 15, '#e2534a');
    g.fillStyle = '#ffd25a'; g.beginPath(); g.arc(6, 0, 5 + Math.sin(ctx.time * 10) * 1.5, 0, 7); g.fill();
    g.fillStyle = '#5d6068'; g.fillRect(-8, -24, 16, 6); g.fillRect(-8, 18, 16, 6);
    g.restore();
  }
  // Power-Ups
  for (const [x, y, k2] of S.pu) { draw.hex(g, x, y, 14, '#1b222c'); draw.hex(g, x, y, 11, k2 === 'rapid' ? '#f08c32' : '#5b8def'); draw.text(g, k2 === 'rapid' ? '»' : 'S', x, y, { size: 12, shadow: false }); }
  // Schüsse
  for (const [x, y] of S.bs) { g.fillStyle = '#ffd25a'; g.fillRect(x - 2, y - 2, 5, 5); }
  for (const [x, y] of S.es) { g.fillStyle = 'rgba(226,83,74,.4)'; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill(); g.fillStyle = '#ff8a8a'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
  // Schiffe
  for (const s of S.ships.values()) {
    s.x = lerp(s.x, s.tx, k); s.y = lerp(s.y, s.ty, k);
    if (!s.alive) continue;
    const info = ctx.players.get(s.id) || { color: '#ccc', name: '?' };
    if (s.inv && Math.floor(ctx.time * 10) % 2) continue;
    g.save(); g.translate(s.x, s.y); g.rotate(s.a);
    if (s.thrust) { g.fillStyle = Math.random() < 0.5 ? '#ffd25a' : '#ff8a2a'; g.beginPath(); g.moveTo(-10, -5); g.lineTo(-20 - Math.random() * 10, 0); g.lineTo(-10, 5); g.fill(); }
    g.fillStyle = draw.shade(info.color, -0.2); g.beginPath(); g.moveTo(20, 0); g.lineTo(-12, -14); g.lineTo(-6, 0); g.lineTo(-12, 14); g.closePath(); g.fill();
    g.fillStyle = info.color; g.beginPath(); g.moveTo(20, 0); g.lineTo(-12, -14); g.lineTo(-6, 0); g.closePath(); g.fill();
    g.fillStyle = '#9fd8ff'; g.beginPath(); g.moveTo(10, 0); g.lineTo(0, -4); g.lineTo(0, 4); g.fill();
    g.restore();
    if (s.sh) { g.strokeStyle = 'rgba(91,141,239,.8)'; g.lineWidth = 2; g.beginPath(); g.arc(s.x, s.y, 24, 0, 7); g.stroke(); }
    draw.text(g, info.name, s.x, s.y - 28, { size: 11, color: s.id === ctx.myId ? '#ffd25a' : '#fff' });
  }
  for (let i = S.fx.length - 1; i >= 0; i--) {
    const p = S.fx[i]; p.life -= dt; if (p.life <= 0) { S.fx.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.95; p.vy *= 0.95;
    g.globalAlpha = Math.min(1, p.life * 2); draw.hex(g, p.x, p.y, p.r, p.color);
  }
  g.globalAlpha = 1;
  g.restore();
  // HUD
  draw.panel(g, 16, 16, 280, 58);
  draw.text(g, `WELLE ${S.wave}`, 30, 32, { size: 12, align: 'left', color: '#b9c3cf' });
  for (let i = 0; i < 6; i++) draw.hex(g, 40 + i * 22, 56, 8, i < S.lives ? '#6abf4b' : '#3a4452');
  draw.text(g, `${ctx.players.get(ctx.myId)?.score ?? 0} Punkte`, 282, 56, { size: 14, align: 'right', color: '#ffd25a' });
  const top = ctx.ranking();
  draw.panel(g, W - 216, 16, 200, 30 + top.length * 20);
  top.forEach((p, i) => { draw.text(g, p.name, W - 204, 36 + i * 20, { size: 12, align: 'left', color: p.id === ctx.myId ? '#ffd25a' : p.color, shadow: false }); draw.text(g, `${p.score}`, W - 28, 36 + i * 20, { size: 12, align: 'right', shadow: false }); });
  if (S.banner) { S.banner.t -= dt; draw.text(g, S.banner.text, W / 2, H * 0.3, { size: 40 }); if (S.banner.t <= 0) S.banner = null; }
  if (me && !me.alive && S.ph !== 'over') draw.text(g, 'Abgeschossen – gleich wieder da …', W / 2, H * 0.6, { size: 20 });
}
