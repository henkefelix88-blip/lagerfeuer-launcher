/**
 * Turbo-Rennen – Client. Steuerung: W/↑ Gas, S/↓ Bremse, A/D lenken, Shift/Leertaste driften.
 */
import { startGame, draw, lerp } from 'app://sdk/client.js';
import { buildTrack, WIDTH } from '../shared/track.mjs';

const track = buildTrack();
const S = { laps: 3, cars: new Map(), order: [], ph: 'countdown', ends: 0, start: 0, offset: 0, skids: [], cam: { x: 0, y: 0, a: 0 }, sendT: 0, lastBeep: 0 };
// Deko: Bäume & Blumen neben der Strecke (deterministisch)
const deco = [];
{
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 420; i++) {
    const x = -900 + r() * 2400, y = -400 + r() * 1700;
    let near = Infinity;
    for (let k = 0; k < track.pts.length; k += 3) near = Math.min(near, Math.hypot(track.pts[k].x - x, track.pts[k].y - y));
    if (near < WIDTH / 2 + 40) continue;
    deco.push({ x, y, kind: r() < 0.35 ? 'tree' : 'flower', c: ['#ffd84d', '#ff6b6b', '#ffffff', '#c77dff'][Math.floor(r() * 4)], s: 0.7 + r() * 0.6 });
  }
}

let ctx;
ctx = await startGame({
  title: 'Turbo-Rennen',
  help: [['W / ↑', 'Gas'], ['S / ↓', 'Bremse / Rückwärts'], ['A / D', 'Lenken'], ['Shift / Leertaste', 'Driften']],
  music: [[147, 294, 370, 440], [165, 330, 415, 494], [131, 262, 330, 392], [147, 294, 370, 440]],
  onWelcome(m, c) { ctx = c; S.laps = m.laps; },
  onMessage(m, c) {
    ctx = c;
    if (m.t === 's') {
      S.offset = m.time - performance.now() / 1000;
      S.ph = m.ph; S.ends = m.ends; S.start = m.start;
      S.order = m.c;
      for (const [id, x, y, a, speed, lap, place, fin, drift, boost] of m.c) {
        const car = S.cars.get(id) || { x, y, a };
        Object.assign(car, { tx: x, ty: y, ta: a, speed, lap, place, fin, drift, boost });
        S.cars.set(id, car);
      }
      for (const id of S.cars.keys()) if (!m.c.some((c) => c[0] === id)) S.cars.delete(id);
    } else if (m.t === 'go') { ctx.sfx.tone(880, 0.4, 'square', 0.2); }
    else if (m.t === 'boost') { ctx.sfx.tone(300, 0.5, 'sawtooth', 0.15, 900); }
    else if (m.t === 'lap' && m.id === ctx.myId && m.lap > 0 && m.lap < S.laps) { ctx.toast(m.lap === S.laps - 1 ? 'Letzte Runde!' : `Runde ${m.lap + 1}`); ctx.sfx.chord([660, 880]); }
    else if (m.t === 'finish') {
      const name = ctx.players.get(m.id)?.name;
      if (m.id === ctx.myId) { ctx.toast(`Im Ziel! Platz ${m.place}`); ctx.sfx.chord([523, 659, 784, 1046], 0.25); }
      else ctx.toast(`${name} ist im Ziel (Platz ${m.place})`);
    }
  },
  onFrame,
  debug: () => ({ cars: S.cars.size, phase: S.ph }),
});
const now = () => performance.now() / 1000 + S.offset;

function onFrame(dt) {
  const g = ctx.g, W = ctx.width, H = ctx.height;
  S.sendT -= dt;
  if (S.sendT <= 0) {
    S.sendT = 1 / 30;
    ctx.send({ t: 'in', keys: { up: ctx.down('KeyW', 'ArrowUp'), down: ctx.down('KeyS', 'ArrowDown'), left: ctx.down('KeyA', 'ArrowLeft'), right: ctx.down('KeyD', 'ArrowRight'), fire: ctx.down('ShiftLeft', 'Space') } });
  }
  for (const car of S.cars.values()) {
    const k = Math.min(1, dt * 15);
    car.x = lerp(car.x, car.tx, k); car.y = lerp(car.y, car.ty, k);
    car.a += (((car.ta - car.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * k;
    if (car.drift && Math.random() < 0.8) S.skids.push({ x: car.x - Math.cos(car.a) * 14, y: car.y - Math.sin(car.a) * 14, a: car.a, life: 3 });
  }
  const me = S.cars.get(ctx.myId);
  if (me) { S.cam.x = lerp(S.cam.x, me.x + Math.cos(me.a) * me.speed * 0.25, Math.min(1, dt * 4)); S.cam.y = lerp(S.cam.y, me.y + Math.sin(me.a) * me.speed * 0.25, Math.min(1, dt * 4)); }
  if (me?.drift && Math.random() < dt * 10) ctx.sfx.noise(0.08, 3000, 'bandpass', 0.05);
  const zoom = Math.min(W, H) / 900 * (me ? 1.15 - Math.min(0.3, me.speed / 1800) : 1);
  g.fillStyle = '#6ab94e'; g.fillRect(0, 0, W, H);
  g.save(); g.translate(W / 2, H / 2); g.scale(zoom, zoom); g.translate(-S.cam.x, -S.cam.y);
  // Gras-Muster
  g.fillStyle = '#79c35a';
  for (let x = Math.floor((S.cam.x - W / zoom) / 120) * 120; x < S.cam.x + W / zoom; x += 120) for (let y = Math.floor((S.cam.y - H / zoom) / 120) * 120; y < S.cam.y + H / zoom; y += 120) if (((x + y) / 120) % 2 === 0) g.fillRect(x, y, 120, 120);
  // Strecke: Randstreifen (rot/weiß), Asphalt, Mittellinie
  const path = () => { g.beginPath(); track.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); };
  g.lineJoin = 'round';
  path(); g.strokeStyle = '#ffffff'; g.lineWidth = WIDTH + 18; g.stroke();
  path(); g.strokeStyle = '#e2534a'; g.lineWidth = WIDTH + 18; g.setLineDash([30, 30]); g.stroke(); g.setLineDash([]);
  path(); g.strokeStyle = '#4a5260'; g.lineWidth = WIDTH; g.stroke();
  path(); g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 3; g.setLineDash([26, 26]); g.stroke(); g.setLineDash([]);
  // Start/Ziel (Schachbrett)
  const s0 = track.pts[0], nx = -s0.ty, ny = s0.tx;
  for (let i = -6; i < 6; i++) for (let j = 0; j < 2; j++) {
    g.fillStyle = (i + j) % 2 ? '#fff' : '#1b222c';
    const cx = s0.x + nx * i * (WIDTH / 12) + s0.tx * j * 10, cy = s0.y + ny * i * (WIDTH / 12) + s0.ty * j * 10;
    g.fillRect(cx - 5, cy - 5, WIDTH / 12, 10);
  }
  // Boost-Felder
  for (const b of track.boosts) {
    g.save(); g.translate(b.x, b.y); g.rotate(Math.atan2(b.ty, b.tx));
    g.fillStyle = '#3fd0c9'; g.fillRect(-30, -26, 60, 52);
    g.fillStyle = '#fff';
    for (let k = 0; k < 2; k++) { g.beginPath(); g.moveTo(-18 + k * 20, -16); g.lineTo(0 + k * 20, 0); g.lineTo(-18 + k * 20, 16); g.lineTo(-10 + k * 20, 0); g.fill(); }
    g.restore();
  }
  // Bremsspuren
  g.fillStyle = 'rgba(30,30,30,.35)';
  for (let i = S.skids.length - 1; i >= 0; i--) { const s = S.skids[i]; s.life -= dt; if (s.life <= 0) { S.skids.splice(i, 1); continue; } g.globalAlpha = s.life / 3 * 0.5; g.save(); g.translate(s.x, s.y); g.rotate(s.a); g.fillRect(-3, -12, 6, 4); g.fillRect(-3, 8, 6, 4); g.restore(); }
  g.globalAlpha = 1;
  // Deko
  for (const d of deco) {
    if (d.kind === 'tree') { g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.arc(d.x + 8, d.y + 8, 24 * d.s, 0, 7); g.fill(); draw.hex(g, d.x, d.y, 24 * d.s, '#3f8f3a'); draw.hex(g, d.x - 4, d.y - 4, 14 * d.s, '#4c9e3f'); }
    else draw.hex(g, d.x, d.y, 4 * d.s, d.c);
  }
  // Autos
  for (const [id, car] of S.cars) drawCar(g, car, ctx.players.get(id), id === ctx.myId);
  g.restore();
  drawHud(g, me, W, H);
}

function drawCar(g, car, info, mine) {
  const color = info?.color || '#ccc';
  g.save(); g.translate(car.x, car.y);
  g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(4, 5, 26, 15, car.a, 0, 7); g.fill();
  g.rotate(car.a);
  g.fillStyle = '#1b222c';
  for (const [x, y] of [[-14, -13], [-14, 9], [10, -13], [10, 9]]) g.fillRect(x, y, 10, 4);
  g.fillStyle = draw.shade(color, -0.18); g.fillRect(-20, -11, 40, 22);
  g.fillStyle = color; g.beginPath(); g.moveTo(-20, -10); g.lineTo(14, -10); g.lineTo(22, -5); g.lineTo(22, 5); g.lineTo(14, 10); g.lineTo(-20, 10); g.closePath(); g.fill();
  g.fillStyle = '#9fd8ff'; g.fillRect(2, -7, 8, 14);
  g.fillStyle = '#ffffff'; g.fillRect(-16, -2, 26, 4);
  if (car.boost) { g.fillStyle = Math.random() < 0.5 ? '#ffd25a' : '#ff8a2a'; g.beginPath(); g.moveTo(-20, -6); g.lineTo(-34 - Math.random() * 10, 0); g.lineTo(-20, 6); g.fill(); }
  g.restore();
  draw.text(g, info?.name || '?', car.x, car.y - 30, { size: 12, color: mine ? '#ffd25a' : '#fff' });
}

function drawHud(g, me, W, H) {
  const t = now();
  if (me) {
    draw.panel(g, 16, 16, 260, 70);
    draw.text(g, `RUNDE ${me.lap}/${S.laps}`, 30, 36, { size: 14, align: 'left', color: '#b9c3cf' });
    draw.text(g, `Platz ${me.place}/${S.cars.size}`, 30, 64, { size: 26, align: 'left' });
    draw.text(g, `${Math.round(me.speed * 0.36)} km/h`, 262, 64, { size: 16, align: 'right', color: '#ffd25a' });
  }
  draw.panel(g, W - 216, 16, 200, 30 + S.order.length * 20);
  S.order.forEach(([id, , , , , lap, place, fin], i) => {
    const p = ctx.players.get(id);
    draw.text(g, `${place}. ${p?.name || '?'}`, W - 204, 36 + i * 20, { size: 12, align: 'left', color: id === ctx.myId ? '#ffd25a' : p?.color || '#fff', shadow: false });
    draw.text(g, fin ? `${fin.toFixed(1)} s` : `R${lap}`, W - 28, 36 + i * 20, { size: 12, align: 'right', shadow: false });
  });
  // Minikarte
  const mx = W - 200, my = H - 160, sc = 0.09;
  draw.panel(g, mx - 10, my - 10, 190, 150, 'rgba(27,34,44,.6)');
  g.save(); g.translate(mx + 70, my + 30); g.scale(sc, sc);
  g.beginPath(); track.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
  g.strokeStyle = '#9aa7b8'; g.lineWidth = 40; g.stroke();
  for (const [id, car] of S.cars) { g.fillStyle = id === ctx.myId ? '#ffd25a' : ctx.players.get(id)?.color || '#fff'; g.beginPath(); g.arc(car.x, car.y, id === ctx.myId ? 70 : 50, 0, 7); g.fill(); }
  g.restore();
  if (S.ph === 'countdown') {
    const n = Math.ceil(S.ends - t);
    if (n !== S.lastBeep && n > 0 && n <= 3) { S.lastBeep = n; ctx.sfx.tone(440, 0.2, 'square', 0.15); }
    draw.text(g, n > 3 ? 'Bereit machen …' : `${Math.max(1, n)}`, W / 2, H / 2 - 80, { size: 72 });
  } else if (S.ph === 'race' && t - S.start < 1.2) draw.text(g, 'LOS!', W / 2, H / 2 - 80, { size: 72, color: '#6abf4b' });
  else if (S.ph === 'results') {
    draw.panel(g, W / 2 - 200, H / 2 - 40 - S.order.length * 14, 400, 60 + S.order.length * 28);
    draw.text(g, 'ERGEBNIS', W / 2, H / 2 - 20 - S.order.length * 14, { size: 20 });
    S.order.forEach(([id, , , , , , place, fin], i) => draw.text(g, `${place}. ${ctx.players.get(id)?.name || '?'}  ${fin ? `${fin.toFixed(2)} s` : '–'}`, W / 2, H / 2 + 12 - S.order.length * 14 + i * 28, { size: 16, color: id === ctx.myId ? '#ffd25a' : '#fff' }));
  }
}
