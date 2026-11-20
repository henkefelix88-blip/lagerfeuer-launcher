'use strict';
/**
 * Globale Einstellungen (für alle Spiele).
 * Werden als JSON im Benutzerordner gespeichert (%APPDATA%/Lagerfeuer Launcher/settings.json)
 * und beim Start geladen. Fehlende Felder werden mit Standardwerten ergänzt.
 */
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_KEYBINDS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  jump: 'Space',
  sprint: 'ControlLeft',
  reload: 'KeyR',
  weapon1: 'Digit1',
  weapon2: 'Digit2',
  weapon3: 'Digit3',
  weapon4: 'Digit4',
  weapon5: 'Digit5',
  weapon6: 'Digit6',
  weapon7: 'Digit7',
  scoreboard: 'Tab',
  fire: 'Mouse0',
  aim: 'Mouse2',
  item: 'KeyQ',
  chat: 'KeyT',
  sneak: 'ShiftLeft',
};

const DEFAULTS = {
  playerName: 'Spieler',
  audio: { master: 0.8, music: 0.5, sfx: 0.8, outputDeviceId: 'default' },
  graphics: { resolution: '1600x900', displayMode: 'window', fpsLimit: 144, quality: 'medium' },
  controls: { sensitivity: 1.0, invertY: false, fov: 80, keybinds: { ...DEFAULT_KEYBINDS } },
  network: { lastAddress: '', gamePort: 27015, partyPort: 27016 },
  tailscale: { prompted: false }, // Erststart-Frage "Tailscale installieren?" schon gezeigt?
};

/** Tiefes Zusammenführen: Werte aus `src` überschreiben `base`, unbekannte Typen werden verworfen. */
function merge(base, src) {
  if (!src || typeof src !== 'object') return structuredClone(base);
  const out = Array.isArray(base) ? [] : {};
  for (const key of Object.keys(base)) {
    const b = base[key];
    const s = src[key];
    if (b && typeof b === 'object' && !Array.isArray(b)) out[key] = merge(b, s);
    else out[key] = typeof s === typeof b ? s : b;
  }
  return out;
}

class SettingsStore {
  /** @param {string} dir Ordner, in dem settings.json liegt */
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return merge(DEFAULTS, raw);
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  get() {
    return structuredClone(this.data);
  }

  /** Übernimmt neue Einstellungen (validiert über merge) und speichert sie sofort. */
  set(next) {
    this.data = merge(DEFAULTS, next);
    this.data.playerName = String(this.data.playerName || 'Spieler').slice(0, 20).trim() || 'Spieler';
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    return this.get();
  }
}

module.exports = { SettingsStore, DEFAULTS, DEFAULT_KEYBINDS, merge };
