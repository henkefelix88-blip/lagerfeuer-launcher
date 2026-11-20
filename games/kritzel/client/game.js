/**
 * Kritzel & Raten – Client. Der Maler zeichnet mit der Maus (Farben, Stiftgrößen, Radierer, Löschen),
 * alle anderen raten im Eingabefeld rechts (Enter). Richtige Antworten sieht niemand sonst.
 */
import { startGame } from 'app://sdk/client.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const COLORS = ['#1b222c', '#ffffff', '#e2534a', '#f08c32', '#ffd25a', '#6abf4b', '#3fbf7f', '#5b8def', '#b467d6', '#ef7aa8', '#8a5a2e', '#9aa0a8'];
const SIZES = [4, 10, 22, 44];
const S = { ph: 'wait', drawer: 0, left: 0, word: '', guessed: [], options: null, order: [], color: '#1b222c', size: 10, drawing: null, sendBuf: [], strokeId: 1, lastSend: 0 };
const paper = $('kr-paper');
const pg = paper.getContext('2d');
pg.lineCap = pg.lineJoin = 'round';
const clearPaper = () => { pg.fillStyle = '#fffdf6'; pg.fillRect(0, 0, paper.width, paper.height); };
clearPaper();
const drawSeg = (pts, c, w) => {
  pg.strokeStyle = c; pg.lineWidth = w; pg.beginPath();
  pg.moveTo(pts[0], pts[1]);
  if (pts.length === 2) pg.lineTo(pts[0] + 0.1, pts[1]);
  for (let i = 2; i < pts.length; i += 2) pg.lineTo(pts[i], pts[i + 1]);
  pg.stroke();
};
const log = (html, cls = '') => { const el = document.createElement('div'); el.innerHTML = html; if (cls) el.className = cls; $('kr-log').append(el); $('kr-log').scrollTop = 1e9; };

let ctx;
ctx = await startGame({
  title: 'Kritzel & Raten', chat: false, mode: 'dom',
  help: [['Maus', 'Malen (wenn du dran bist)'], ['Enter', 'Raten / Chatten']],
  music: false,
  onWelcome(m, c) { ctx = c; setTimeout(() => window.__gamePlay?.(), 0); for (const s of m.strokes) drawSeg(s.pts, s.c, s.w); log('Willkommen! Sobald mindestens 2 Spieler da sind, geht es los.', 'sys'); },
  onMessage(m, c) {
    ctx = c;
    if (m.t === 's') { Object.assign(S, { ph: m.ph, drawer: m.drawer, left: m.left, word: m.word, guessed: m.guessed, options: m.options, order: m.order }); render(); }
    else if (m.t === 'stroke') drawSeg(m.pts, m.c, m.w);
    else if (m.t === 'clear') clearPaper();
    else if (m.t === 'turn') { const n = ctx.players.get(m.drawer)?.name; log(`${esc(n)} ist jetzt dran mit Malen.`, 'sys'); banner(m.drawer === ctx.myId ? 'Du bist dran! Such dir einen Begriff aus.' : `${n} wählt einen Begriff …`); ctx.sfx.chord([523, 659]); }
    else if (m.t === 'go') { banner(''); }
    else if (m.t === 'guessed') { const n = ctx.players.get(m.id)?.name; log(`✔ ${esc(n)} hat es erraten!`, 'good'); ctx.sfx.chord(m.id === ctx.myId ? [523, 659, 784, 1046] : [880, 1100]); }
    else if (m.t === 'close') { log('Knapp daneben!', 'sys'); ctx.sfx.tone(600, 0.1, 'sine', 0.2); }
    else if (m.t === 'reveal') { log(`Das Wort war: <b>${esc(m.word || '?')}</b>${m.reason ? ` – ${esc(m.reason)}` : ''}`, 'sys'); banner(`Das Wort war: ${m.word || '?'}`); }
    else if (m.t === 'chat') log(`<b style="color:${m.color}">${esc(m.name)}:</b> ${esc(m.text)}`);
    else if (m.t === 'msg') log(esc(m.text), 'sys');
  },
  onFrame() {},
  debug: () => ({ phase: S.ph, players: S.order.length }),
});



function banner(text) { $('kr-banner').textContent = text; $('kr-banner').classList.toggle('hidden', !text); }

// ---------- Werkzeuge ----------
function buildTools() {
  $('kr-tools').innerHTML = COLORS.map((c) => `<div class="sw ${c === S.color ? 'on' : ''}" data-c="${c}" style="background:${c}"></div>`).join('') +
    SIZES.map((s) => `<div class="sz ${s === S.size ? 'on' : ''}" data-s="${s}"><i style="width:${Math.min(26, s / 1.6 + 3)}px;height:${Math.min(26, s / 1.6 + 3)}px"></i></div>`).join('') +
    '<button class="sdk-btn" id="kr-eraser">Radierer</button><button class="sdk-btn danger" id="kr-clear">Alles löschen</button>';
  for (const el of document.querySelectorAll('.sw')) el.onclick = () => { S.color = el.dataset.c; buildTools(); };
  for (const el of document.querySelectorAll('.sz')) el.onclick = () => { S.size = Number(el.dataset.s); buildTools(); };
  $('kr-eraser').onclick = () => { S.color = '#fffdf6'; buildTools(); };
  $('kr-clear').onclick = () => { clearPaper(); ctx.send({ t: 'clear' }); };
}
buildTools();

// ---------- Malen ----------
const toPaper = (e) => { const r = paper.getBoundingClientRect(); return [Math.round((e.clientX - r.left) / r.width * paper.width), Math.round((e.clientY - r.top) / r.height * paper.height)]; };
const canDraw = () => S.ph === 'draw' && S.drawer === ctx.myId;
paper.addEventListener('pointerdown', (e) => {
  if (!canDraw()) return;
  paper.setPointerCapture(e.pointerId);
  const p = toPaper(e);
  S.drawing = { last: p };
  S.sendBuf = [...p];
  drawSeg(p, S.color, S.size);
});
paper.addEventListener('pointermove', (e) => {
  if (!S.drawing || !canDraw()) return;
  const p = toPaper(e);
  drawSeg([...S.drawing.last, ...p], S.color, S.size);
  S.drawing.last = p;
  S.sendBuf.push(...p);
  if (S.sendBuf.length >= 40 || performance.now() - S.lastSend > 50) flush(true);
});
const end = () => { if (S.drawing) { flush(false); S.drawing = null; } };
paper.addEventListener('pointerup', end);
paper.addEventListener('pointercancel', end);
function flush(cont) {
  if (S.sendBuf.length < 2) return;
  ctx.send({ t: 'stroke', c: S.color, w: S.size, pts: S.sendBuf, id: S.strokeId });
  S.lastSend = performance.now();
  // Fortsetzung: letzten Punkt als Start des nächsten Pakets behalten
  S.sendBuf = cont ? S.sendBuf.slice(-2) : [];
  if (!cont) S.strokeId++;
}

// ---------- Raten / Chat ----------
$('kr-input').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const text = e.target.value.trim();
  if (text) ctx.send({ t: 'chat', text });
  e.target.value = '';
});

// ---------- Anzeige ----------
function render() {
  const me = ctx.myId;
  const drawerName = ctx.players.get(S.drawer)?.name;
  $('kr-info').textContent = S.ph === 'wait' ? 'Warte auf mindestens 2 Spieler …' : S.drawer === me ? 'Du malst!' : `${drawerName} malt`;
  $('kr-word').textContent = S.ph === 'choose' ? '' : S.word.split('').join('');
  $('kr-time').textContent = S.ph === 'draw' || S.ph === 'choose' ? `${S.left}s` : '';
  $('kr-tools').classList.toggle('off', !canDraw());
  $('kr-input').disabled = S.drawer === me && S.ph === 'draw';
  $('kr-input').placeholder = S.drawer === me && S.ph === 'draw' ? 'Du malst gerade …' : S.guessed.includes(me) ? 'Erraten! Du kannst weiter chatten.' : 'Hier raten … (Enter)';
  const chooser = S.options && S.drawer === me;
  $('kr-choose').classList.toggle('hidden', !chooser);
  if (chooser && $('kr-opts').dataset.k !== S.options.join()) {
    $('kr-opts').dataset.k = S.options.join();
    $('kr-opts').innerHTML = S.options.map((w, i) => `<button data-i="${i}">${esc(w)}</button>`).join('');
    for (const b of $('kr-opts').children) b.onclick = () => ctx.send({ t: 'choose', i: Number(b.dataset.i) });
  }
  const rows = [...ctx.players.values()].filter((p) => !p.bot).sort((a, b) => b.score - a.score);
  $('kr-players').innerHTML = rows.map((p) => `<div class="pl ${S.guessed.includes(p.id) ? 'ok' : ''}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}${p.id === me ? ' (du)' : ''}${p.id === S.drawer ? ' <span class="pen">✎</span>' : ''}<span class="s">${p.score}</span></div>`).join('');
}
