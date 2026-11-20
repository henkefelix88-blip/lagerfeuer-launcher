/**
 * Panzerduell – Client. Steuerung: W/S fahren, A/D drehen (oder Pfeiltasten), Maus zielt, Linksklick/Leertaste schießt.
 */
import { startGame, draw, lerp } from 'app://sdk/client.js';

const S = { map: null, tile: 40, tanks: new Map(), bullets: [], pu: [], fx: [], tracks: [], view: { s: 1, ox: 0, oy: 0 }, sendT: 0 };
const PU = { shield: ['#5b8def', 'S'], triple: ['#f08c32', '3'], fast: ['#3fd0c9', '»'] };

let ctx;
ctx = await startGame({
  title: 'Panzerduell',
  help: [['W / S', 'Vor / Zurück'], ['A / D', 'Drehen'], ['Maus', 'Turm zielen'], ['LMB / Leertaste', 'Feuer']],
  music: [[98, 196, 233, 294], [87, 174, 220, 262], [110, 220, 262, 330], [98, 196, 247, 294]],
  onWelcome(m, c) { ctx = c; S.map = m.map; S.tile = m.tile; },
  onMessage(m, c) {
    ctx = c;
    if (m.t === 's') {
      const seen = new Set();
      for (const [id, alive, x, y, ba, ta, hp, sh, tr, fa] of m.tk) {
        seen.add(id);
        const t = S.tanks.get(id) || { x, y, ba, ta, tread: 0 };
        Object.assign(t, { alive: !!alive, tx: x, ty: y, tba: ba, tta: ta, hp, sh, tr, fa });
        if (!alive) { t.x = x; t.y = y; }
        S.tanks.set(id, t);
      }
      for (const id of S.tanks.keys()) if (!seen.has(id)) S.tanks.delete(id);
      S.bullets = m.bl; S.pu = m.pu;
    } else if (m.t === 'fx') {
      if (m.k === 'shot') { ctx.sfx.noise(0.12, 1800, 'lowpass', 0.25); ctx.sfx.tone(160, 0.1, 'square', 0.1, 60); }
      if (m.k === 'hit') { burst(m.x, m.y, '#ffd25a', 8); ctx.sfx.tone(300, 0.08, 'square', 0.15); }
      if (m.k === 'shield') { burst(m.x, m.y, '#5b8def', 6); ctx.sfx.tone(900, 0.08, 'sine', 0.15); }
      if (m.k === 'boom') { burst(m.x, m.y, '#f08c32', 26, 2); burst(m.x, m.y, '#555', 14, 1.5); ctx.sfx.noise(0.8, 900, 'lowpass', 0.5); ctx.sfx.tone(80, 0.6, 'sine', 0.5, 30); }
      if (m.k === 'pu') { ctx.sfx.chord([660, 880, 1100]); ctx.toast({ shield: 'Schild!', triple: 'Dreifachschuss!', fast: 'Turbo-Ketten!' }[m.pu]); }
    } else if (m.t === 'kill') {
      const k = ctx.players.get(m.k)?.name, v = ctx.players.get(m.v)?.name;
      if (m.k === ctx.myId && m.v !== m.k) ctx.toast(`Du hast ${v} zerstört!`);
      else if (m.v === ctx.myId) ctx.toast(k ? `Zerstört von ${k}` : 'Zerstört!');
    }
  },
  onFrame,
  debug: () => ({ tanks: S.tanks.size }),
});

function burst(x, y, color, n, speed = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28, v = (40 + Math.random() * 160) * speed;
    S.fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.4, max: 0.8, color, r: 3 + Math.random() * 4 * speed });
  }
}

function onFrame(dt) {
  const g = ctx.g, W = ctx.width, H = ctx.height;
  if (!S.map) return;
  const mw = S.map[0].length * S.tile, mh = S.map.length * S.tile;
  const s = Math.min(W / mw, H / mh) * 0.96;
  S.view = { s, ox: (W - mw * s) / 2, oy: (H - mh * s) / 2 };
  const me = S.tanks.get(ctx.myId);
  // Eingabe
  S.sendT -= dt;
  if (S.sendT <= 0 && me) {
    S.sendT = 1 / 30;
    const mx = (ctx.mouse.x - S.view.ox) / s, my = (ctx.mouse.y - S.view.oy) / s;
    ctx.send({ t: 'in', aim: Math.round(Math.atan2(my - me.y, mx - me.x) * 1000) / 1000, keys: {
      up: ctx.down('KeyW', 'ArrowUp'), down: ctx.down('KeyS', 'ArrowDown'), left: ctx.down('KeyA', 'ArrowLeft'), right: ctx.down('KeyD', 'ArrowRight'), fire: ctx.down('Mouse0', 'Space') } });
  }
  g.fillStyle = '#2a3a22'; g.fillRect(0, 0, W, H);
  g.save();
  g.translate(S.view.ox, S.view.oy); g.scale(s, s);
  // Boden
  const T = S.tile;
  for (let y = 0; y < S.map.length; y++) for (let x = 0; x < S.map[0].length; x++) {
    g.fillStyle = (x * 7 + y * 13) % 5 === 0 ? '#9cbf5a' : (x + y) % 2 ? '#a9c862' : '#a3c35e';
    g.fillRect(x * T, y * T, T + 0.5, T + 0.5);
  }
  // Kettenspuren
  for (let i = S.tracks.length - 1; i >= 0; i--) {
    const tr = S.tracks[i]; tr.life -= dt;
    if (tr.life <= 0) { S.tracks.splice(i, 1); continue; }
    g.globalAlpha = tr.life / 6 * 0.35; g.fillStyle = '#5a6a3a';
    g.save(); g.translate(tr.x, tr.y); g.rotate(tr.a); g.fillRect(-3, -14, 6, 5); g.fillRect(-3, 9, 6, 5); g.restore();
  }
  g.globalAlpha = 1;
  // Power-Ups
  for (const [x, y, k] of S.pu) {
    const bob = Math.sin(ctx.time * 4) * 3;
    draw.hex(g, x, y + bob, 15, '#1b222c'); draw.hex(g, x, y + bob, 12, PU[k][0]);
    draw.text(g, PU[k][1], x, y + bob, { size: 14, shadow: false });
  }
  // Panzer
  for (const [id, t] of S.tanks) {
    if (!t.alive) continue;
    const k = Math.min(1, dt * 15);
    const moved = Math.hypot(t.tx - t.x, t.ty - t.y);
    t.x = lerp(t.x, t.tx, k); t.y = lerp(t.y, t.ty, k);
    t.ba += (((t.tba - t.ba + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;
    t.ta += (((t.tta - t.ta + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;
    t.tread += moved * 0.3;
    if (moved > 0.5 && Math.random() < 0.5) S.tracks.push({ x: t.x, y: t.y, a: t.ba, life: 6 });
    drawTank(g, t, ctx.players.get(id), id === ctx.myId);
  }
  // Mauern (über dem Boden, mit Seitenfläche für 3D-Wirkung)
  for (let y = 0; y < S.map.length; y++) for (let x = 0; x < S.map[0].length; x++) {
    if (!S.map[y][x]) continue;
    g.fillStyle = '#5d6068'; g.fillRect(x * T, y * T + 8, T, T);
    g.fillStyle = (x + y) % 2 ? '#8b9099' : '#9aa0a8'; g.fillRect(x * T, y * T, T, T - 4);
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x * T + 4, y * T + 4, T - 18, 6);
  }
  // Geschosse
  for (const [, x, y] of S.bullets) { g.fillStyle = 'rgba(255,180,70,.35)'; g.beginPath(); g.arc(x, y, 8, 0, 7); g.fill(); g.fillStyle = '#ffd25a'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
  // Partikel
  for (let i = S.fx.length - 1; i >= 0; i--) {
    const p = S.fx[i]; p.life -= dt;
    if (p.life <= 0) { S.fx.splice(i, 1); continue; }
    p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92;
    g.globalAlpha = Math.min(1, p.life / p.max * 1.5); draw.hex(g, p.x, p.y, p.r, p.color);
  }
  g.globalAlpha = 1;
  g.restore();
  // HUD
  if (me) {
    draw.panel(ctx.g, 16, 16, 230, 58);
    draw.text(g, 'PANZERUNG', 30, 30, { size: 11, color: '#b9c3cf', align: 'left' });
    for (let i = 0; i < 3; i++) draw.hex(g, 40 + i * 30, 56, 11, i < me.hp ? '#6abf4b' : '#3a4452');
    draw.text(g, `${ctx.players.get(ctx.myId)?.score ?? 0} Abschüsse`, 232, 56, { size: 14, align: 'right', color: '#ffd25a' });
    if (!me.alive) draw.text(g, 'ZERSTÖRT – gleich geht\'s weiter …', W / 2, H / 2, { size: 30 });
  }
  const top = ctx.ranking().slice(0, 6);
  draw.panel(g, W - 216, 16, 200, 30 + top.length * 20);
  top.forEach((p, i) => { draw.text(g, `${i + 1}. ${p.name}`, W - 204, 36 + i * 20, { size: 12, align: 'left', color: p.id === ctx.myId ? '#ffd25a' : p.color, shadow: false }); draw.text(g, `${p.score}`, W - 28, 36 + i * 20, { size: 12, align: 'right', shadow: false }); });
}

function drawTank(g, t, info, mine) {
  const color = info?.color || '#ccc';
  g.save(); g.translate(t.x, t.y);
  g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(4, 5, 22, 18, t.ba, 0, 7); g.fill();
  g.rotate(t.ba);
  // Ketten mit laufenden Gliedern
  for (const side of [-1, 1]) {
    g.fillStyle = '#2b2f36'; g.fillRect(-20, side * 13 - 5, 40, 10);
    g.fillStyle = '#4a5260';
    for (let i = 0; i < 6; i++) g.fillRect(-19 + ((i * 7 + t.tread) % 40), side * 13 - 4, 3, 8);
  }
  g.fillStyle = draw.shade(color, -0.15); g.fillRect(-17, -10, 34, 20);
  g.fillStyle = color; g.fillRect(-15, -8, 30, 14);
  g.restore();
  g.save(); g.translate(t.x, t.y); g.rotate(t.ta);
  g.fillStyle = '#2b2f36'; g.fillRect(4, -3, 24, 6);
  g.fillStyle = '#3a4048'; g.fillRect(24, -4, 6, 8);
  draw.hex(g, 0, 0, 10, draw.shade(color, 0.12));
  g.restore();
  if (t.sh) { g.strokeStyle = 'rgba(91,141,239,.8)'; g.lineWidth = 3; g.beginPath(); g.arc(t.x, t.y, 26 + Math.sin(ctx.time * 8) * 2, 0, 7); g.stroke(); }
  if (t.tr || t.fa) draw.hex(g, t.x - 22, t.y - 22, 6, t.tr ? '#f08c32' : '#3fd0c9');
  draw.text(g, info?.name || '?', t.x, t.y - 30, { size: 11, color: mine ? '#ffd25a' : '#fff' });
  for (let i = 0; i < 3; i++) { g.fillStyle = i < t.hp ? '#6abf4b' : 'rgba(0,0,0,.4)'; g.fillRect(t.x - 14 + i * 10, t.y + 24, 8, 3); }
}
