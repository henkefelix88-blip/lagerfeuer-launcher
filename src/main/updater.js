'use strict';
/**
 * Auto-Update über GitHub-Releases.
 *
 * Ablauf:
 *  1. check():    neueste Version über die GitHub-API abfragen und mit der eigenen vergleichen
 *  2. download(): Windows-ZIP herunterladen, SHA-256 mit der von GitHub gemeldeten Prüfsumme vergleichen
 *  3. prepare():  ZIP in einen Temp-Ordner entpacken und prüfen, dass die .exe enthalten ist
 *  4. apply():    kleines PowerShell-Skript starten, das wartet, bis der Launcher beendet ist,
 *                 die neuen Dateien über den Programmordner kopiert und (optional) neu startet.
 * Eigene Spiele im Ordner "games" neben der .exe und die Einstellungen (%APPDATA%) bleiben erhalten.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile, spawn } = require('node:child_process');

const REPO = 'henkefelix88-blip/lagerfeuer-launcher';
const API = () => process.env.LAGERFEUER_UPDATE_URL || `https://api.github.com/repos/${REPO}/releases/latest`;
const ASSET = /-Windows\.zip$/i;
const EXE_NAME = 'Lagerfeuer Launcher.exe';

/** true, wenn Version a neuer als b ist (x.y.z). */
function isNewer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; }
  return false;
}

async function check(current) {
  const res = await fetch(API(), { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Lagerfeuer-Launcher-Updater' } });
  if (!res.ok) throw new Error(`Update-Prüfung fehlgeschlagen (HTTP ${res.status})`);
  const rel = await res.json();
  const version = String(rel.tag_name || '').replace(/^v/, '');
  const asset = (rel.assets || []).find((a) => ASSET.test(a.name));
  if (!version || !asset) return { available: false, version, current };
  return {
    available: isNewer(version, current),
    version, current,
    asset: { url: asset.browser_download_url, name: asset.name, size: asset.size, sha256: /^sha256:/.test(asset.digest || '') ? asset.digest.slice(7) : null },
    notes: String(rel.body || '').slice(0, 2000),
  };
}

async function download(asset, onProgress) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lagerfeuer-update-'));
  const file = path.join(dir, asset.name);
  const res = await fetch(asset.url, { redirect: 'follow', headers: { 'User-Agent': 'Lagerfeuer-Launcher-Updater' } });
  if (!res.ok) throw new Error(`Download fehlgeschlagen (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length')) || asset.size || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(file);
  let done = 0;
  for await (const chunk of res.body) {
    hash.update(chunk);
    if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    done += chunk.length;
    if (total) onProgress?.(done / total);
  }
  await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
  const sha = hash.digest('hex');
  if (asset.sha256 && asset.sha256.toLowerCase() !== sha) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error('Prüfsumme des Updates stimmt nicht – Update verworfen.');
  }
  if (asset.size && done !== asset.size) throw new Error('Update unvollständig heruntergeladen.');
  return { dir, file, sha256: sha, verified: !!asset.sha256 };
}

const SYS32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');

/** ZIP entpacken mit dem in Windows 10/11 eingebauten tar.exe (unabhängig von PowerShell-Versionen). */
async function prepare(dl) {
  const target = path.join(dl.dir, 'neu');
  fs.mkdirSync(target, { recursive: true });
  await new Promise((resolve, reject) => {
    execFile(path.join(SYS32, 'tar.exe'), ['-xf', dl.file, '-C', target], { windowsHide: true, timeout: 300000 }, (err, _o, se) => (err ? reject(new Error(`Entpacken fehlgeschlagen: ${String(se || err.message).trim().slice(0, 200)}`)) : resolve()));
  });
  const find = (dir, depth = 0) => {
    if (fs.existsSync(path.join(dir, EXE_NAME))) return dir;
    if (depth > 2) return null;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) if (e.isDirectory()) { const r = find(path.join(dir, e.name), depth + 1); if (r) return r; }
    return null;
  };
  const appDir = find(target);
  if (!appDir) throw new Error('Update enthält keine Launcher-.exe.');
  return { ...dl, newAppDir: appDir };
}

/** Prüft, ob der Programmordner beschreibbar ist (sonst kann das Update nicht eingespielt werden). */
function canWrite(dir) {
  try { const t = path.join(dir, `.schreibtest-${process.pid}`); fs.writeFileSync(t, 'x'); fs.rmSync(t); return true; } catch { return false; }
}

/**
 * Update einspielen: PowerShell-Skript wartet auf das Ende dieses Prozesses, kopiert, startet ggf. neu.
 * @param {{newAppDir:string, dir:string}} prep
 * @param {{installDir:string, exePath:string, pid:number, relaunch:boolean}} opts
 */
function apply(prep, { installDir, exePath, pid, relaunch }) {
  const log = path.join(prep.dir, 'update.log');
  // Batch-Skript (keine PowerShell nötig): warten bis der Launcher beendet ist, kopieren, ggf. neu starten.
  const script = [
    '@echo off',
    'chcp 65001 >NUL',
    'set /a tries=0',
    ':wait',
    `tasklist /FI "PID eq ${pid}" /NH 2>NUL | find " ${pid} " >NUL`,
    'if errorlevel 1 goto copy',
    'set /a tries+=1',
    'if %tries% GEQ 90 goto copy',
    'timeout /t 1 /nobreak >NUL',
    'goto wait',
    ':copy',
    'timeout /t 1 /nobreak >NUL',
    // /E = mit Unterordnern, ohne zu löschen → eigene Spiele im Ordner "games" bleiben erhalten
    `robocopy "${prep.newAppDir}" "${installDir}" /E /R:5 /W:1 /NFL /NDL /NJH /NJS /NP`,
    `echo robocopy exit %ERRORLEVEL% > "${log}"`,
    relaunch ? `start "" "${exePath}"` : '',
    'timeout /t 2 /nobreak >NUL',
    `rmdir /s /q "${path.join(prep.dir, 'neu')}"`,
  ].join('\r\n');
  const file = path.join(prep.dir, 'update.cmd');
  fs.writeFileSync(file, script, 'utf8');
  const child = spawn(path.join(SYS32, 'cmd.exe'), ['/d', '/c', file], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return { script: file, log };
}

module.exports = { check, download, prepare, apply, isNewer, canWrite, REPO };
