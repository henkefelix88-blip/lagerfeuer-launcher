'use strict';
/**
 * Lagerfeuer Launcher – Electron-Hauptprozess.
 *
 * Aufgaben:
 *  - Launcher-Fenster und Spielfenster verwalten
 *  - Einstellungen laden/speichern (SettingsStore)
 *  - Spiele finden (GameRegistry) und deren Host-Server starten (GameServerManager)
 *  - Party-Server hosten (PartyServer)
 *  - eigenes Protokoll app:// zum Laden von Launcher- und Spieldateien
 */
const { app, BrowserWindow, ipcMain, protocol, net, Menu, screen, shell, session } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { WebSocketServer } = require('ws');

const { SettingsStore } = require('./settings');
const { GameRegistry } = require('./gameRegistry');
const { GameServerManager } = require('./gameServerManager');
const { PartyServer } = require('./party/partyServer');

const SELFTEST = process.argv.includes('--selftest');
const LAUNCHER_DIR = path.join(__dirname, '..', 'launcher');
const SDK_DIR = path.join(__dirname, '..', 'sdk');

// Bildrate nicht an VSync koppeln – das FPS-Limit aus den Einstellungen regelt das Spiel selbst.
app.commandLine.appendSwitch('disable-frame-rate-limit');
// Nicht-Tab-Fenster nicht drosseln (Spiel läuft auch im Hintergrund flüssig weiter).
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Eigenes Schema "app" registrieren (muss vor app.ready passieren).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// ---------- globale Objekte ----------
let settings;
let registry;
let servers;
let party = null; // laufender PartyServer
let launcherWin = null;
let gameWin = null;
let gameLaunch = null; // Parameter für das aktuell laufende Spiel
const selftestErrors = [];

const SELFTEST_DIR = path.join(os.tmpdir(), 'lagerfeuer-selftest');
if (SELFTEST) {
  fs.mkdirSync(SELFTEST_DIR, { recursive: true });
  // Eigenes Profil, damit der Selbsttest die echten Einstellungen des Spielers nicht verändert.
  app.setPath('userData', path.join(SELFTEST_DIR, 'profile'));
  fs.writeFileSync(path.join(SELFTEST_DIR, 'selftest.log'), '');
}

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  // Gepackte Windows-Apps haben keine Konsole → beim Selbsttest zusätzlich in eine Datei schreiben.
  if (SELFTEST) fs.appendFileSync(path.join(SELFTEST_DIR, 'selftest.log'), `${line}\n`);
}

/** Ordner, in denen Spiele gesucht werden (siehe gameRegistry.js). */
function gameRoots() {
  const roots = [];
  if (app.isPackaged) roots.push(path.join(process.resourcesPath, 'games'));
  else roots.push(path.join(app.getAppPath(), 'games'));
  roots.push(path.join(path.dirname(app.getPath('exe')), 'games'));
  roots.push(path.join(app.getPath('userData'), 'games'));
  return [...new Set(roots)];
}

// ---------- app:// Protokoll ----------
// app://launcher/<datei>        → src/launcher/<datei>
// app://game/<spiel-id>/<datei> → <Spielordner>/<datei>
function registerProtocol() {
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let file = null;
    if (url.host === 'launcher') {
      file = path.normalize(path.join(LAUNCHER_DIR, rel));
      if (!file.startsWith(LAUNCHER_DIR)) file = null;
    } else if (url.host === 'sdk') {
      // Spiele-SDK für alle Spiele: app://sdk/client.js, app://sdk/ui.css, app://sdk/vendor/three.module.js
      file = path.normalize(path.join(SDK_DIR, rel));
      if (!file.startsWith(SDK_DIR)) file = null;
    } else if (url.host === 'game') {
      const [id, ...rest] = rel.split('/');
      file = registry.resolveFile(id, rest.join('/'));
    }
    if (!file || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
}

// ---------- Fenster ----------
function attachConsole(win, label) {
  win.webContents.on('console-message', (e) => {
    const isError = e.level === 'error';
    if (isError || !app.isPackaged) log(`[${label}] ${e.message}`);
    if (isError) selftestErrors.push(`[${label}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  win.webContents.on('render-process-gone', (_e, d) => selftestErrors.push(`[${label}] Renderer abgestürzt: ${d.reason}`));
  win.webContents.on('preload-error', (_e, p, err) => selftestErrors.push(`[${label}] Preload-Fehler: ${err.message}`));
}

function createLauncherWindow() {
  launcherWin = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#1b222c',
    title: 'Lagerfeuer Launcher',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  attachConsole(launcherWin, 'launcher');
  launcherWin.once('ready-to-show', () => launcherWin.show());
  launcherWin.loadURL('app://launcher/index.html');
  launcherWin.on('closed', () => {
    launcherWin = null;
    if (gameWin) gameWin.close();
  });
}

function openGameWindow(params) {
  const game = registry.get(params.gameId);
  const s = settings.get();
  const [w, h] = s.graphics.resolution.split('x').map(Number);
  const mode = s.graphics.displayMode;
  const display = screen.getPrimaryDisplay();
  const opts = {
    width: w || 1600,
    height: h || 900,
    useContentSize: true,
    backgroundColor: '#8fc3e8',
    title: game.name,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  };
  if (mode === 'borderless') Object.assign(opts, { frame: false, x: display.bounds.x, y: display.bounds.y, width: display.bounds.width, height: display.bounds.height });
  gameWin = new BrowserWindow(opts);
  gameWin.setMenu(null);
  if (mode === 'fullscreen') gameWin.setFullScreen(true);
  attachConsole(gameWin, params.gameId);
  gameLaunch = { ...params, settings: s, game: { id: game.id, name: game.name, version: game.version } };
  gameWin.once('ready-to-show', () => {
    gameWin.show();
    gameWin.focus();
  });
  gameWin.loadURL(`app://game/${game.id}/${game.client}`);
  if (launcherWin && !SELFTEST) launcherWin.minimize();

  gameWin.on('closed', async () => {
    const hostedServer = servers.running;
    gameWin = null;
    gameLaunch = null;
    await servers.stop();
    if (launcherWin) {
      launcherWin.restore();
      launcherWin.focus();
      launcherWin.webContents.send('game:closed', { hostedServer });
    }
  });
}

// ---------- Hilfsfunktionen ----------
function listInterfaces() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      let kind = 'LAN';
      let rank = 0; // kleiner = wahrscheinlicher die richtige Adresse
      const [p1, p2, p3] = a.address.split('.').map(Number);
      if (p1 === 100 && p2 >= 64 && p2 <= 127) { kind = 'Tailscale'; rank = 1; }
      else if (/zerotier/i.test(name)) { kind = 'ZeroTier'; rank = 1; }
      else if (/hamachi|radmin/i.test(name) || p1 === 25 || p1 === 26) { kind = 'VPN'; rank = 2; }
      else if (/vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback/i.test(name) || (p1 === 192 && p2 === 168 && p3 === 56) || (p1 === 172 && p2 >= 16 && p2 <= 31)) {
        kind = 'Virtuell'; rank = 3; // z. B. VirtualBox (192.168.56.x), Hyper-V/WSL (172.16–31.x)
      }
      out.push({ name, address: a.address, kind, rank });
    }
  }
  return out.sort((x, y) => x.rank - y.rank);
}

function listResolutions() {
  const common = ['1280x720', '1366x768', '1600x900', '1920x1080', '2560x1440', '3840x2160'];
  const set = new Set();
  for (const d of screen.getAllDisplays()) {
    const w = Math.round(d.size.width * d.scaleFactor);
    const h = Math.round(d.size.height * d.scaleFactor);
    set.add(`${d.size.width}x${d.size.height}`);
    for (const r of common) {
      const [rw, rh] = r.split('x').map(Number);
      if (rw <= w && rh <= h) set.add(r);
    }
  }
  return [...set].sort((a, b) => Number(a.split('x')[0]) - Number(b.split('x')[0]) || Number(a.split('x')[1]) - Number(b.split('x')[1]));
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (_e, s) => {
    const saved = settings.set(s);
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('settings:changed', saved);
    return saved;
  });

  ipcMain.handle('games:list', () => registry.publicList());
  ipcMain.handle('games:rescan', () => {
    registry.scan();
    return registry.publicList();
  });
  ipcMain.handle('games:openFolder', () => {
    const dir = path.join(app.getPath('userData'), 'games');
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
    return dir;
  });

  ipcMain.handle('system:info', () => ({
    cpu: os.cpus()[0]?.model?.trim() || 'Unbekannte CPU',
    cores: os.cpus().length,
    ramGb: Math.round(os.totalmem() / 1024 ** 3),
    platform: `${os.type()} ${os.release()}`,
    version: app.getVersion(),
  }));
  ipcMain.handle('system:resolutions', () => listResolutions());
  ipcMain.handle('net:interfaces', () => listInterfaces());

  // --- Party ---
  ipcMain.handle('party:host', async (_e, { port, password, gameId }) => {
    if (party) await party.close();
    party = new PartyServer({ WebSocketServer, port, password, gameId, log: (m) => log(`[Party] ${m}`) });
    try {
      await party.ready;
    } catch (err) {
      party = null;
      throw new Error(err.code === 'EADDRINUSE' ? `Port ${port} ist bereits belegt.` : err.message);
    }
    log(`[Party] Party-Server läuft auf Port ${party.port}`);
    return { port: party.port, hostToken: party.hostToken };
  });
  ipcMain.handle('party:stop', async () => {
    if (party) await party.close();
    party = null;
  });

  // --- Spielserver & Spielstart ---
  ipcMain.handle('game:startServer', async (_e, gameId, opts) => {
    try {
      return await servers.start(gameId, opts || {});
    } catch (err) {
      throw new Error(err.code === 'EADDRINUSE' ? `Port ${opts?.port} ist bereits belegt.` : err.message);
    }
  });
  ipcMain.handle('game:stopServer', () => servers.stop());

  /**
   * params: { gameId, mode: 'singleplayer'|'host'|'join'|'party', address, port, password, bots }
   *  - singleplayer: startet lokalen Server (nur 127.0.0.1) mit Bots
   *  - host:         startet öffentlichen Server und verbindet sich selbst
   *  - join/party:   verbindet sich mit address:port
   */
  ipcMain.handle('game:launch', async (_e, params) => {
    if (gameWin) throw new Error('Es läuft bereits ein Spiel.');
    const game = registry.get(params.gameId);
    if (!game) throw new Error('Spiel nicht gefunden.');
    const p = { ...params };
    if (p.mode === 'singleplayer') {
      const r = await servers.start(game.id, { port: 0, localOnly: true, bots: p.bots ?? 5, botDifficulty: p.botDifficulty, password: '' });
      Object.assign(p, { address: '127.0.0.1', port: r.port, password: '' });
    } else if (p.mode === 'host') {
      try {
        const r = await servers.start(game.id, { port: p.port, password: p.password, bots: p.bots || 0, botDifficulty: p.botDifficulty });
        Object.assign(p, { address: '127.0.0.1', port: r.port });
      } catch (err) {
        throw new Error(err.code === 'EADDRINUSE' ? `Port ${p.port} ist bereits belegt.` : err.message);
      }
    }
    openGameWindow(p);
    return { ok: true, port: p.port };
  });
  ipcMain.handle('game:getLaunch', () => gameLaunch);
  ipcMain.handle('game:exit', () => {
    if (gameWin) gameWin.close();
  });
  ipcMain.on('game:ready', () => log('[Spiel] Spielfenster bereit'));
}

// ---------- Selbsttest ----------
// `electron . --selftest` bzw. `Lagerfeuer Launcher.exe --selftest`:
// startet Launcher + Singleplayer-Match, macht Screenshots und beendet sich mit Exit-Code 0 (ok) / 1 (Fehler).
async function runSelftest() {
  const outDir = SELFTEST_DIR;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    const ui = (js) => launcherWin.webContents.executeJavaScript(js);
    const shot = async (name, win = launcherWin) => fs.writeFileSync(path.join(outDir, name), (await win.webContents.capturePage()).toPNG());
    await wait(2500);
    await shot('launcher.png');
    if (!registry.list().length) throw new Error('Keine Spiele gefunden');
    const only = (process.argv.find((a) => a.startsWith('--selftest-only=')) || '').split('=')[1];
    if (only) { await testAllGames(only.split(','), shot, wait); return finishSelftest(outDir); }

    // 1) Einstellungen-Ansicht
    await ui("document.querySelector('[data-view=settings]').click()");
    await wait(1200);
    await shot('settings.png');
    const devices = await ui("navigator.mediaDevices.enumerateDevices().then(d => JSON.stringify(d.filter(x => x.kind === 'audiooutput').map(x => x.label || '(ohne Name)')))");
    log(`[Selbsttest] Audio-Ausgabegeräte: ${devices}`);
    const options = await ui("document.querySelectorAll('#s-device option').length");
    if (JSON.parse(devices).length > 1 && options < 2) selftestErrors.push('Audio-Ausgabegeräte werden nicht in der Auswahl angezeigt');

    // 2) Party über die Oberfläche erstellen (Port 0 = freier Port), Leistungscheck abwarten
    await ui("document.querySelector('[data-view=party]').click()");
    await wait(800);
    await ui("document.getElementById('c-port').value = '27999'; document.getElementById('c-pass').value = 'test'; document.getElementById('c-go').click()");
    await wait(4000);
    const lobby = await ui("JSON.stringify({ code: document.querySelector('.code')?.textContent, members: document.querySelectorAll('.member').length, perf: document.querySelector('.member .sub')?.textContent })");
    log(`[Selbsttest] Party-Lobby: ${lobby}`);
    const lobbyState = JSON.parse(lobby);
    if (!lobbyState.code || lobbyState.members !== 1) selftestErrors.push(`Party-Lobby fehlerhaft: ${lobby}`);
    if (!/Leistung \d+/.test(lobbyState.perf || '')) selftestErrors.push('Leistungscheck lieferte kein Ergebnis');
    await shot('party.png');

    // 3) Host startet das Spiel → dieser PC wird Spiel-Host → Spielfenster öffnet sich automatisch
    await ui("document.getElementById('l-start').click()");
    await wait(10000);
    if (!gameWin) throw new Error('Party-Start hat kein Spielfenster geöffnet');
    const checkGame = async (label, minPlayers) => {
      const state = await gameWin.webContents.executeJavaScript('JSON.stringify(window.__gameDebug ? window.__gameDebug() : null)');
      log(`[Selbsttest] ${label}: ${state}`);
      const parsed = JSON.parse(state || 'null');
      if (!parsed || !parsed.connected) selftestErrors.push(`${label}: Spiel hat sich nicht mit dem Server verbunden`);
      else {
        if (parsed.players < minPlayers) selftestErrors.push(`${label}: nur ${parsed.players} Spieler (erwartet ≥ ${minPlayers})`);
        if (parsed.fps < 5) selftestErrors.push(`${label}: FPS zu niedrig (${parsed.fps})`);
      }
    };
    await checkGame('Party-Spiel', 1);
    await shot('game-menu.png', gameWin);

    // 4) Spiel schließen → zurück in der Lobby → Party auflösen
    gameWin.close();
    await wait(1500);
    const back = await ui("JSON.stringify({ inLobby: !!document.querySelector('.code'), running: document.getElementById('l-start')?.disabled })");
    log(`[Selbsttest] Nach Spielende: ${back}`);
    if (JSON.parse(back).running) selftestErrors.push('Lobby zeigt nach Spielende weiterhin "Spiel läuft"');
    await ui("document.getElementById('l-leave').click()");
    await wait(500);

    // 5) Singleplayer mit Bots über die Bibliothek starten
    await ui("document.querySelector('[data-view=library]').click(); document.getElementById('btn-single').click()");
    await wait(400);
    await ui("document.getElementById('go').click()");
    await wait(9000);
    if (!gameWin) throw new Error('Singleplayer hat kein Spielfenster geöffnet');
    await checkGame('Singleplayer', 4);
    await gameWin.webContents.executeJavaScript("document.getElementById('overlay').classList.add('hidden')");
    await wait(500);
    await shot('game.png', gameWin);
    if (await gameWin.webContents.executeJavaScript('window.__gameLookAtPlayer?.()')) {
      await wait(60);
      await shot('player-model.png', gameWin);
    }
    // Zusatz-Screenshots: Dorf/Gebäude, Waffen-Animationen, Zielfernrohr
    const js = (code) => gameWin.webContents.executeJavaScript(code);
    await js("document.getElementById('death').classList.add('hidden')");
    const blds = await js('JSON.stringify(window.__gameCamera(0, 6, 12, 0, -0.15, "rifle"))');
    log(`[Selbsttest] Gebäude: ${blds}`);
    await wait(400);
    await shot('village.png', gameWin);
    await js('window.__gameViewmodel("reload", 2)');
    await wait(900);
    await shot('reload.png', gameWin);
    await js('window.__gameCamera(0, 1, 30, 0, 0, "sniper"); window.__gameViewmodel("ads", true)');
    await wait(700);
    await shot('scope.png', gameWin);
    await js('window.__gameViewmodel("ads", false); window.__gameCamera(0, 1, 30, 0, 0, "rocket"); document.getElementById("overlay").classList.add("hidden")');
    await wait(600);
    await shot('rocket.png', gameWin);
    await js('window.__gameCamera(0, 1, 30, 0, 0, "knife")');
    await wait(500);
    await shot('knife.png', gameWin);
    await js('window.__gameViewmodel("shoot")');
    await wait(110);
    await shot('knife-slash.png', gameWin);
    await js('window.__gameCamera(0, 1, 30, 0, 0, "shotgun"); document.getElementById("overlay").classList.add("hidden")');
    await wait(500);
    await js('window.__gameViewmodel("reload", 2.6)');
    await wait(1100);
    await shot('shotgun-reload.png', gameWin);
    gameWin.close();
    await wait(1500);
    // 6) Alle weiteren Spiele kurz anspielen
    await testAllGames(registry.list().map((g) => g.id).filter((id) => id !== 'arena-shooter'), shot, wait);
  } catch (err) {
    selftestErrors.push(`Selbsttest-Ausnahme: ${err.stack || err.message}`);
  }
  finishSelftest(outDir);
}

/** Startet jedes Spiel (Singleplayer mit Bots bzw. Host), drückt "Spielen", prüft Verbindung/FPS, macht einen Screenshot. */
async function testAllGames(ids, shot, wait) {
  for (const id of ids) {
    const before = selftestErrors.length;
    await testOneGame(id, shot, wait);
    if (selftestErrors.length > before) { // einmal wiederholen (z. B. versehentlicher Klick ins Fenster)
      log(`[Selbsttest] ${id}: Wiederholung nach Fehler: ${selftestErrors.slice(before).join('; ')}`);
      selftestErrors.length = before;
      await testOneGame(id, shot, wait);
    }
  }
}

async function testOneGame(id, shot, wait) {
  {
    const game = registry.get(id);
    if (!game) { selftestErrors.push(`Spiel ${id} nicht gefunden`); return; }
    try {
      const single = game.modes.includes('singleplayer');
      const r = await servers.start(id, { port: 0, localOnly: true, bots: game.supportsBots ? 4 : 0, password: '' });
      openGameWindow({ gameId: id, mode: single ? 'singleplayer' : 'host', address: '127.0.0.1', port: r.port, password: '', name: 'Tester' });
      await wait(3500);
      await gameWin.webContents.executeJavaScript('window.__gamePlay?.()', true).catch(() => {});
      await gameWin.webContents.executeJavaScript("document.getElementById('sdk-overlay')?.classList.add('sdk-hidden')");
      await wait(3000);
      const state = await gameWin.webContents.executeJavaScript('JSON.stringify(window.__gameDebug ? window.__gameDebug() : null)');
      log(`[Selbsttest] ${game.name}: ${state}`);
      const s = JSON.parse(state || 'null');
      if (!s || !s.connected) selftestErrors.push(`${game.name}: nicht verbunden`);
      else if (s.fps < 5) selftestErrors.push(`${game.name}: FPS zu niedrig (${s.fps})`);
      await shot(`game-${id}.png`, gameWin);
      gameWin.close();
      await wait(1200);
    } catch (err) {
      selftestErrors.push(`${game.name}: ${err.message}`);
      if (gameWin) gameWin.close();
      await wait(800);
    }
  }
}

function finishSelftest(outDir) {
  log(`[Selbsttest] Screenshots: ${outDir}`);
  if (selftestErrors.length) {
    log(`[Selbsttest] FEHLGESCHLAGEN:\n  ${selftestErrors.join('\n  ')}`);
    app.exit(1);
  } else {
    log('[Selbsttest] OK – keine Fehler.');
    app.exit(0);
  }
}

// ---------- Start ----------
if (!SELFTEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (launcherWin) {
      if (launcherWin.isMinimized()) launcherWin.restore();
      launcherWin.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    settings = new SettingsStore(app.getPath('userData'));
    registry = new GameRegistry(gameRoots());
    servers = new GameServerManager(registry, log);
    log(`Spiele gefunden: ${registry.list().map((g) => g.name).join(', ') || '(keine)'}`);
    // Nur unsere eigenen Seiten (app://) dürfen Audio-Ausgabegeräte auflisten/wählen und die Maus fangen.
    const allowed = new Set(['media', 'speaker-selection', 'pointerLock', 'clipboard-sanitized-write', 'fullscreen']);
    session.defaultSession.setPermissionCheckHandler((_wc, permission, origin) => origin.startsWith('app://') && allowed.has(permission));
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(wc.getURL().startsWith('app://') && allowed.has(permission)));
    registerProtocol();
    registerIpc();
    createLauncherWindow();
    if (SELFTEST) runSelftest();
  });

  app.on('window-all-closed', async () => {
    await servers?.stop();
    if (party) await party.close();
    app.quit();
  });
}
