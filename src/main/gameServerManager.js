'use strict';
/**
 * Startet/stoppt den Host-Server eines Spiels (Listen-Server-Modell).
 * Der Server-Code gehört zum Spiel (Manifest-Feld "server") und wird per dynamic import geladen.
 *
 * Vertrag für Spiel-Server-Module:
 *   export async function createServer({ port, host, password, bots, WebSocketServer, log })
 *     → { port: number, stop(): Promise<void> }
 */
const { pathToFileURL } = require('node:url');
const { WebSocketServer } = require('ws');
const sdk = require('../sdk/server.cjs'); // Spiele-SDK (Räume, Bots, Chat …) – wird jedem Spielserver übergeben

class GameServerManager {
  constructor(registry, log = console.log) {
    this.registry = registry;
    this.log = log;
    this.current = null; // { gameId, server }
  }

  get running() {
    return !!this.current;
  }

  /**
   * @param {string} gameId
   * @param {{port?:number, password?:string, bots?:number, localOnly?:boolean}} opts
   */
  async start(gameId, opts = {}) {
    await this.stop();
    const game = this.registry.get(gameId);
    if (!game) throw new Error(`Unbekanntes Spiel: ${gameId}`);
    if (!game.server) throw new Error(`${game.name} hat keinen Server-Teil.`);
    const file = this.registry.resolveFile(gameId, game.server);
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.createServer !== 'function') throw new Error('Server-Modul exportiert kein createServer().');
    const server = await mod.createServer({
      port: Number.isInteger(opts.port) ? opts.port : game.defaultPort,
      host: opts.localOnly ? '127.0.0.1' : '0.0.0.0',
      password: opts.password || '',
      bots: Math.max(0, Math.min(15, opts.bots | 0)),
      botDifficulty: opts.botDifficulty || 'normal',
      WebSocketServer,
      sdk,
      log: (m) => this.log(`[${gameId}-server] ${m}`),
    });
    this.current = { gameId, server };
    this.log(`[Server] ${game.name} läuft auf Port ${server.port}`);
    return { port: server.port };
  }

  async stop() {
    if (!this.current) return;
    const { server, gameId } = this.current;
    this.current = null;
    try { await server.stop(); } catch (e) { this.log(`[Server] Fehler beim Stoppen: ${e.message}`); }
    this.log(`[Server] ${gameId} gestoppt`);
  }
}

module.exports = { GameServerManager };
