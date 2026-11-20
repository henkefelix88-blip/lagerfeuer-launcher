/**
 * Snake Oi – Client: Darstellung im Snake-Klassiker-Look (Karo-Wiese, Äpfel) + Online-Arena.
 * Steuerung: Maus zeigt die Richtung ODER Pfeiltasten/WASD (klassisch, 4 Richtungen). Boost: Leertaste / linke Maustaste.
 */
import { startGame, draw, lerp } from 'app://sdk/client.js';

const FOOD_COLORS = ['#ffd84d', '#ff6b6b', '#74c0fc', '#c77dff', '#ff9ff3', '#6ee07a'];
const state = { half: 1300, food: new Map(), snakes: new Map(), cam: { x: 0, y: 0, zoom: 1 }, dead: null, useMouse: true, lastKeyAngle: null, inputT: 0 };

let ctx;
ctx = await startGame({
  title: 'Snake Oi',
  help: [['Maus', 'Richtung'], ['Pfeile / WASD', 'Richtung (klassisch)'], ['Leertaste / LMB', 'Boost (kostet Länge)']],
  music: [[131, 262, 330, 392], [117, 233, 294, 349], [110, 220, 277, 330], [123, 247, 311, 370]],
  onWelcome(m, c) {
    ctx = c;
    state.half = m.half;
    for (const f of m.food) addFood(f);
  },
  onMessage(m, c) {
    ctx = c;
    if (m.t === 's') {
      for (const f of m.fa) addFood(f);
      for (const id of m.fr) state.food.delete(id);
      const seen = new Set();
      for (const s of m.sn) {
        seen.add(s[0]);
        const cur = state.snakes.get(s[0]) || { id: s[0], prev: null, cur: null, t: 0 };
        if (!s[1]) { cur.cur = null; cur.prev = null; state.snakes.set(s[0], cur); continue; }
        const pts = s[5];
        cur.prev = cur.cur;
        cur.cur = { len: s[2], boost: !!s[3], ang: s[4], pts, hx: pts[0], hy: pts[1] };
        cur.t = 0;
        state.snakes.set(s[0], cur);
      }
      for (const id of state.snakes.keys()) if (!seen.has(id)) state.snakes.delete(id);
    } else if (m.t === 'eat') {
      if (m.k === 'apple') { ctx.sfx.tone(520, 0.08, 'square', 0.15); ctx.sfx.tone(780, 0.12, 'square', 0.15, null, 0.06); }
      else ctx.sfx.tone(900 + Math.random() * 300, 0.04, 'sine', 0.08);
    } else if (m.t === 'die') {
      const victim = ctx.players.get(m.id)?.name || '?';
      const killer = m.k ? ctx.players.get(m.k)?.name : null;
      if (m.id === ctx.myId) {
        state.dead = { t: 2.5, by: killer, len: m.len };
        ctx.sfx.tone(400, 0.6, 'sawtooth', 0.2, 80);
      } else if (m.k === ctx.myId) { ctx.toast(`Du hast ${victim} erwischt!`); ctx.sfx.chord([523, 659, 784]); }
      else if (killer) ctx.toast(`${killer} hat ${victim} erwischt`);
    }
  },
  onFrame,
  debug: () => ({ snakes: state.snakes.size, food: state.food.size, myLen: state.snakes.get(ctx.myId)?.cur?.len || 0 }),
});

function addFood([id, apple, x, y, c, v]) { state.food.set(id, { id, apple: !!apple, x, y, c, v }); }

function onFrame(dt) {
  const g = ctx.g;
  const me = state.snakes.get(ctx.myId);
  // ---------- Eingabe ----------
  const k = (codes) => ctx.down(...codes);
  let keyAngle = null;
  if (k(['ArrowUp', 'KeyW'])) keyAngle = -Math.PI / 2;
  else if (k(['ArrowDown', 'KeyS'])) keyAngle = Math.PI / 2;
  else if (k(['ArrowLeft', 'KeyA'])) keyAngle = Math.PI;
  else if (k(['ArrowRight', 'KeyD'])) keyAngle = 0;
  if (keyAngle !== null) { state.useMouse = false; state.lastKeyAngle = keyAngle; }
  if (ctx.mouse.clicked) state.useMouse = true;
  state.inputT -= dt;
  if (state.inputT <= 0 && me?.cur && !ctx.paused) {
    state.inputT = 1 / 30;
    let a;
    if (state.useMouse) a = Math.atan2(ctx.mouse.y - ctx.height / 2, ctx.mouse.x - ctx.width / 2);
    else a = state.lastKeyAngle ?? me.cur.ang;
    ctx.send({ t: 'in', a: Math.round(a * 1000) / 1000, b: ctx.down('Space', 'Mouse0') });
  }
  if (me?.cur?.boost && Math.random() < dt * 8) ctx.sfx.noise(0.06, 600, 'lowpass', 0.05);

  // ---------- Kamera ----------
  for (const s of state.snakes.values()) s.t += dt;
  if (me?.cur) {
    const head = interpHead(me);
    state.cam.x = lerp(state.cam.x, head[0], Math.min(1, dt * 10));
    state.cam.y = lerp(state.cam.y, head[1], Math.min(1, dt * 10));
    const targetZoom = Math.max(0.55, 1.15 - Math.sqrt(me.cur.len) * 0.018) * Math.min(ctx.width, ctx.height) / 800;
    state.cam.zoom = lerp(state.cam.zoom, targetZoom, Math.min(1, dt * 2));
  }
  const { x: cx, y: cy, zoom } = state.cam;
  const W = ctx.width, H = ctx.height;

  // ---------- Hintergrund: Karo-Wiese (Snake-Klassiker) ----------
  g.fillStyle = '#3f6e35';
  g.fillRect(0, 0, W, H);
  g.save();
  g.translate(W / 2, H / 2);
  g.scale(zoom, zoom);
  g.translate(-cx, -cy);
  const T = 50;
  const x0 = Math.floor((cx - W / 2 / zoom) / T) * T, x1 = cx + W / 2 / zoom;
  const y0 = Math.floor((cy - H / 2 / zoom) / T) * T, y1 = cy + H / 2 / zoom;
  for (let x = x0; x < x1; x += T) {
    for (let y = y0; y < y1; y += T) {
      if (Math.abs(x + T / 2) > state.half || Math.abs(y + T / 2) > state.half) continue;
      g.fillStyle = ((x / T + y / T) & 1) ? '#79c35a' : '#6ab94e';
      g.fillRect(x, y, T + 0.5, T + 0.5);
    }
  }
  // Rand (Hecke)
  g.lineWidth = 24;
  g.strokeStyle = '#2f5a28';
  g.strokeRect(-state.half - 12, -state.half - 12, state.half * 2 + 24, state.half * 2 + 24);
  g.lineWidth = 6;
  g.strokeStyle = '#e2534a';
  g.setLineDash([30, 20]);
  g.strokeRect(-state.half, -state.half, state.half * 2, state.half * 2);
  g.setLineDash([]);

  // ---------- Futter ----------
  const vis = (x, y, m = 40) => x > cx - W / 2 / zoom - m && x < cx + W / 2 / zoom + m && y > cy - H / 2 / zoom - m && y < cy + H / 2 / zoom + m;
  for (const f of state.food.values()) {
    if (!vis(f.x, f.y)) continue;
    const pulse = 1 + Math.sin(ctx.time * 4 + f.id) * 0.12;
    if (f.apple) drawApple(g, f.x, f.y, 13 * pulse);
    else {
      const r = (3 + Math.min(5, f.v)) * pulse;
      g.globalAlpha = 0.35;
      draw.hex(g, f.x, f.y, r * 1.9, FOOD_COLORS[f.c]);
      g.globalAlpha = 1;
      draw.hex(g, f.x, f.y, r, FOOD_COLORS[f.c]);
    }
  }

  // ---------- Schlangen ----------
  const order = [...state.snakes.values()].filter((s) => s.cur).sort((a, b) => (a.id === ctx.myId) - (b.id === ctx.myId));
  for (const s of order) drawSnake(g, s, vis);
  g.restore();

  drawHud(g, me);
}

function interpHead(s) {
  const c = s.cur, p = s.prev;
  if (!p) return [c.hx, c.hy];
  const k = Math.min(1, s.t * 30);
  return [lerp(p.hx, c.hx, k), lerp(p.hy, c.hy, k)];
}

function drawApple(g, x, y, r) {
  g.fillStyle = 'rgba(0,0,0,.18)';
  g.beginPath(); g.ellipse(x + 3, y + r * 0.8, r * 0.9, r * 0.35, 0, 0, 7); g.fill();
  // Low-Poly-Apfel: Achteck in zwei Rottönen
  g.beginPath();
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r * 0.95); }
  g.fillStyle = '#d8433a'; g.fill();
  g.beginPath(); g.moveTo(x, y - r * 0.95); g.lineTo(x - r, y); g.lineTo(x - r * 0.7, y + r * 0.7); g.lineTo(x, y); g.closePath();
  g.fillStyle = '#f0625a'; g.fill();
  g.fillStyle = '#6b4226'; g.fillRect(x - 1.5, y - r - 5, 3, 7);
  g.beginPath(); g.moveTo(x + 1, y - r - 2); g.lineTo(x + 10, y - r - 8); g.lineTo(x + 6, y - r); g.closePath();
  g.fillStyle = '#4cc26a'; g.fill();
}

function drawSnake(g, s, vis) {
  const info = ctx.players.get(s.id) || { name: '?', color: '#cccccc' };
  const c = s.cur;
  const head = interpHead(s);
  const dx = head[0] - c.hx, dy = head[1] - c.hy;
  const r = 8 + Math.sqrt(c.len) * 0.35;
  const pts = c.pts;
  const n = pts.length / 2;
  const light = draw.shade(info.color, 0.12), dark = draw.shade(info.color, -0.12);
  // Körper vom Schwanz zum Kopf
  for (let i = n - 1; i >= 0; i--) {
    const x = pts[i * 2] + dx, y = pts[i * 2 + 1] + dy;
    if (!vis(x, y, r * 2)) continue;
    const rr = r * (i > n - 6 ? 0.55 + 0.45 * ((n - i) / 6) : 1);
    if (c.boost) { g.globalAlpha = 0.25; g.beginPath(); g.arc(x, y, rr * 1.5, 0, 7); g.fillStyle = info.color; g.fill(); g.globalAlpha = 1; }
    g.beginPath(); g.arc(x, y + 2, rr, 0, 7); g.fillStyle = 'rgba(0,0,0,.2)'; g.fill();
    g.beginPath(); g.arc(x, y, rr, 0, 7); g.fillStyle = Math.floor(i / 3) % 2 ? light : dark; g.fill();
  }
  // Kopf mit Augen
  const [hx, hy] = head;
  const a = c.ang;
  g.beginPath(); g.arc(hx, hy, r * 1.1, 0, 7); g.fillStyle = light; g.fill();
  for (const side of [-1, 1]) {
    const ex = hx + Math.cos(a) * r * 0.4 + Math.cos(a + Math.PI / 2) * side * r * 0.5;
    const ey = hy + Math.sin(a) * r * 0.4 + Math.sin(a + Math.PI / 2) * side * r * 0.5;
    g.beginPath(); g.arc(ex, ey, r * 0.38, 0, 7); g.fillStyle = '#fff'; g.fill();
    g.beginPath(); g.arc(ex + Math.cos(a) * r * 0.14, ey + Math.sin(a) * r * 0.14, r * 0.2, 0, 7); g.fillStyle = '#1b222c'; g.fill();
  }
  // Zunge (klassischer Snake-Look)
  if (Math.sin(ctx.time * 6 + s.id) > 0.6) {
    g.strokeStyle = '#e2534a'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(hx + Math.cos(a) * r, hy + Math.sin(a) * r); g.lineTo(hx + Math.cos(a) * r * 1.8, hy + Math.sin(a) * r * 1.8); g.stroke();
  }
  draw.text(g, info.name, hx, hy - r - 16, { size: 13, color: s.id === ctx.myId ? '#ffd25a' : '#fff' });
}

function drawHud(g, me) {
  const W = ctx.width, H = ctx.height;
  // Länge
  draw.panel(g, 16, 16, 200, 64);
  draw.text(g, 'LÄNGE', 30, 32, { size: 11, color: '#b9c3cf', align: 'left' });
  draw.text(g, `${me?.cur ? me.cur.len : 0}`, 30, 58, { size: 30, align: 'left' });
  const rank = ctx.ranking().findIndex((p) => p.id === ctx.myId) + 1;
  draw.text(g, rank ? `Platz ${rank}/${ctx.players.size}` : '', 200, 58, { size: 13, align: 'right', color: '#ffd25a' });
  // Rangliste
  const top = ctx.ranking().slice(0, 10);
  draw.panel(g, W - 236, 16, 220, 34 + top.length * 22);
  draw.text(g, 'RANGLISTE', W - 222, 32, { size: 11, color: '#b9c3cf', align: 'left' });
  top.forEach((p, i) => {
    draw.text(g, `${i + 1}. ${p.name}`, W - 222, 54 + i * 22, { size: 13, align: 'left', color: p.id === ctx.myId ? '#ffd25a' : p.color, shadow: false });
    draw.text(g, `${p.score}`, W - 28, 54 + i * 22, { size: 13, align: 'right', shadow: false });
  });
  // Minikarte
  const S = 150, mx = W - S - 16, my = H - S - 30;
  draw.panel(g, mx, my, S, S, 'rgba(27,34,44,.7)');
  for (const s of state.snakes.values()) {
    if (!s.cur) continue;
    const info = ctx.players.get(s.id);
    const x = mx + ((s.cur.hx + state.half) / (state.half * 2)) * S, y = my + ((s.cur.hy + state.half) / (state.half * 2)) * S;
    g.fillStyle = s.id === ctx.myId ? '#ffd25a' : info?.color || '#fff';
    g.beginPath(); g.arc(x, y, s.id === ctx.myId ? 4 : 2.5, 0, 7); g.fill();
  }
  // Tod
  if (state.dead) {
    state.dead.t -= 1 / 60;
    if (me?.cur && state.dead.t < 2.3) state.dead = null;
    else {
      g.fillStyle = 'rgba(120,20,20,.25)'; g.fillRect(0, 0, W, H);
      draw.text(g, 'GEFRESSEN!', W / 2, H / 2 - 30, { size: 48 });
      draw.text(g, state.dead.by ? `von ${state.dead.by} · Länge ${state.dead.len}` : `Länge ${state.dead.len}`, W / 2, H / 2 + 14, { size: 18 });
    }
  }
}
