'use strict';
/**
 * Preload für Launcher- UND Spielfenster.
 * Stellt eine schmale, sichere API (window.launcher) bereit – kein Node-Zugriff im Renderer.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcher', {
  // Einstellungen
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  onSettingsChanged: (cb) => ipcRenderer.on('settings:changed', (_e, s) => cb(s)),

  // Spiele
  listGames: () => ipcRenderer.invoke('games:list'),
  rescanGames: () => ipcRenderer.invoke('games:rescan'),
  launchGame: (params) => ipcRenderer.invoke('game:launch', params),
  startGameServer: (gameId, opts) => ipcRenderer.invoke('game:startServer', gameId, opts),
  stopGameServer: () => ipcRenderer.invoke('game:stopServer'),
  onGameClosed: (cb) => ipcRenderer.on('game:closed', (_e, info) => cb(info)),

  // System / Netzwerk
  systemInfo: () => ipcRenderer.invoke('system:info'),
  networkInterfaces: () => ipcRenderer.invoke('net:interfaces'),
  screenResolutions: () => ipcRenderer.invoke('system:resolutions'),
  openGamesFolder: () => ipcRenderer.invoke('games:openFolder'),

  // Auto-Update
  updateState: () => ipcRenderer.invoke('update:get'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateState: (cb) => ipcRenderer.on('update:state', (_e, s) => cb(s)),

  // Tailscale
  tailscaleStatus: () => ipcRenderer.invoke('tailscale:status'),
  tailscaleInstall: () => ipcRenderer.invoke('tailscale:install'),
  tailscaleLogin: () => ipcRenderer.invoke('tailscale:login'),
  tailscaleInvite: () => ipcRenderer.invoke('tailscale:invite'),
  onTailscaleProgress: (cb) => ipcRenderer.on('tailscale:progress', (_e, p) => cb(p)),

  // Party (Server läuft im Main-Prozess, die Lobby-Verbindung macht der Renderer per WebSocket)
  hostParty: (opts) => ipcRenderer.invoke('party:host', opts),
  stopParty: () => ipcRenderer.invoke('party:stop'),

  // Nur im Spielfenster sinnvoll
  getLaunchParams: () => ipcRenderer.invoke('game:getLaunch'),
  exitGame: () => ipcRenderer.invoke('game:exit'),
  reportReady: () => ipcRenderer.send('game:ready'),
});
