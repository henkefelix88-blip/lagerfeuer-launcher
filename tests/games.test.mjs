// Generischer Test für ALLE Spiele mit Server-Teil: Server starten, beitreten, Zustand empfangen,
// Bots laufen ohne Fehler, Passwortschutz greift. Neue Spiele werden automatisch mitgetestet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import WebSocket, { WebSocketServer } from 'ws';

const require = createRequire(import.meta.url);
const sdk = require('../src/sdk/server.cjs');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const games = readdirSync(join(root, 'games'))
  .map((d) => join(root, 'games', d, 'game.json'))
  .filter(existsSync)
  .map((f) => ({ ...JSON.parse(readFileSync(f, 'utf8')), dir: dirname(f) }))
  .filter((g) => g.server && g.id !== 'arena-shooter'); // Blumenfeld Arena hat eigene Tests

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const msgs = [];
  ws.on('message', (raw) => msgs.push(JSON.parse(raw)));
  return { ws, msgs, open: new Promise((r) => ws.on('open', r)), send: (o) => ws.send(JSON.stringify(o)) };
}
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('Timeout');
};

test('Kritzel & Raten: Maler wählt, richtige Antwort bleibt geheim und gibt Punkte', async () => {
  const mod = await import(pathToFileURL(join(root, 'games/kritzel/server/server.mjs')).href);
  const srv = await mod.createServer({ port: 0, host: '127.0.0.1', password: '', WebSocketServer, sdk, log: () => {} });
  try {
    const a = client(srv.port), b = client(srv.port);
    await Promise.all([a.open, b.open]);
    a.send({ t: 'join', name: 'Anna', version: 1 });
    b.send({ t: 'join', name: 'Ben', version: 1 });
    const drawerState = await until(() => [...a.msgs, ...b.msgs].find((m) => m.t === 's' && m.options), 5000);
    const drawerIsA = a.msgs.includes(drawerState);
    const [drawer, guesser] = drawerIsA ? [a, b] : [b, a];
    drawer.send({ t: 'choose', i: 0 });
    const withWord = await until(() => drawer.msgs.find((m) => m.t === 's' && m.ph === 'draw' && !m.word.includes('_')), 3000);
    drawer.send({ t: 'stroke', c: '#000', w: 6, pts: [1, 2, 3, 4] });
    await until(() => guesser.msgs.find((m) => m.t === 'stroke'));
    guesser.send({ t: 'chat', text: withWord.word.toUpperCase() });
    await until(() => guesser.msgs.find((m) => m.t === 'guessed'));
    await new Promise((r) => setTimeout(r, 200));
    assert.ok(!drawer.msgs.some((m) => m.t === 'chat' && m.text.toLowerCase() === withWord.word.toLowerCase()), 'Lösung darf nicht im Chat erscheinen');
    const guesserPlayer = [...srv.room.players.values()].find((p) => p.name === (drawerIsA ? 'Ben' : 'Anna'));
    assert.ok(guesserPlayer.score >= 50);
    a.ws.close(); b.ws.close();
  } finally { await srv.stop(); }
});

test('Vier in Reihe: Computer nutzt eine Siegchance', async () => {
  const mod = await import(pathToFileURL(join(root, 'games/vier/server/server.mjs')).href);
  const srv = await mod.createServer({ port: 0, host: '127.0.0.1', password: '', bots: 1, WebSocketServer, sdk, log: () => {} });
  try {
    const c = client(srv.port);
    await c.open;
    c.send({ t: 'join', name: 'Tester', version: 1 });
    await until(() => srv.game.phase === 'play');
    const g = srv.game;
    const botSeat = g.seats.findIndex((p) => p.bot);
    // Bot hat drei in der untersten Reihe, Spalte 3 gewinnt
    g.board = Array.from({ length: 6 }, () => Array(7).fill(0));
    for (const x of [0, 1, 2]) g.board[5][x] = botSeat + 1;
    g.turn = botSeat; g.botAt = 0;
    await until(() => g.phase === 'over', 3000);
    assert.equal(g.winner?.bot, true);
    c.ws.close();
  } finally { await srv.stop(); }
});

for (const game of games) {
  test(`${game.name}: Server, Beitritt, Zustand, Bots, Passwort`, async () => {
    const mod = await import(pathToFileURL(join(game.dir, game.server)).href);
    const errors = [];
    const srv = await mod.createServer({ port: 0, host: '127.0.0.1', password: 'pw', bots: game.supportsBots ? 3 : 0, WebSocketServer, sdk, log: (m) => { if (/Fehler/.test(m)) errors.push(m); } });
    try {
      const bad = client(srv.port);
      await bad.open;
      bad.send({ t: 'join', name: 'X', password: 'nein', version: 1 });
      await until(() => bad.msgs.find((m) => m.t === 'error'));

      const c = client(srv.port);
      await c.open;
      c.send({ t: 'join', name: 'Tester', password: 'pw', version: 1 });
      const w = await until(() => c.msgs.find((m) => m.t === 'welcome'));
      assert.ok(w.id > 0);
      await until(() => c.msgs.some((m) => m.t === 's') || game.turnBased, 3000);
      // 2 Sekunden laufen lassen, inkl. typischer Eingaben
      for (let i = 0; i < 20; i++) {
        c.send({ t: 'in', a: i / 3, b: i % 2 === 0, keys: { up: true, left: i % 2 === 0, fire: true }, x: 0, y: 0, z: 0, aim: 0.5, dir: 1 });
        await new Promise((r) => setTimeout(r, 100));
      }
      c.send({ t: 'chat', text: 'Hallo' });
      await until(() => c.msgs.some((m) => m.t === 'chat') || game.id === 'kritzel');
      assert.deepEqual(errors, [], `Fehler im Spielserver: ${errors.join('\n')}`);
      c.ws.close();
    } finally {
      await srv.stop();
    }
  });
}
