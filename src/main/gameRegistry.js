'use strict';
/**
 * Spiele-Registry: findet alle Spiele über ihre Manifest-Datei `game.json`.
 *
 * Ein Spiel ist einfach ein Ordner mit:
 *   game.json            – Manifest (Name, Beschreibung, Einstiegspunkte, Modi …)
 *   <client entry>.html  – wird im Spielfenster geladen
 *   <server entry>.mjs   – optional: Host-Server (export createServer)
 *
 * Durchsucht werden (in dieser Reihenfolge, spätere überschreiben frühere gleicher ID):
 *   1. <App>/games              – mitgelieferte Spiele
 *   2. <Ordner der .exe>/games  – neben der .exe abgelegte Spiele
 *   3. %APPDATA%/Lagerfeuer Launcher/games
 * Neue Spiele brauchen deshalb keinen Umbau des Launchers.
 */
const fs = require('node:fs');
const path = require('node:path');

const REQUIRED = ['id', 'name', 'client'];

function readManifest(dir) {
  const file = path.join(dir, 'game.json');
  if (!fs.existsSync(file)) return null;
  try {
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const k of REQUIRED) if (!m[k]) throw new Error(`Feld "${k}" fehlt`);
    if (!/^[a-z0-9-]+$/.test(m.id)) throw new Error('id darf nur a-z, 0-9 und - enthalten');
    return {
      id: m.id,
      name: m.name,
      version: m.version || '1.0.0',
      tagline: m.tagline || '',
      description: m.description || '',
      client: m.client,
      server: m.server || null,
      icon: m.icon || null,
      cover: m.cover || null,
      accent: m.accent || '#f08c32',
      modes: m.modes || ['singleplayer', 'multiplayer', 'party'],
      maxPlayers: m.maxPlayers || 8,
      defaultPort: m.defaultPort || 27015,
      supportsBots: !!m.supportsBots,
      order: Number.isFinite(m.order) ? m.order : 100,
      dir,
    };
  } catch (err) {
    console.warn(`[Registry] Ungültiges Manifest in ${dir}: ${err.message}`);
    return null;
  }
}

class GameRegistry {
  /** @param {string[]} roots Ordner, die nach Spielen durchsucht werden */
  constructor(roots) {
    this.roots = roots;
    this.games = new Map();
    this.scan();
  }

  scan() {
    this.games.clear();
    for (const root of this.roots) {
      if (!root || !fs.existsSync(root)) continue;
      for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const m = readManifest(path.join(root, entry.name));
        if (m) this.games.set(m.id, m);
      }
    }
    return this.list();
  }

  /** Reihenfolge: Feld "order" im Manifest (kleiner = weiter oben), sonst alphabetisch. */
  list() {
    return [...this.games.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'de'));
  }

  get(id) {
    return this.games.get(id) || null;
  }

  /** Öffentliche Sicht für den Renderer (ohne absolute Pfade). */
  publicList() {
    return this.list().map(({ dir, ...rest }) => rest);
  }

  /** Löst eine Datei innerhalb eines Spielordners sicher auf (kein Ausbrechen per ../). */
  resolveFile(id, rel) {
    const g = this.get(id);
    if (!g) return null;
    const full = path.normalize(path.join(g.dir, rel));
    if (!full.startsWith(path.normalize(g.dir + path.sep))) return null;
    return full;
  }
}

module.exports = { GameRegistry, readManifest };
