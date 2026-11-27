'use strict';
/**
 * Tailscale-Integration: Spielen übers Internet ohne Portfreigabe.
 *  - status():   installiert? angemeldet? eigene 100.x-Adresse?
 *  - install():  lädt den OFFIZIELLEN Installer von pkgs.tailscale.com, prüft die digitale Signatur
 *                (muss gültig und von "Tailscale Inc." sein) und startet ihn (Windows fragt nach Admin-Rechten).
 *  - login():    startet die Anmeldung (öffnet die Tailscale-Login-Seite im Browser).
 * Tailscale wird nie ohne Klick des Nutzers installiert.
 */
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const INSTALLER_URL = 'https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe';
const SIGNER = /Tailscale/i;

function findExe() {
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Tailscale', 'tailscale.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// PSModulePath entfernen: sonst lädt Windows PowerShell 5.1 evtl. inkompatible Module einer PowerShell-7-Installation.
const cleanEnv = () => { const e = { ...process.env }; delete e.PSModulePath; return e; };
const run = (file, args, timeout = 8000) => new Promise((resolve) => {
  execFile(file, args, { timeout, windowsHide: true, env: cleanEnv() }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});

/** Wertet die Ausgabe von `tailscale status --json` aus (separat, damit testbar). */
function parseStatus(json) {
  let s;
  try { s = JSON.parse(json); } catch { return { installed: true, state: 'error', running: false }; }
  const state = s.BackendState || 'Unknown'; // Running | NeedsLogin | Stopped | NeedsMachineAuth | Starting
  const ips = (s.Self && s.Self.TailscaleIPs) || s.TailscaleIPs || [];
  const ipv4 = ips.find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)) || null;
  const users = s.User || {};
  const me = s.Self && users[s.Self.UserID];
  const peers = Object.values(s.Peer || {}).map((p) => ({ name: (p.HostName || p.DNSName || '?').replace(/\..*$/, ''), ip: (p.TailscaleIPs || []).find((ip) => ip.includes('.')) || null, online: !!p.Online }));
  return { installed: true, state, running: state === 'Running', ip: ipv4, account: me ? me.LoginName : null, host: s.Self ? s.Self.HostName : null, peers };
}

async function status() {
  if (process.platform !== 'win32') return { installed: false, state: 'unsupported', running: false };
  const exe = findExe();
  if (!exe) return { installed: false, state: 'NotInstalled', running: false };
  const r = await run(exe, ['status', '--json']);
  if (!r.stdout.trim()) return { installed: true, state: /not running|failed to connect/i.test(r.stderr) ? 'Stopped' : 'error', running: false, detail: r.stderr.trim().slice(0, 200) };
  return parseStatus(r.stdout);
}

/** Datei herunterladen mit Fortschritt (0..1). */
async function download(url, dest, onProgress) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download fehlgeschlagen (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  let done = 0;
  for await (const chunk of res.body) {
    out.write(chunk);
    done += chunk.length;
    if (total) onProgress?.(done / total);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
}

/** Prüft die Authenticode-Signatur (Windows-Bordmittel). */
async function verifySignature(file) {
  const ps = `$s = Get-AuthenticodeSignature -LiteralPath '${file.replace(/'/g, "''")}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`;
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], 30000);
  const [state, subject = ''] = r.stdout.trim().split('|');
  return { ok: state === 'Valid' && SIGNER.test(subject), state, subject };
}

/**
 * Installer laden, prüfen, starten. Gibt zurück, sobald der Installer läuft
 * (die eigentliche Installation bestätigt der Nutzer im Windows-Dialog).
 */
async function install({ onProgress, openPath }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lagerfeuer-tailscale-'));
  const file = path.join(dir, 'tailscale-setup.exe');
  onProgress?.({ step: 'download', p: 0 });
  await download(INSTALLER_URL, file, (p) => onProgress?.({ step: 'download', p }));
  onProgress?.({ step: 'verify' });
  const sig = await verifySignature(file);
  if (!sig.ok) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error(`Signatur des Installers ungültig (${sig.state || 'unbekannt'}) – Installation abgebrochen.`);
  }
  onProgress?.({ step: 'launch' });
  const err = await openPath(file); // ShellExecute → Windows zeigt die Admin-Abfrage (UAC)
  if (err) throw new Error(`Installer konnte nicht gestartet werden: ${err}`);
  return { file, signer: sig.subject };
}

/** Anmeldung starten: `tailscale up` gibt eine Login-URL aus, die wir im Browser öffnen. */
function login(openExternal) {
  return new Promise((resolve, reject) => {
    const exe = findExe();
    if (!exe) return reject(new Error('Tailscale ist nicht installiert.'));
    const child = spawn(exe, ['up'], { windowsHide: true });
    let opened = false;
    const onData = (d) => {
      const m = String(d).match(/https:\/\/login\.tailscale\.com\/\S+/);
      if (m && !opened) { opened = true; openExternal(m[0]); resolve({ url: m[0] }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => { if (!opened) code === 0 ? resolve({ alreadyUp: true }) : reject(new Error('Anmeldung konnte nicht gestartet werden – öffne Tailscale über das Symbol in der Taskleiste.')); });
    setTimeout(() => { if (!opened) { resolve({ pending: true }); } }, 15000);
  });
}

module.exports = { status, install, login, parseStatus, verifySignature, findExe, INSTALLER_URL };
