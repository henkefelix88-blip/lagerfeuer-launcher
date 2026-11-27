/**
 * Lagerfeuer Launcher – UI-Logik (Renderer).
 * Gliederung:  Zustand → Hilfsfunktionen → Bibliothek → Spielstart-Dialoge → Party → Einstellungen → Init
 */
import { icons } from './icons.js';
import { LauncherAudio } from './audio.js';
import { PartyClient } from './partyClient.js';
import { encodePartyCode, parseJoinTarget } from './partyCode.js';
import { runPerfCheck } from './perfCheck.js';

const api = window.launcher;
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ===================== Zustand =====================
const state = {
  settings: null,
  games: [],
  selectedGameId: null,
  system: null,
  party: new PartyClient(),
  partyInfo: null, // { code, address, port, password } nur beim Host
  partyNotices: [],
  perfRunning: false,
  gameRunning: false,
};
const audio = new LauncherAudio();

// ===================== Hilfsfunktionen =====================
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fillIcons(root = document) {
  for (const el of $$('[data-icon]', root)) el.innerHTML = icons[el.dataset.icon] || '';
}

function toast(msg, isError = false) {
  const el = document.createElement('div');
  el.className = `toast${isError ? ' error' : ''}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), isError ? 6500 : 4000);
  if (isError) audio.error();
}

/** Low-Poly-Avatar (Sechseck in Namensfarbe + Initiale). */
function avatar(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return `<svg class="avatar" viewBox="0 0 40 40"><polygon points="20,1 37,10.5 37,29.5 20,39 3,29.5 3,10.5" fill="hsl(${hue} 45% 38%)"/>
    <polygon points="20,1 37,10.5 20,20 3,10.5" fill="hsl(${hue} 50% 48%)"/>
    <text x="20" y="26" text-anchor="middle" font-size="16" font-weight="800" fill="#fff">${esc(name.slice(0, 1).toUpperCase())}</text></svg>`;
}

function openModal(html, onMount) {
  const modal = $('#modal');
  modal.innerHTML = html;
  fillIcons(modal);
  $('#modal-backdrop').classList.remove('hidden');
  onMount?.(modal);
  const first = $('input, select', modal);
  first?.focus();
}
function closeModal() {
  $('#modal-backdrop').classList.add('hidden');
  $('#modal').innerHTML = '';
}

let saveTimer = null;
/** Einstellungen ändern (mit kurzer Verzögerung speichern). */
function updateSettings(mutator) {
  mutator(state.settings);
  audio.apply(state.settings.audio);
  $('#player-name').textContent = state.settings.playerName;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    api.setSettings(state.settings);
  }, 250);
}

function currentGame() {
  return state.games.find((g) => g.id === state.selectedGameId) || state.games[0] || null;
}

function switchView(name) {
  for (const t of $$('.tab')) t.classList.toggle('active', t.dataset.view === name);
  for (const v of $$('.view')) v.classList.toggle('active', v.id === `view-${name}`);
  if (name === 'party') renderParty();
  if (name === 'settings') renderSettings();
}

async function launch(params) {
  if (state.gameRunning) return toast('Es läuft bereits ein Spiel.', true);
  try {
    state.gameRunning = true;
    audio.stopMusic();
    await api.launchGame({ name: state.settings.playerName, ...params });
  } catch (err) {
    state.gameRunning = false;
    toast(cleanError(err), true);
  }
}
const cleanError = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// ===================== Bibliothek =====================
function renderLibrary() {
  const g = currentGame();
  const view = $('#view-library');
  if (!g) {
    view.innerHTML = `<div class="panel"><h2>Keine Spiele gefunden</h2><p class="muted">Lege Spiele (Ordner mit game.json) in den Spiele-Ordner.</p></div>`;
    return;
  }
  view.innerHTML = `
    <div class="library">
      <div class="game-list"><div class="game-scroll">
        ${state.games.map((x) => `
          <button class="game-item ${x.id === g.id ? 'active' : ''}" data-game="${esc(x.id)}">
            ${x.icon ? `<img src="app://game/${esc(x.id)}/${esc(x.icon)}" alt="">` : icons.gamepad}
            <span><b>${esc(x.name)}</b><small>v${esc(x.version)}</small></span>
          </button>`).join('')}
        </div>
        <div class="list-actions">
          <button class="btn small grow" id="btn-folder" title="Eigenen Spiele-Ordner öffnen"><span data-icon="folder"></span>Ordner</button>
          <button class="btn small grow" id="btn-rescan" title="Spiele neu einlesen"><span data-icon="refresh"></span>Neu laden</button>
        </div>
      </div>
      <div class="hero">
        <div class="hero-cover">
          ${g.cover ? `<img src="app://game/${esc(g.id)}/${esc(g.cover)}" alt="">` : ''}
          <div class="title-plate"><h1>${esc(g.name)}</h1><div class="tagline">${esc(g.tagline)}</div></div>
        </div>
        <div class="hero-body">
          <p style="margin:0">${esc(g.description)}</p>
          <div class="meta"><span>Version ${esc(g.version)}</span><span>Bis zu ${g.maxPlayers} Spieler</span><span>Standard-Port ${g.defaultPort}</span></div>
          <div class="mode-buttons">
            <button class="btn primary big mode-btn" id="btn-single" ${g.modes.includes('singleplayer') ? '' : 'disabled'}>
              <span data-icon="single"></span>Singleplayer<small>Gegen Bots üben</small></button>
            <button class="btn green big mode-btn" id="btn-multi" ${g.modes.includes('multiplayer') ? '' : 'disabled'}>
              <span data-icon="multi"></span>Multiplayer<small>Hosten oder per IP verbinden</small></button>
            <button class="btn big mode-btn" id="btn-joinparty" ${g.modes.includes('party') ? '' : 'disabled'}>
              <span data-icon="join"></span>Party beitreten<small>Mit Party-Code</small></button>
          </div>
        </div>
      </div>
    </div>`;
  fillIcons(view);
  for (const b of $$('.game-item', view)) b.onclick = () => { audio.click(); state.selectedGameId = b.dataset.game; renderLibrary(); };
  $('#btn-folder').onclick = () => api.openGamesFolder();
  $('#btn-rescan').onclick = async () => { state.games = await api.rescanGames(); renderLibrary(); toast(`${state.games.length} Spiel(e) gefunden.`); };
  $('#btn-single').onclick = () => { audio.click(); singleplayerDialog(g); };
  $('#btn-multi').onclick = () => { audio.click(); multiplayerDialog(g); };
  $('#btn-joinparty').onclick = () => { audio.click(); joinPartyDialog(); };
}

// ===================== Spielstart-Dialoge =====================
function singleplayerDialog(g) {
  openModal(`
    <h2>Singleplayer – ${esc(g.name)}</h2>
    ${g.supportsBots ? `
    <label class="field">Anzahl Bots: <b id="bots-val">5</b><input type="range" id="bots" min="0" max="11" value="5"></label>
    <label class="field">Bot-Schwierigkeit
      <select id="diff"><option value="easy">Leicht</option><option value="normal" selected>Normal</option><option value="hard">Schwer</option></select></label>` : ''}
    <div class="actions"><button class="btn" id="cancel">Abbrechen</button><button class="btn primary" id="go"><span data-icon="play"></span>Starten</button></div>`,
  (m) => {
    const bots = $('#bots', m);
    if (bots) bots.oninput = () => ($('#bots-val', m).textContent = bots.value);
    $('#cancel', m).onclick = closeModal;
    $('#go', m).onclick = () => {
      closeModal();
      launch({ gameId: g.id, mode: 'singleplayer', bots: Number(bots?.value || 0), botDifficulty: $('#diff', m)?.value });
    };
  });
}

function multiplayerDialog(g) {
  const net = state.settings.network;
  openModal(`
    <h2>Multiplayer – ${esc(g.name)}</h2>
    <div class="seg"><button class="active" data-tab="host">Spiel hosten</button><button data-tab="join">Per IP verbinden</button></div>
    <div data-pane="host" style="display:flex;flex-direction:column;gap:12px">
      <div class="row">
        <label class="field grow">Port<input type="number" id="h-port" min="1024" max="65535" value="${net.gamePort}"></label>
        <label class="field grow">Passwort (leer = keins)<input type="password" id="h-pass" maxlength="64"></label>
      </div>
      ${g.supportsBots ? `<label class="field">Bots zusätzlich: <b id="hb-val">0</b><input type="range" id="h-bots" min="0" max="8" value="0"></label>` : ''}
      <div class="hint">Freunde verbinden sich mit deiner IP und dem Port. Über das Internet braucht es eine Portfreigabe (TCP ${net.gamePort}) oder Tailscale/ZeroTier – siehe README.</div>
    </div>
    <div data-pane="join" class="hidden" style="display:flex;flex-direction:column;gap:12px">
      <div class="row">
        <label class="field grow">IP-Adresse / Hostname<input type="text" id="j-addr" value="${esc(net.lastAddress)}" placeholder="z. B. 192.168.0.42"></label>
        <label class="field" style="width:120px">Port<input type="number" id="j-port" value="${net.gamePort}"></label>
      </div>
      <label class="field">Passwort<input type="password" id="j-pass" maxlength="64"></label>
    </div>
    <div class="actions"><button class="btn" id="cancel">Abbrechen</button><button class="btn green" id="go"><span data-icon="play"></span>Los geht's</button></div>`,
  (m) => {
    let tab = 'host';
    for (const b of $$('.seg button', m)) b.onclick = () => {
      tab = b.dataset.tab;
      $$('.seg button', m).forEach((x) => x.classList.toggle('active', x === b));
      $$('[data-pane]', m).forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== tab));
    };
    const hb = $('#h-bots', m);
    if (hb) hb.oninput = () => ($('#hb-val', m).textContent = hb.value);
    $('#cancel', m).onclick = closeModal;
    $('#go', m).onclick = () => {
      if (tab === 'host') {
        const port = Number($('#h-port', m).value);
        if (!(port >= 1024 && port <= 65535)) return toast('Port muss zwischen 1024 und 65535 liegen.', true);
        updateSettings((s) => (s.network.gamePort = port));
        closeModal();
        launch({ gameId: g.id, mode: 'host', port, password: $('#h-pass', m).value, bots: Number(hb?.value || 0) });
      } else {
        const address = $('#j-addr', m).value.trim();
        const port = Number($('#j-port', m).value);
        if (!address) return toast('Bitte eine IP-Adresse eingeben.', true);
        updateSettings((s) => (s.network.lastAddress = address));
        closeModal();
        launch({ gameId: g.id, mode: 'join', address, port, password: $('#j-pass', m).value });
      }
    };
  });
}

function joinPartyDialog() {
  openModal(`
    <h2>Party beitreten</h2>
    <label class="field">Party-Code (oder IP:Port)<input type="text" id="p-code" placeholder="XXXX-XXXX-XXXX" maxlength="64"></label>
    <label class="field">Passwort (falls gesetzt)<input type="password" id="p-pass" maxlength="64"></label>
    <div class="actions"><button class="btn" id="cancel">Abbrechen</button><button class="btn green" id="go"><span data-icon="join"></span>Beitreten</button></div>`,
  (m) => {
    $('#cancel', m).onclick = closeModal;
    const go = async () => {
      const target = parseJoinTarget($('#p-code', m).value, state.settings.network.partyPort);
      if (!target) return toast('Ungültiger Party-Code. Format: XXXX-XXXX-XXXX', true);
      $('#go', m).disabled = true;
      try {
        await joinParty(target.address, target.port, $('#p-pass', m).value);
        closeModal();
        switchView('party');
      } catch (err) {
        $('#go', m).disabled = false;
        toast(cleanError(err), true);
      }
    };
    $('#go', m).onclick = go;
    $('#p-code', m).onkeydown = (e) => e.key === 'Enter' && go();
  });
}

// ===================== Auto-Update =====================
let upd = { status: 'idle' };
function renderUpdate() {
  const chip = $('#update-chip');
  const show = ['downloading', 'ready'].includes(upd.status);
  chip.classList.toggle('hidden', !show);
  chip.classList.toggle('ready', upd.status === 'ready');
  if (upd.status === 'downloading') chip.innerHTML = `Update ${esc(upd.version)} wird geladen <span class="bar"><i style="width:${Math.round(upd.progress * 100)}%"></i></span>`;
  else if (upd.status === 'ready') chip.innerHTML = `<span data-icon="refresh"></span>Update ${esc(upd.version)} – jetzt neu starten`;
  fillIcons(chip);
  const st = $('#s-update-status');
  if (st) {
    st.textContent = {
      idle: '–', checking: 'Suche nach Updates …', uptodate: `Du hast die neueste Version (${upd.current}).`,
      downloading: `Lade Version ${upd.version} … ${Math.round(upd.progress * 100)} %`, ready: `Version ${upd.version} ist bereit – wird beim nächsten Neustart eingespielt.`,
      error: `Update-Fehler: ${upd.error}`, dev: 'Entwicklungsmodus – Updates nur in der fertigen .exe.', installing: 'Update wird eingespielt …',
    }[upd.status] || '';
    $('#s-update-now')?.classList.toggle('hidden', upd.status !== 'ready');
  }
}
function confirmUpdate() {
  if (state.gameRunning) return toast('Bitte zuerst das laufende Spiel beenden.', true);
  openModal(`
    <h2>Auf Version ${esc(upd.version)} aktualisieren?</h2>
    <p style="margin:0">Der Launcher startet kurz neu. Einstellungen und eigene Spiele bleiben erhalten.${state.party.connected ? '<br><b>Du verlässt dabei die Party.</b>' : ''}</p>
    <div class="actions"><button class="btn" id="u-later">Später</button><button class="btn green" id="u-go"><span data-icon="refresh"></span>Jetzt aktualisieren</button></div>`,
  (m) => {
    $('#u-later', m).onclick = () => { closeModal(); toast('Das Update wird beim nächsten Schließen des Launchers automatisch eingespielt.'); };
    $('#u-go', m).onclick = async () => { try { await api.updateInstall(); } catch (err) { toast(cleanError(err), true); } };
  });
}

// ===================== Tailscale =====================
// Spielen übers Internet ohne Portfreigabe: Status anzeigen, mit einem Klick installieren, anmelden, Freunde einladen.
const ts = { status: null, busy: null, pollUntil: 0 };

async function refreshTailscale() {
  try { ts.status = await api.tailscaleStatus(); } catch { ts.status = { installed: false, state: 'error' }; }
  for (const el of $$('.ts-slot')) { el.innerHTML = tsCardHtml(); bindTsCard(el); }
  return ts.status;
}

function tsCardHtml() {
  const s = ts.status;
  let dot = '#9aa7b8', title = 'Tailscale wird geprüft …', text = '', buttons = '';
  if (s?.state === 'unsupported') return '';
  if (ts.busy) { dot = '#ffd25a'; title = 'Tailscale wird eingerichtet …'; text = ts.busy; }
  else if (s && !s.installed) {
    dot = '#e2534a'; title = 'Tailscale ist nicht installiert';
    text = 'Damit spielt ihr übers Internet <b>ohne Portfreigabe</b> – wie in einem gemeinsamen LAN. Jeder Mitspieler braucht es einmal.';
    buttons = '<button class="btn primary small" data-ts="install">Tailscale installieren</button>';
  } else if (s && !s.running) {
    dot = '#ffd25a'; title = s.state === 'NeedsLogin' ? 'Tailscale: Anmeldung nötig' : 'Tailscale ist installiert, aber nicht verbunden';
    text = 'Melde dich einmal an (Google, Microsoft, GitHub …). Danach verbindet sich Tailscale automatisch mit Windows.';
    buttons = '<button class="btn primary small" data-ts="login">Anmelden / Verbinden</button>';
  } else if (s?.running) {
    dot = '#6abf4b'; title = `Tailscale verbunden – deine Adresse: ${esc(s.ip || '?')}`;
    const online = (s.peers || []).filter((p) => p.online);
    text = online.length ? `Im selben Netz online: ${online.map((p) => esc(p.name)).join(', ')}` : 'Noch keine anderen Geräte online. Lade deine Freunde in dein Tailnet ein (oder alle melden sich mit demselben Konto an).';
    buttons = '<button class="btn small" data-ts="invite">Freunde einladen</button>';
  }
  return `<div class="ts-card"><span class="ts-dot" style="background:${dot}"></span><div class="grow"><b>${title}</b><div class="muted" style="font-size:12px">${text}</div></div>${buttons}<button class="btn small" data-ts="refresh" title="Status aktualisieren"><span data-icon="refresh"></span></button></div>`;
}

function bindTsCard(root) {
  fillIcons(root);
  for (const b of $$('[data-ts]', root)) b.onclick = () => tailscaleAction(b.dataset.ts);
}

async function tailscaleAction(action) {
  audio.click();
  try {
    if (action === 'install') {
      ts.busy = 'Lade den offiziellen Installer von tailscale.com …';
      refreshTailscale();
      await api.tailscaleInstall();
      ts.busy = 'Installer gestartet – bitte im Windows-Fenster „Ja“ klicken und die Installation abschließen.';
      refreshTailscale();
      toast('Tailscale-Installer gestartet. Danach hier auf „Anmelden“ klicken.');
      pollTailscale();
    } else if (action === 'login') {
      const r = await api.tailscaleLogin();
      toast(r.alreadyUp ? 'Tailscale ist verbunden.' : 'Anmeldeseite im Browser geöffnet – nach dem Login verbindet sich Tailscale automatisch.');
      pollTailscale();
    } else if (action === 'invite') {
      await api.tailscaleInvite();
      toast('Tailscale-Verwaltung im Browser geöffnet: Unter „Users“ → „Invite users“ deine Freunde einladen.');
    } else await refreshTailscale();
  } catch (err) {
    ts.busy = null;
    toast(cleanError(err), true);
    refreshTailscale();
  }
}

/** Nach Installation/Anmeldung einige Minuten lang den Status nachfragen. */
function pollTailscale() {
  ts.pollUntil = Date.now() + 5 * 60 * 1000;
  const tick = async () => {
    const before = ts.status?.state;
    const s = await refreshTailscale();
    if (s.installed && ts.busy) { ts.busy = null; refreshTailscale(); toast('Tailscale ist installiert! Jetzt anmelden.'); }
    if (s.running && before !== 'Running') { toast(`Tailscale verbunden (${s.ip}). Beim Party-Erstellen wird diese Adresse automatisch gewählt.`); renderParty(); return; }
    if (Date.now() < ts.pollUntil) setTimeout(tick, 3000);
  };
  setTimeout(tick, 3000);
}

/** Einmalige Frage beim ersten Start. */
async function maybeAskTailscale() {
  if (state.settings.tailscale?.prompted) return;
  const s = await refreshTailscale();
  if (s.state === 'unsupported' || s.running) return updateSettings((x) => (x.tailscale = { prompted: true }));
  openModal(`
    <h2>Mit Freunden übers Internet spielen?</h2>
    <p style="margin:0">Am einfachsten geht das mit <b>Tailscale</b> (kostenlos): Es verbindet eure PCs wie in einem gemeinsamen Heimnetz – <b>ohne Portfreigabe am Router</b>.</p>
    <div class="hint">Der Launcher lädt den offiziellen Installer von tailscale.com, prüft dessen digitale Signatur und startet ihn. Windows fragt dabei nach Administrator-Rechten. Danach meldest du dich einmal an.</div>
    <div class="actions"><button class="btn" id="later">Später</button><button class="btn primary" id="go">${s.installed ? 'Jetzt anmelden' : 'Tailscale installieren'}</button></div>`,
  (m) => {
    const done = () => { updateSettings((x) => (x.tailscale = { prompted: true })); closeModal(); };
    $('#later', m).onclick = () => { done(); toast('Du findest Tailscale jederzeit unter Party oder Einstellungen.'); };
    $('#go', m).onclick = () => { done(); tailscaleAction(s.installed ? 'login' : 'install'); };
  });
}

// ===================== Party =====================
async function joinParty(address, port, password, hostToken) {
  await state.party.connect({ address, port, name: state.settings.playerName, password, hostToken });
  state.partyNotices = [];
  audio.success();
  // Leistungscheck direkt nach dem Beitritt im Hintergrund – für die automatische Host-Wahl.
  runPerf();
}

async function runPerf() {
  if (state.perfRunning) return;
  state.perfRunning = true;
  renderParty();
  try {
    const perf = await runPerfCheck(state.system);
    state.party.send({ t: 'perf', perf });
  } finally {
    state.perfRunning = false;
    renderParty();
  }
}

async function createParty(advertise, port, password) {
  try {
    const gameId = currentGame()?.id || null;
    const { port: realPort, hostToken } = await api.hostParty({ port, password, gameId });
    state.partyInfo = { address: advertise, port: realPort, code: encodePartyCode(advertise, realPort), password };
    await joinParty('127.0.0.1', realPort, password, hostToken);
    toast(`Party erstellt. Code: ${state.partyInfo.code}`);
  } catch (err) {
    state.partyInfo = null;
    await api.stopParty();
    toast(cleanError(err), true);
  }
}

async function leaveParty() {
  state.party.disconnect(true);
  if (state.partyInfo) await api.stopParty();
  state.partyInfo = null;
  renderParty();
}

function setupPartyEvents() {
  const p = state.party;
  p.addEventListener('state', () => renderParty());
  p.addEventListener('notice', (e) => {
    state.partyNotices.unshift(`${new Date().toLocaleTimeString().slice(0, 5)}  ${e.detail.msg}`);
    state.partyNotices.length = Math.min(state.partyNotices.length, 30);
    renderParty();
  });
  p.addEventListener('closed', (e) => toast(e.detail.reason, true));
  p.addEventListener('disconnected', () => {
    if (state.partyInfo) api.stopParty();
    state.partyInfo = null;
    toast('Verbindung zur Party getrennt.', true);
    renderParty();
  });
  // Dieser PC wurde als Spiel-Host ausgewählt → Spielserver starten und Port melden.
  p.addEventListener('hostRequest', async (e) => {
    const { gameId, password } = e.detail;
    try {
      const { port } = await api.startGameServer(gameId, { port: state.settings.network.gamePort, password, bots: 0 });
      p.send({ t: 'hostReady', port });
    } catch (err) {
      p.send({ t: 'hostFailed', error: cleanError(err) });
      toast(`Spielserver konnte nicht starten: ${cleanError(err)}`, true);
    }
  });
  // Host hat das Spiel gestartet → automatisch beitreten.
  p.addEventListener('launch', (e) => {
    const { gameId, port, password } = e.detail;
    const address = e.detail.address === '$PARTY_HOST' ? p.address : e.detail.address;
    if (!state.games.find((g) => g.id === gameId)) return toast('Dieses Spiel ist bei dir nicht installiert.', true);
    launch({ gameId, mode: 'party', address, port, password });
  });
}

async function renderParty() {
  const view = $('#view-party');
  const p = state.party;
  const badge = $('#party-badge');
  badge.classList.toggle('hidden', !p.connected);
  badge.textContent = p.state?.members.length || 0;
  if (!view.classList.contains('active')) return;

  if (!p.connected) {
    const ifaces = await api.networkInterfaces();
    const net = state.settings.network;
    view.innerHTML = `
      <div class="ts-slot" style="max-width:980px;margin:0 auto 20px">${tsCardHtml()}</div>
      <div class="party-start">
        <div class="panel">
          <h2>Party erstellen</h2>
          <p class="muted" style="margin:0">Du wirst Party-Host und bekommst einen Code für deine Freunde. Der Code enthält deine Adresse – es wird kein externer Server benötigt.</p>
          <label class="field">Erreichbar über
            <select id="c-addr">
              ${ifaces.map((i) => `<option value="${i.address}">${esc(i.kind)} – ${i.address} (${esc(i.name)})</option>`).join('')}
              <option value="manual">Andere Adresse (z. B. öffentliche IP) …</option>
            </select></label>
          <input type="text" id="c-manual" class="hidden" placeholder="Öffentliche IPv4, z. B. 84.130.12.7">
          <div class="row">
            <label class="field grow">Party-Port<input type="number" id="c-port" value="${net.partyPort}" min="1024" max="65535"></label>
            <label class="field grow">Passwort (empfohlen)<input type="password" id="c-pass" maxlength="64"></label>
          </div>
          <div class="hint">${ifaces.some((i) => i.kind === 'Tailscale') ? 'Tailscale ist aktiv – deine Freunde brauchen nur Tailscale (im selben Netz) und den Code.' : `Im LAN oder mit Tailscale funktioniert es sofort. Ohne Tailscale übers Internet: Ports ${net.partyPort} (Party) und ${net.gamePort} (Spiel) per TCP freigeben und „öffentliche IP“ wählen.`}</div>
          <button class="btn primary big" id="c-go"><span data-icon="plus"></span>Party erstellen</button>
        </div>
        <div class="panel">
          <h2>Party beitreten</h2>
          <p class="muted" style="margin:0">Gib den Code ein, den dir der Host geschickt hat.</p>
          <label class="field">Party-Code (oder IP:Port)<input type="text" id="j-code" placeholder="XXXX-XXXX-XXXX"></label>
          <label class="field">Passwort<input type="password" id="j-pass" maxlength="64"></label>
          <button class="btn green big" id="j-go"><span data-icon="join"></span>Beitreten</button>
        </div>
      </div>`;
    fillIcons(view);
    bindTsCard($('.ts-slot', view));
    if (!ts.status) refreshTailscale();
    $('#c-addr').onchange = () => $('#c-manual').classList.toggle('hidden', $('#c-addr').value !== 'manual');
    if (!ifaces.length) { $('#c-addr').value = 'manual'; $('#c-manual').classList.remove('hidden'); }
    $('#c-go').onclick = async () => {
      audio.click();
      const sel = $('#c-addr').value;
      const addr = sel === 'manual' ? $('#c-manual').value.trim() : sel;
      const port = Number($('#c-port').value);
      try { encodePartyCode(addr, port); } catch (e) { return toast(e.message, true); }
      updateSettings((s) => (s.network.partyPort = port));
      $('#c-go').disabled = true;
      await createParty(addr, port, $('#c-pass').value);
      renderParty();
    };
    $('#j-go').onclick = async () => {
      audio.click();
      const t = parseJoinTarget($('#j-code').value, net.partyPort);
      if (!t) return toast('Ungültiger Party-Code.', true);
      $('#j-go').disabled = true;
      try { await joinParty(t.address, t.port, $('#j-pass').value); } catch (err) { toast(cleanError(err), true); }
      renderParty();
    };
    return;
  }

  const s = p.state;
  if (!s) return;
  const me = p.me();
  const isHost = !!me?.isHost;
  const gameHost = s.members.find((m) => m.id === s.gameHostId);
  const selectedGame = state.games.find((g) => g.id === s.gameId);
  const notReady = s.members.filter((m) => !m.ready).length;
  view.innerHTML = `
    <div class="lobby">
      <div class="side">
        <div class="panel">
          <h2>Party-Lobby</h2>
          ${state.partyInfo ? `
          <div class="code-box">
            <div><div class="muted" style="font-size:12px">PARTY-CODE</div><div class="code" id="code">${state.partyInfo.code}</div></div>
            <button class="btn small" id="copy"><span data-icon="copy"></span>Kopieren</button>
          </div>
          <p class="muted" style="font-size:12px;margin:8px 0 0">Adresse: ${esc(state.partyInfo.address)}:${state.partyInfo.port} · ${s.hasPassword ? 'mit Passwort geschützt' : 'ohne Passwort'}</p>` :
          `<p class="muted" style="margin:0">Verbunden mit ${esc(p.address)}:${p.port}</p>`}
        </div>
        <div class="panel">
          <h2>Mitglieder (${s.members.length})</h2>
          <div class="members">
            ${s.members.map((m) => `
              <div class="member">
                ${avatar(m.name)}
                <div>
                  <div class="name">${esc(m.name)}${m.id === p.myId ? ' <span class="muted">(du)</span>' : ''}
                    ${m.isHost ? '<span class="pill host">PARTY-HOST</span>' : ''}
                    ${m.id === s.gameHostId ? '<span class="pill suggest">SPIEL-HOST</span>' : ''}</div>
                  <div class="sub">${m.perf ? `Leistung ${m.perf.score} · ${esc(m.perf.cores)} Kerne · ${esc(m.perf.ramGb)} GB · ${esc(m.perf.gpu)}` : 'Leistungscheck ausstehend …'}</div>
                </div>
                <span class="pill ${m.ready ? 'ready' : 'notready'}">${m.ready ? 'BEREIT' : 'NICHT BEREIT'}</span>
                ${isHost && !m.isHost ? `<button class="btn small" data-kick="${m.id}" title="Entfernen"><span data-icon="cross"></span></button>` : '<span></span>'}
              </div>`).join('')}
          </div>
        </div>
        <div class="panel"><h2>Ereignisse</h2><div class="notices">${state.partyNotices.map((n) => `<div>${esc(n)}</div>`).join('') || '<div>–</div>'}</div></div>
      </div>
      <div class="side">
        <div class="panel" style="display:flex;flex-direction:column;gap:12px">
          <h2>Spiel</h2>
          <label class="field">Spiel
            <select id="l-game" ${isHost ? '' : 'disabled'}>${state.games.map((g) => `<option value="${g.id}" ${g.id === s.gameId ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
            ${s.gameId && !selectedGame ? `<option selected>${esc(s.gameId)} (nicht installiert)</option>` : ''}</select></label>
          <label class="field">Spiel-Host (wer den Server betreibt)
            <select id="l-host" ${isHost ? '' : 'disabled'}>
              <option value="auto" ${s.gameHostMode === 'auto' ? 'selected' : ''}>Automatisch: stärkster PC${s.gameHostMode === 'auto' && gameHost ? ` (${esc(gameHost.name)})` : ''}</option>
              ${s.members.map((m) => `<option value="${m.id}" ${s.gameHostMode === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
            </select></label>
          <button class="btn" id="l-perf" ${state.perfRunning ? 'disabled' : ''}><span data-icon="cpu"></span>${state.perfRunning ? 'Leistungscheck läuft …' : 'Leistungscheck wiederholen'}</button>
          <div class="hint">Der Spiel-Host muss für alle erreichbar sein (gleiches LAN/VPN oder Portfreigabe für TCP ${state.settings.network.gamePort}).</div>
        </div>
        <div class="panel" style="display:flex;flex-direction:column;gap:12px">
          <button class="btn big ${me?.ready ? '' : 'green'}" id="l-ready"><span data-icon="check"></span>${me?.ready ? 'Nicht mehr bereit' : 'Bereit'}</button>
          ${isHost ? `<button class="btn primary big" id="l-start" ${s.inGame ? 'disabled' : ''}><span data-icon="play"></span>${s.inGame ? 'Spiel läuft …' : `Spiel starten${notReady ? ` (${notReady} nicht bereit)` : ''}`}</button>` :
            `<p class="muted" style="margin:0;text-align:center">${s.inGame ? 'Spiel läuft …' : 'Warte auf den Host …'}</p>`}
          <button class="btn danger" id="l-leave"><span data-icon="exit"></span>${isHost ? 'Party auflösen' : 'Party verlassen'}</button>
        </div>
      </div>
    </div>`;
  fillIcons(view);
  $('#copy')?.addEventListener('click', () => { navigator.clipboard.writeText(state.partyInfo.code); toast('Code kopiert.'); });
  $('#l-game').onchange = (e) => p.send({ t: 'setGame', gameId: e.target.value });
  $('#l-host').onchange = (e) => p.send({ t: 'setGameHost', memberId: e.target.value === 'auto' ? 'auto' : Number(e.target.value) });
  $('#l-perf').onclick = () => runPerf();
  $('#l-ready').onclick = () => { audio.click(); p.send({ t: 'ready', ready: !me?.ready }); };
  $('#l-start')?.addEventListener('click', () => { audio.success(); p.send({ t: 'start' }); });
  $('#l-leave').onclick = () => leaveParty();
  for (const b of $$('[data-kick]', view)) b.onclick = () => p.send({ t: 'kick', memberId: Number(b.dataset.kick) });
}

// ===================== Einstellungen =====================
const KEY_LABELS = {
  forward: 'Vorwärts', back: 'Rückwärts', left: 'Links', right: 'Rechts', jump: 'Springen', sprint: 'Boost (Sprinten)',
  reload: 'Nachladen', fire: 'Schießen', aim: 'Zielen / Zoom', item: 'Item einsetzen', chat: 'Chat öffnen', sneak: 'Schleichen (Fliegen: runter)',
  weapon1: 'Messer', weapon2: 'Pistole', weapon3: 'MP', weapon4: 'Sturmgewehr', weapon5: 'Schrotflinte', weapon6: 'Scharfschützengewehr', weapon7: 'Raketenwerfer', weapon8: 'Streitkolben (/mace)', windcharge: 'Windladung (/mace)',
  scoreboard: 'Scoreboard',
};
export function keyName(code) {
  const map = { ControlLeft: 'Strg links', ControlRight: 'Strg rechts', ShiftLeft: 'Shift links', ShiftRight: 'Shift rechts', AltLeft: 'Alt', Space: 'Leertaste',
    Mouse0: 'Linke Maustaste', Mouse1: 'Mittlere Maustaste', Mouse2: 'Rechte Maustaste', Mouse3: 'Maustaste 4', Mouse4: 'Maustaste 5', Tab: 'Tab', CapsLock: 'Feststell' };
  if (map[code]) return map[code];
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, 'Pfeil ');
}

async function renderSettings() {
  const s = state.settings;
  const view = $('#view-settings');
  const resolutions = await api.screenResolutions();
  if (!resolutions.includes(s.graphics.resolution)) resolutions.push(s.graphics.resolution);
  let devices = [];
  try { devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput'); } catch {}
  const slider = (id, label, val) => `<div class="slider-row"><span>${label}</span><input type="range" id="${id}" min="0" max="100" value="${Math.round(val * 100)}"><span id="${id}-v">${Math.round(val * 100)}%</span></div>`;
  view.innerHTML = `
    <div class="settings">
      <div class="panel" style="grid-column: 1 / -1">
        <h2>Updates</h2>
        <div class="row">
          <label class="row grow" style="font-weight:600"><input type="checkbox" id="s-update-auto" ${s.updates?.auto !== false ? 'checked' : ''}> Automatisch aktualisieren (neue Versionen von GitHub laden)</label>
          <span class="muted">Version ${esc(state.system.version)}</span>
          <button class="btn small" id="s-update-check"><span data-icon="refresh"></span>Jetzt suchen</button>
          <button class="btn small green hidden" id="s-update-now">Jetzt neu starten</button>
        </div>
        <div class="muted" id="s-update-status" style="font-size:12px"></div>
      </div>
      <div class="panel" style="grid-column: 1 / -1">
        <h2>Online spielen (Tailscale)</h2>
        <div class="ts-slot">${tsCardHtml()}</div>
      </div>
      <div class="panel">
        <h2>Spieler</h2>
        <label class="field">Spielername<input type="text" id="s-name" maxlength="20" value="${esc(s.playerName)}"></label>
      </div>
      <div class="panel">
        <h2>Audio</h2>
        ${slider('s-master', 'Master', s.audio.master)}
        ${slider('s-music', 'Musik', s.audio.music)}
        ${slider('s-sfx', 'Effekte', s.audio.sfx)}
        <div class="row">
          <label class="field grow">Ausgabegerät
            <select id="s-device">
              <option value="default">Systemstandard</option>
              ${devices.filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications').map((d, i) => `<option value="${esc(d.deviceId)}" ${d.deviceId === s.audio.outputDeviceId ? 'selected' : ''}>${esc(d.label || `Ausgabegerät ${i + 1}`)}</option>`).join('')}
            </select></label>
          <button class="btn" id="s-test" style="align-self:flex-end"><span data-icon="speaker"></span>Test</button>
        </div>
      </div>
      <div class="panel">
        <h2>Grafik</h2>
        <div class="row">
          <label class="field grow">Auflösung<select id="s-res">${resolutions.map((r) => `<option ${r === s.graphics.resolution ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
          <label class="field grow">Anzeigemodus<select id="s-mode">
            ${[['window', 'Fenster'], ['borderless', 'Randloses Fenster'], ['fullscreen', 'Vollbild']].map(([v, l]) => `<option value="${v}" ${v === s.graphics.displayMode ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <div class="row">
          <label class="field grow">FPS-Limit<select id="s-fps">
            ${[30, 60, 75, 120, 144, 165, 240, 0].map((f) => `<option value="${f}" ${f === s.graphics.fpsLimit ? 'selected' : ''}>${f ? `${f} FPS` : 'Unbegrenzt'}</option>`).join('')}</select></label>
          <label class="field grow">Qualität<select id="s-quality">
            ${[['low', 'Niedrig'], ['medium', 'Mittel'], ['high', 'Hoch'], ['ultra', 'Ultra']].map(([v, l]) => `<option value="${v}" ${v === s.graphics.quality ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
      </div>
      <div class="panel">
        <h2>Steuerung</h2>
        <div class="slider-row"><span>Maus-Empfindl.</span><input type="range" id="s-sens" min="10" max="400" value="${Math.round(s.controls.sensitivity * 100)}"><span id="s-sens-v">${s.controls.sensitivity.toFixed(2)}</span></div>
        <div class="slider-row"><span>Sichtfeld (FOV)</span><input type="range" id="s-fov" min="60" max="110" value="${s.controls.fov}"><span id="s-fov-v">${s.controls.fov}°</span></div>
        <label class="row" style="font-weight:600"><input type="checkbox" id="s-invert" ${s.controls.invertY ? 'checked' : ''}> Maus-Y invertieren</label>
      </div>
      <div class="panel" style="grid-column: 1 / -1">
        <h2>Tastenbelegung <span class="muted" style="text-transform:none;letter-spacing:0">– klicken, dann Taste oder Maustaste drücken (Esc bricht ab)</span></h2>
        <div class="keybinds">
          ${Object.keys(KEY_LABELS).map((k) => `<div class="keybind"><span>${KEY_LABELS[k]}</span><button class="keycap" data-bind="${k}">${esc(keyName(s.controls.keybinds[k]))}</button></div>`).join('')}
        </div>
        <div class="row" style="justify-content:flex-end"><button class="btn small" id="s-reset-keys"><span data-icon="refresh"></span>Standardbelegung</button></div>
      </div>
    </div>`;
  fillIcons(view);
  bindTsCard($('.ts-slot', view));
  refreshTailscale();
  $('#s-update-auto').onchange = (e) => updateSettings((x) => (x.updates = { auto: e.target.checked }));
  $('#s-update-check').onclick = async () => { audio.click(); upd = await api.updateCheck(); renderUpdate(); };
  $('#s-update-now').onclick = () => confirmUpdate();
  renderUpdate();

  $('#s-name').oninput = (e) => updateSettings((x) => (x.playerName = e.target.value.slice(0, 20) || 'Spieler'));
  for (const [id, key] of [['s-master', 'master'], ['s-music', 'music'], ['s-sfx', 'sfx']]) {
    $(`#${id}`).oninput = (e) => {
      $(`#${id}-v`).textContent = `${e.target.value}%`;
      updateSettings((x) => (x.audio[key] = Number(e.target.value) / 100));
    };
  }
  $('#s-device').onchange = (e) => updateSettings((x) => (x.audio.outputDeviceId = e.target.value));
  $('#s-test').onclick = () => audio.success();
  $('#s-res').onchange = (e) => updateSettings((x) => (x.graphics.resolution = e.target.value));
  $('#s-mode').onchange = (e) => updateSettings((x) => (x.graphics.displayMode = e.target.value));
  $('#s-fps').onchange = (e) => updateSettings((x) => (x.graphics.fpsLimit = Number(e.target.value)));
  $('#s-quality').onchange = (e) => updateSettings((x) => (x.graphics.quality = e.target.value));
  $('#s-sens').oninput = (e) => { const v = Number(e.target.value) / 100; $('#s-sens-v').textContent = v.toFixed(2); updateSettings((x) => (x.controls.sensitivity = v)); };
  $('#s-fov').oninput = (e) => { $('#s-fov-v').textContent = `${e.target.value}°`; updateSettings((x) => (x.controls.fov = Number(e.target.value))); };
  $('#s-invert').onchange = (e) => updateSettings((x) => (x.controls.invertY = e.target.checked));
  $('#s-reset-keys').onclick = () => {
    updateSettings((x) => (x.controls.keybinds = {
      forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ControlLeft', reload: 'KeyR',
      weapon1: 'Digit1', weapon2: 'Digit2', weapon3: 'Digit3', weapon4: 'Digit4', weapon5: 'Digit5', weapon6: 'Digit6', weapon7: 'Digit7',
      scoreboard: 'Tab', fire: 'Mouse0', aim: 'Mouse2', item: 'KeyQ', chat: 'KeyT', sneak: 'ShiftLeft', weapon8: 'Digit8', windcharge: 'KeyF' }));
    renderSettings();
  };
  for (const cap of $$('[data-bind]', view)) cap.onclick = () => listenForKey(cap);
}

/** Neue Taste für eine Aktion abfragen. */
function listenForKey(cap) {
  for (const c of $$('.keycap.listening')) c.classList.remove('listening');
  cap.classList.add('listening');
  cap.textContent = 'Taste drücken …';
  const finish = (code) => {
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('mousedown', onMouse, true);
    cap.classList.remove('listening');
    if (code) {
      const action = cap.dataset.bind;
      updateSettings((x) => {
        // Doppelte Belegung vermeiden: alte Aktion mit dieser Taste bekommt die bisherige Taste.
        const prev = x.controls.keybinds[action];
        for (const [k, v] of Object.entries(x.controls.keybinds)) if (v === code && k !== action) x.controls.keybinds[k] = prev;
        x.controls.keybinds[action] = code;
      });
      audio.click();
    }
    setTimeout(() => renderSettings(), 0);
  };
  const onKey = (e) => { e.preventDefault(); e.stopPropagation(); finish(e.code === 'Escape' ? null : e.code); };
  const onMouse = (e) => { e.preventDefault(); e.stopPropagation(); finish(`Mouse${e.button}`); };
  window.addEventListener('keydown', onKey, true);
  setTimeout(() => window.addEventListener('mousedown', onMouse, true), 0);
}

// ===================== Init =====================
async function init() {
  fillIcons();
  $('#brand').innerHTML = `${icons.logo}<div>LAGERFEUER<small>GAME LAUNCHER</small></div>`;
  [state.settings, state.games, state.system] = await Promise.all([api.getSettings(), api.listGames(), api.systemInfo()]);
  state.selectedGameId = state.games[0]?.id || null;
  $('#player-name').textContent = state.settings.playerName;
  audio.settings = { ...state.settings.audio };
  setupPartyEvents();
  renderLibrary();

  for (const t of $$('.tab')) t.onclick = () => { audio.click(); switchView(t.dataset.view); };
  $('#player-chip').onclick = () => switchView('settings');
  $('#modal-backdrop').onclick = (e) => e.target.id === 'modal-backdrop' && closeModal();
  window.addEventListener('keydown', (e) => e.key === 'Escape' && closeModal());
  // Audio darf erst nach einer Nutzerinteraktion starten.
  window.addEventListener('pointerdown', () => audio.startMusic(), { once: true });

  api.onGameClosed(({ hostedServer }) => {
    state.gameRunning = false;
    if (hostedServer && state.party.connected) state.party.send({ t: 'gameEnded' });
    audio.startMusic();
  });
  api.onSettingsChanged((s) => {
    if (saveTimer) return; // eigene, noch ausstehende Änderungen haben Vorrang
    state.settings = s;
    audio.apply(s.audio);
  });
  api.onTailscaleProgress((p) => {
    ts.busy = p.step === 'download' ? `Lade Tailscale herunter … ${Math.round((p.p || 0) * 100)} %` : p.step === 'verify' ? 'Prüfe die digitale Signatur von Tailscale …' : 'Starte den Installer …';
    for (const el of $$('.ts-slot')) { el.innerHTML = tsCardHtml(); bindTsCard(el); }
  });
  maybeAskTailscale();
  upd = await api.updateState();
  renderUpdate();
  api.onUpdateState((s) => {
    const becameReady = s.status === 'ready' && upd.status !== 'ready';
    upd = s;
    renderUpdate();
    if (becameReady) toast(`Update ${s.version} ist bereit – oben auf den grünen Knopf klicken oder einfach später neu starten.`);
  });
  $('#update-chip').onclick = () => { if (upd.status === 'ready') confirmUpdate(); };
}

init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:0;left:0;color:#f88">${esc(err.stack)}</pre>`);
});
