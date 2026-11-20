/**
 * Lagerfeuer Spiele-SDK – Client-Teil (im Spielfenster: import … from 'app://sdk/client.js').
 *
 * startGame(options) baut das Grundgerüst eines Spiels:
 *  - liest die Startparameter/Einstellungen vom Launcher, verbindet sich mit dem Host (Passwort, Version)
 *  - Lade-/Pausenmenü (Esc) mit Steuerungshilfe, "Zurück zum Launcher", optional Maus-Fang (3D-Spiele)
 *  - Chat (T / Enter), Meldungen, Scoreboard (Tab), Ping/FPS
 *  - Tastatur/Maus-Zustand, Spielschleife mit FPS-Limit, Canvas (2D) mit HiDPI-Skalierung
 *  - Synth-Sounds (Master/Effekte/Musik + gewähltes Ausgabegerät)
 *
 * options: { title, version, help: [[Taste, Aktion]], mode: '2d'|'3d', pointerLock, chat, onWelcome, onMessage, onFrame, debug }
 * Die Callbacks bekommen ctx (siehe unten) übergeben.
 */
const DEV = { address: '127.0.0.1', port: Number(new URLSearchParams(location.search).get('port')) || 27020, password: '', name: 'Dev',
  settings: { audio: { master: 0.8, music: 0.5, sfx: 0.8, outputDeviceId: 'default' }, graphics: { fpsLimit: 144, quality: 'medium' }, controls: { sensitivity: 1, invertY: false, fov: 80 } } };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Synth-Sounds (WebAudio). Alle Effekte sind kurz und prozedural erzeugt. */
export class Synth {
  constructor(a) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.fx = this.ctx.createGain();
    this.mus = this.ctx.createGain();
    this.fx.connect(this.master); this.mus.connect(this.master); this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.apply(a);
  }
  async apply(a) {
    this.master.gain.value = a.master; this.fx.gain.value = a.sfx; this.mus.gain.value = a.music * 0.22;
    if (this.ctx.setSinkId) { try { await this.ctx.setSinkId(!a.outputDeviceId || a.outputDeviceId === 'default' ? '' : a.outputDeviceId); } catch {} }
  }
  resume() { if (this.ctx.state === 'suspended') this.ctx.resume(); }
  tone(freq, dur = 0.1, type = 'sine', vol = 0.3, endFreq = null, start = 0, dest = this.fx) {
    const t = this.ctx.currentTime + start;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur = 0.1, freq = 2000, type = 'lowpass', vol = 0.4, start = 0, dest = this.fx) {
    const t = this.ctx.currentTime + start;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.3), t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  chord(freqs, dur = 0.12, type = 'triangle', vol = 0.25) { freqs.forEach((f, i) => this.tone(f, dur, type, vol, null, i * 0.06)); }
  /** Endlose, leise Hintergrundmusik: Bass + Arpeggio in der gegebenen Akkordfolge. */
  music(prog = [[110, 220, 277, 330], [98, 196, 247, 294], [87, 174, 220, 262], [98, 196, 247, 330]], bpm = 104) {
    if (this.musicTimer) return;
    const beat = 60 / bpm;
    let bar = 0;
    const play = () => {
      const c = prog[bar++ % prog.length];
      for (let b = 0; b < 4; b++) {
        this.tone(c[0], beat * 0.9, 'triangle', 0.5, null, b * beat, this.mus);
        for (let s = 0; s < 2; s++) this.tone(c[1 + ((b * 2 + s) % 3)] * 2, beat * 0.4, 'sine', 0.16, null, b * beat + s * beat / 2, this.mus);
      }
    };
    play();
    this.musicTimer = setInterval(play, beat * 4000);
  }
}

function injectUi(title, help) {
  document.body.insertAdjacentHTML('beforeend', `
    <div id="sdk-hud">
      <div id="sdk-info"><span id="sdk-ping">– ms</span> · <span id="sdk-fps">– FPS</span></div>
      <div id="sdk-msgs"></div>
      <div id="sdk-chat"><div id="sdk-chat-log"></div><input id="sdk-chat-input" maxlength="120" autocomplete="off" placeholder="Nachricht … (Enter senden, Esc abbrechen)"></div>
      <div id="sdk-board" class="sdk-hidden"><h2>${esc(title)}</h2><table><thead><tr><th></th><th>Spieler</th><th>Punkte</th><th>Ping</th></tr></thead><tbody id="sdk-board-rows"></tbody></table></div>
    </div>
    <div id="sdk-overlay">
      <div class="card">
        <div class="logo-row"><div class="sdk-logo"></div><div><h1>${esc(title)}</h1><div id="sdk-status">Verbinde …</div></div></div>
        <div id="sdk-menu" class="sdk-hidden">
          <button id="sdk-resume" class="sdk-btn primary">Spielen</button>
          <label class="sdk-vol">Master-Lautstärke <span id="sdk-vol-v"></span><input type="range" id="sdk-vol" min="0" max="100"></label>
          <div class="sdk-keys">${help.map(([k, a]) => `<span>${esc(a)}</span><b>${esc(k)}</b>`).join('')}<span>Chat</span><b>T</b><span>Punkte</span><b>Tab</b><span>Menü</span><b>Esc</b></div>
          <button id="sdk-quit" class="sdk-btn danger">Zurück zum Launcher</button>
        </div>
        <button id="sdk-err-quit" class="sdk-btn sdk-hidden">Zurück zum Launcher</button>
      </div>
    </div>`);
}

export async function startGame(options) {
  const o = { mode: '2d', chat: true, help: [], pointerLock: false, version: 1, ...options };
  const launch = (await window.launcher?.getLaunchParams?.()) || DEV;
  const settings = launch.settings;
  injectUi(o.title, o.help);
  const $ = (id) => document.getElementById(id);
  const sfx = new Synth(settings.audio);

  let canvas = document.getElementById('game');
  if (!canvas) { canvas = document.createElement('canvas'); canvas.id = 'game'; document.body.prepend(canvas); }
  const g = o.mode === '2d' ? canvas.getContext('2d') : null;

  const ctx = {
    launch, settings, sfx, canvas, g, myId: null, players: new Map(), connected: false, paused: true, ended: false,
    keys: new Set(), pressedSet: new Set(), mouse: { x: 0, y: 0, down: false, buttons: new Set(), clicked: false },
    width: innerWidth, height: innerHeight, dpr: 1, time: 0, fps: 0, rtt: 0,
    send: (obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    down: (...codes) => !ctx.chatOpen && !ctx.paused && codes.some((c) => ctx.keys.has(c)),
    pressed: (...codes) => !ctx.chatOpen && !ctx.paused && codes.some((c) => ctx.pressedSet.has(c)),
    toast(text, cls = '') {
      const el = document.createElement('div'); el.textContent = text; if (cls) el.className = cls;
      $('sdk-msgs').append(el);
      while ($('sdk-msgs').children.length > 5) $('sdk-msgs').firstChild.remove();
      setTimeout(() => el.remove(), 4500);
    },
    chatLine(name, color, text) {
      const el = document.createElement('div');
      el.className = 'line';
      el.innerHTML = name ? `<b style="color:${color}">${esc(name)}:</b> ${esc(text)}` : `<i>${esc(text)}</i>`;
      el.dataset.until = performance.now() + 10000;
      $('sdk-chat-log').append(el);
      while ($('sdk-chat-log').children.length > 40) $('sdk-chat-log').firstChild.remove();
      $('sdk-chat-log').scrollTop = 1e9;
    },
    /** Spieler sortiert nach Punkten (für eigene Ranglisten). */
    ranking() { return [...ctx.players.values()].sort((a, b) => b.score - a.score); },
    showError(text) {
      ctx.ended = true;
      document.exitPointerLock?.();
      $('sdk-overlay').classList.remove('sdk-hidden');
      $('sdk-menu').classList.add('sdk-hidden');
      $('sdk-status').textContent = text;
      $('sdk-err-quit').classList.remove('sdk-hidden');
    },
    quit() { ws?.close(); window.launcher?.exitGame?.(); },
  };

  // ---------- Canvas-Größe ----------
  const resize = () => {
    ctx.dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.width = innerWidth; ctx.height = innerHeight;
    canvas.width = Math.round(innerWidth * ctx.dpr); canvas.height = Math.round(innerHeight * ctx.dpr);
    o.onResize?.(ctx);
  };
  window.addEventListener('resize', resize);
  resize();

  // ---------- Pause / Menü ----------
  const setPaused = (p) => {
    if (ctx.ended) return;
    ctx.paused = p;
    $('sdk-overlay').classList.toggle('sdk-hidden', !p);
    if (p) ctx.keys.clear();
  };
  const play = () => {
    if (!ctx.connected || ctx.ended) return;
    sfx.resume();
    if (o.music !== false) sfx.music(o.music || undefined);
    if (o.pointerLock) canvas.requestPointerLock()?.catch?.(() => {});
    else setPaused(false);
  };
  if (o.pointerLock) document.addEventListener('pointerlockchange', () => setPaused(document.pointerLockElement !== canvas));
  $('sdk-resume').onclick = play;
  $('sdk-quit').onclick = () => ctx.quit();
  $('sdk-err-quit').onclick = () => ctx.quit();
  $('sdk-vol').value = Math.round(settings.audio.master * 100);
  $('sdk-vol-v').textContent = `${$('sdk-vol').value}%`;
  $('sdk-vol').oninput = (e) => { settings.audio.master = e.target.value / 100; $('sdk-vol-v').textContent = `${e.target.value}%`; sfx.apply(settings.audio); };

  // ---------- Eingabe ----------
  const closeChat = () => { ctx.chatOpen = false; $('sdk-chat').classList.remove('open'); $('sdk-chat-input').blur(); };
  window.addEventListener('keydown', (e) => {
    // Eigene Eingabefelder des Spiels (z. B. Rate-Feld) nicht als Spielsteuerung behandeln
    if ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && e.target.id !== 'sdk-chat-input') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (ctx.chatOpen) {
      if (e.key === 'Enter') { const t = $('sdk-chat-input').value.trim(); if (t) ctx.send({ t: 'chat', text: t }); closeChat(); e.preventDefault(); }
      else if (e.key === 'Escape') { closeChat(); e.preventDefault(); }
      return;
    }
    if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) || e.ctrlKey) e.preventDefault();
    if (e.code === 'Escape' && !o.pointerLock) { setPaused(!ctx.paused); if (!ctx.paused) play(); return; }
    if (ctx.paused) return;
    if (o.chat && e.code === 'KeyT') {
      e.preventDefault();
      ctx.chatOpen = true; ctx.keys.clear();
      $('sdk-chat').classList.add('open'); $('sdk-chat-input').value = ''; $('sdk-chat-input').focus();
      return;
    }
    if (!ctx.keys.has(e.code)) ctx.pressedSet.add(e.code);
    ctx.keys.add(e.code);
  });
  window.addEventListener('keyup', (e) => ctx.keys.delete(e.code));
  window.addEventListener('blur', () => ctx.keys.clear());
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousemove', (e) => { ctx.mouse.x = e.clientX; ctx.mouse.y = e.clientY; if (!o.pointerLock) o.onMouseMove?.(e, ctx); });
  window.addEventListener('mousemove', (e) => { if (o.pointerLock && document.pointerLockElement === canvas) o.onMouseMove?.(e, ctx); });
  canvas.addEventListener('mousedown', (e) => { ctx.mouse.down = true; ctx.mouse.buttons.add(e.button); ctx.mouse.clicked = true; ctx.pressedSet.add(`Mouse${e.button}`); ctx.keys.add(`Mouse${e.button}`); });
  window.addEventListener('mouseup', (e) => { ctx.mouse.down = false; ctx.mouse.buttons.delete(e.button); ctx.keys.delete(`Mouse${e.button}`); });
  canvas.addEventListener('wheel', (e) => o.onWheel?.(e, ctx));

  // ---------- Netzwerk ----------
  let ws = null;
  const onMsg = (m) => {
    switch (m.t) {
      case 'welcome':
        ctx.myId = m.id;
        for (const p of m.players) ctx.players.set(p.id, { ...p, ping: 0 });
        ctx.connected = true;
        $('sdk-status').textContent = 'Verbunden.';
        $('sdk-menu').classList.remove('sdk-hidden');
        o.onWelcome?.(m, ctx);
        window.launcher?.reportReady?.();
        return;
      case 'error': ctx.showError(m.text); return;
      case 'pjoin': ctx.players.set(m.p.id, { ...m.p, ping: 0 }); break;
      case 'pleave': ctx.players.delete(m.id); break;
      case 'pong': ctx.rtt = Math.round(performance.now() - m.c); return;
      case 'scores': for (const [id, score, ping] of m.s) { const p = ctx.players.get(id); if (p) Object.assign(p, { score, ping }); } break;
      case 'chat': ctx.chatLine(m.name, m.color, m.text); sfx.tone(1200, 0.05, 'sine', 0.15); break;
      case 'msg': ctx.toast(m.text); if (m.end) ctx.showError(m.text); break;
    }
    o.onMessage?.(m, ctx);
  };
  try {
    await new Promise((resolve, reject) => {
      const host = launch.address.includes(':') ? `[${launch.address}]` : launch.address;
      ws = new WebSocket(`ws://${host}:${launch.port}`);
      const timer = setTimeout(() => { ws.close(); reject(new Error('Zeitüberschreitung – Host nicht erreichbar.')); }, 8000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = () => {};
      ws.onclose = () => { clearTimeout(timer); reject(new Error('Verbindung fehlgeschlagen (Adresse, Port, Firewall prüfen).')); if (ctx.connected && !ctx.ended) ctx.showError('Verbindung zum Host verloren.'); };
      ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMsg(m); };
    });
    ctx.send({ t: 'join', name: launch.name || 'Spieler', password: launch.password || '', version: o.version });
    setInterval(() => ctx.send({ t: 'ping', c: performance.now(), rtt: ctx.rtt }), 2000);
  } catch (err) {
    ctx.showError(err.message);
  }

  // ---------- Schleife ----------
  let last = performance.now(), lastRender = 0, frames = 0, fpsT = 0, boardT = 0;
  const frame = (now) => {
    requestAnimationFrame(frame);
    const limit = settings.graphics.fpsLimit;
    if (limit > 0) {
      const interval = 1000 / limit;
      if (now - lastRender < interval - 0.5) return;
      lastRender = now - ((now - lastRender) % interval);
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ctx.time += dt;
    frames++; fpsT += dt;
    if (fpsT >= 1) { ctx.fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; $('sdk-ping').textContent = `${ctx.rtt} ms`; $('sdk-fps').textContent = `${ctx.fps} FPS`; }
    if (ctx.connected) {
      if (g) g.setTransform(ctx.dpr, 0, 0, ctx.dpr, 0, 0);
      o.onFrame?.(dt, ctx);
    }
    // Scoreboard (Tab halten)
    const board = ctx.keys.has('Tab') && !ctx.chatOpen;
    $('sdk-board').classList.toggle('sdk-hidden', !board);
    boardT -= dt;
    if (board && boardT <= 0) {
      boardT = 0.3;
      $('sdk-board-rows').innerHTML = ctx.ranking().map((p) => `<tr class="${p.id === ctx.myId ? 'me' : ''}"><td><span class="dot" style="background:${p.color}"></span></td><td>${esc(p.name)}</td><td>${p.score}</td><td>${p.bot ? 'BOT' : `${p.ping} ms`}</td></tr>`).join('');
    }
    for (const l of $('sdk-chat-log').children) l.classList.toggle('faded', !ctx.chatOpen && Number(l.dataset.until) < performance.now());
    ctx.pressedSet.clear();
    ctx.mouse.clicked = false;
  };
  requestAnimationFrame(frame);
  window.__gameDebug = () => ({ connected: ctx.connected, fps: ctx.fps, players: ctx.players.size, ...(o.debug?.(ctx) || {}) });
  window.__gamePlay = () => play();
  return ctx;
}

/** Zeichenhelfer für 2D-Spiele im einheitlichen Flat-Stil. */
export const draw = {
  hex(g, x, y, r, fill) {
    g.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    g.closePath(); g.fillStyle = fill; g.fill();
  },
  text(g, text, x, y, { size = 16, color = '#fff', align = 'center', weight = 800, shadow = true } = {}) {
    g.font = `${weight} ${size}px Segoe UI, sans-serif`;
    g.textAlign = align; g.textBaseline = 'middle';
    if (shadow) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillText(text, x, y + 2); }
    g.fillStyle = color; g.fillText(text, x, y);
  },
  panel(g, x, y, w, h, fill = 'rgba(27,34,44,.78)') { g.fillStyle = fill; g.fillRect(x, y, w, h); g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y + h - 3, w, 3); },
  shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
    return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
  },
};
export const lerp = (a, b, k) => a + (b - a) * k;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
