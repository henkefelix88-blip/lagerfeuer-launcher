// Netzwerk-Tests (node --test): echter Spielserver + Party-Server mit WebSocket-Clients.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from '../games/arena-shooter/server/server.mjs';
import { PROTOCOL_VERSION, WEAPONS } from '../games/arena-shooter/shared/world.mjs';

const require = createRequire(import.meta.url);
const { PartyServer } = require('../src/main/party/partyServer.js');

/** Kleiner Test-Client, der alle Nachrichten sammelt. */
function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const msgs = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    msgs.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const open = new Promise((r) => ws.on('open', r));
  return {
    ws, msgs, open,
    send: (o) => ws.send(JSON.stringify(o)),
    wait: (pred, ms = 3000) => new Promise((resolve, reject) => {
      const found = msgs.find(pred);
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error('Timeout beim Warten auf Nachricht')), ms);
      waiters.push({ pred, resolve: (m) => { clearTimeout(timer); resolve(m); } });
    }),
    closed: new Promise((r) => ws.on('close', r)),
  };
}
const quiet = () => {};

test('Spielserver: Passwortschutz', async () => {
  const srv = await createServer({ port: 0, host: '127.0.0.1', password: 'geheim', WebSocketServer, log: quiet });
  try {
    const bad = client(srv.port);
    await bad.open;
    bad.send({ t: 'join', name: 'Eve', password: 'falsch', version: PROTOCOL_VERSION });
    const err = await bad.wait((m) => m.t === 'error');
    assert.match(err.text, /Passwort/);
    await bad.closed;

    const good = client(srv.port);
    await good.open;
    good.send({ t: 'join', name: 'Bob', password: 'geheim', version: PROTOCOL_VERSION });
    const w = await good.wait((m) => m.t === 'welcome');
    assert.ok(w.id > 0 && w.pickups.length > 0);
    good.ws.close();
  } finally {
    await srv.stop();
  }
});

test('Spielserver: Treffer, Kill, Kill-Feed und Respawn (Host entscheidet)', async () => {
  const srv = await createServer({ port: 0, host: '127.0.0.1', password: '', WebSocketServer, log: quiet });
  try {
    const a = client(srv.port), b = client(srv.port);
    await Promise.all([a.open, b.open]);
    a.send({ t: 'join', name: 'Anna', version: PROTOCOL_VERSION });
    const wa = await a.wait((m) => m.t === 'welcome');
    b.send({ t: 'join', name: 'Ben', version: PROTOCOL_VERSION });
    const wb = await b.wait((m) => m.t === 'welcome');
    const sa = await a.wait((m) => m.t === 'spawn' && m.id === wa.id);
    const sb = await b.wait((m) => m.t === 'spawn' && m.id === wb.id);

    // Beide auf eine freie Stelle stellen: Anna bei z=5, Ben bei z=0 (Anna schaut nach -Z auf Ben)
    const spot = { x: 0, z: 0 }; // Map-Mitte ist ein Waffen-Spawn → garantiert frei
    const pa = srv.game.players.get(wa.id), pb = srv.game.players.get(wb.id);
    Object.assign(pa, { x: spot.x, z: spot.z + 5, y: 0, protectedUntil: 0 });
    Object.assign(pb, { x: spot.x, z: spot.z, y: 0, protectedUntil: 0 });
    srv.game.rand = () => 0.5; // keine Streuung im Test
    assert.equal(sa.tid, pa.tid);
    assert.equal(sb.tid, pb.tid);

    // Kopfschüsse mit der Pistole bis zum Kill
    const shots = Math.ceil(100 / (WEAPONS.pistol.damage * 1.6));
    for (let i = 0; i < shots; i++) {
      pa.lastShot = -10;
      pb.protectedUntil = 0;
      a.send({ t: 'shoot', d: [0, 0.0045, -1] });
      await a.wait((m) => m.t === 'hitc' && !m._seen && (m._seen = true));
    }
    const kill = await b.wait((m) => m.t === 'kill');
    assert.equal(kill.k, wa.id);
    assert.equal(kill.v, wb.id);
    assert.equal(pa.kills, 1);
    assert.equal(pb.deaths, 1);
    const ammo = await a.wait((m) => m.t === 'you' && m.ammo.pistol.mag === WEAPONS.pistol.mag - shots);
    assert.ok(ammo);
    // Respawn nach RESPAWN_TIME
    const respawn = await b.wait((m) => m.t === 'spawn' && m.id === wb.id && m.tid > sb.tid, 5000);
    assert.ok(respawn);
    a.ws.close(); b.ws.close();
  } finally {
    await srv.stop();
  }
});

test('Spielserver: Bots bewegen sich und Pickups spawnen', async () => {
  const srv = await createServer({ port: 0, host: '127.0.0.1', bots: 4, WebSocketServer, log: quiet });
  try {
    const c = client(srv.port);
    await c.open;
    c.send({ t: 'join', name: 'Zuschauer', version: PROTOCOL_VERSION });
    const w = await c.wait((m) => m.t === 'welcome');
    assert.equal(w.players.filter((p) => p.bot).length, 4);
    const first = await c.wait((m) => m.t === 's');
    await new Promise((r) => setTimeout(r, 1500));
    const later = c.msgs.filter((m) => m.t === 's').at(-1);
    const moved = first.p.some(([id, x, , z]) => {
      const q = later.p.find((p) => p[0] === id);
      return q && Math.hypot(q[1] - x, q[3] - z) > 1;
    });
    assert.ok(moved, 'Bots haben sich nicht bewegt');
    assert.ok(w.pickups.filter((k) => k.kind === 'itembox').length >= 24, 'Item-Boxen fehlen');
    c.ws.close();
  } finally {
    await srv.stop();
  }
});

/** Zwei Spieler verbinden und auf freie Stellen stellen. */
async function duel(srv) {
  const a = client(srv.port), b = client(srv.port);
  await Promise.all([a.open, b.open]);
  a.send({ t: 'join', name: 'Anna', version: PROTOCOL_VERSION });
  const wa = await a.wait((m) => m.t === 'welcome');
  b.send({ t: 'join', name: 'Ben', version: PROTOCOL_VERSION });
  const wb = await b.wait((m) => m.t === 'welcome');
  await b.wait((m) => m.t === 'spawn' && m.id === wb.id);
  const pa = srv.game.players.get(wa.id), pb = srv.game.players.get(wb.id);
  const s = srv.game.world.playerSpawns[0];
  Object.assign(pa, { x: s.x, z: s.z + 4, y: 0, protectedUntil: 0 });
  Object.assign(pb, { x: s.x, z: s.z, y: 0, protectedUntil: 0 });
  srv.game.rand = () => 0.5;
  return { a, b, pa, pb, wa, wb };
}

test('Chat: normale Nachricht für alle, Cheat-Codes geheim', async () => {
  const srv = await createServer({ port: 0, host: '127.0.0.1', WebSocketServer, log: quiet });
  try {
    const { a, b, pa, pb } = await duel(srv);
    a.send({ t: 'chat', text: 'Hallo zusammen' });
    const chat = await b.wait((m) => m.t === 'chat');
    assert.equal(chat.text, 'Hallo zusammen');
    assert.equal(chat.name, 'Anna');

    for (const code of ['##########', '!!!!!!!!!!', '$$$$$$$$$$']) {
      pa.chatAt = -10;
      a.send({ t: 'chat', text: code });
      await a.wait((m) => m.t === 'cheat' && !m._seen && (m._seen = true));
    }
    const you = await a.wait((m) => m.t === 'you' && m.cheats.god && m.cheats.trigger && m.cheats.life);
    assert.equal(you.maxHp, 1000);
    assert.equal(pa.hp, 1000);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(b.msgs.filter((m) => m.t === 'chat').length, 1, 'Cheat-Code darf nicht im Chat landen');

    // Unendlich Munition: Magazin bleibt voll
    const mag = pa.weapons.pistol.mag;
    pa.lastShot = -10;
    a.send({ t: 'shoot', d: [0, 0, -1] });
    await a.wait((m) => m.t === 'shot' || m.t === 'hitc');
    assert.equal(pa.weapons.pistol.mag, mag);
    // 3-faches Tempo wird vom Server akzeptiert
    pa.lastInputTime = srv.game.time - 0.1;
    a.send({ t: 'in', x: pa.x + 3, y: 0, z: pa.z, yaw: 0, pitch: 0, mv: true, sp: true, tid: pa.tid });
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(!a.msgs.some((m) => m.t === 'fix'), 'schnelle Bewegung mit Cheat wurde zurückgesetzt');
    // Fliegen: Höhe wird übernommen
    a.send({ t: 'in', x: pa.x, y: 25, z: pa.z, yaw: 0, pitch: 0, tid: pa.tid });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(pa.y, 25);
    void pb;
    a.ws.close(); b.ws.close();
  } finally {
    await srv.stop();
  }
});

test('Messer und Raketenwerfer (Flächenschaden + Rückstoß)', async () => {
  const srv = await createServer({ port: 0, host: '127.0.0.1', WebSocketServer, log: quiet });
  try {
    const { a, b, pa, pb } = await duel(srv);
    // Messer aus 1,5 m
    pa.z = pb.z + 1.5;
    pa.current = 'knife';
    pa.lastShot = -10;
    a.send({ t: 'shoot', d: [0, -0.3, -1] });
    const hit = await b.wait((m) => m.t === 'hit');
    assert.ok(hit.dmg >= WEAPONS.knife.damage);
    // Rakete aus 10 m
    pb.hp = 100; pb.protectedUntil = 0;
    pa.z = pb.z + 10;
    pa.weapons.rocket = { mag: 1, reserve: 5 };
    pa.current = 'rocket';
    pa.lastShot = -10;
    a.send({ t: 'shoot', d: [0, -0.05, -1] });
    await a.wait((m) => m.t === 'boom', 3000);
    const push = await b.wait((m) => m.t === 'push');
    assert.ok(push.v.some((v) => Math.abs(v) > 1), 'kein Rückstoß');
    assert.ok(pb.hp < 100 || !pb.alive, 'Rakete hat keinen Schaden gemacht');
    a.ws.close(); b.ws.close();
  } finally {
    await srv.stop();
  }
});

test('Items: Item-Box gibt Item, Blitz schrumpft Gegner, Banane lässt ausrutschen', async () => {
  const srv = await createServer({ port: 0, host: '127.0.0.1', WebSocketServer, log: quiet });
  try {
    const { a, b, pa, pb } = await duel(srv);
    const box = srv.game.pickups.find((k) => k.kind === 'itembox');
    Object.assign(pa, { x: box.x, z: box.z });
    const you = await a.wait((m) => m.t === 'you' && m.item, 2000);
    assert.ok(you.item);
    // Blitz
    pa.item = 'lightning'; pa.itemReadyAt = 0;
    pb.x = pa.x + 30; pb.z = pa.z; pb.protectedUntil = 0;
    a.send({ t: 'item' });
    await b.wait((m) => m.t === 'you' && m.buffs.shrink);
    assert.ok(pb.hp <= 75);
    // Banane
    pa.item = 'banana'; pa.itemReadyAt = 0; pa.yaw = 0;
    a.send({ t: 'item' });
    await new Promise((r) => setTimeout(r, 80));
    const trap = srv.game.traps[0];
    assert.ok(trap, 'keine Banane gelegt');
    Object.assign(pb, { x: trap.x, z: trap.z, y: trap.y });
    await b.wait((m) => m.t === 'you' && m.buffs.stun, 2000);
    a.ws.close(); b.ws.close();
  } finally {
    await srv.stop();
  }
});

test('Party: Beitritt, Bereit, Leistungscheck → stärkster PC hostet, alle werden geholt', async () => {
  const party = new PartyServer({ WebSocketServer, port: 0, password: 'pw', gameId: 'arena-shooter' });
  await party.ready;
  try {
    const host = client(party.port), f1 = client(party.port), bad = client(party.port);
    await Promise.all([host.open, f1.open, bad.open]);
    host.send({ t: 'hello', name: 'Host', hostToken: party.hostToken, protocol: 1 });
    const hw = await host.wait((m) => m.t === 'welcome');
    bad.send({ t: 'hello', name: 'Fremd', password: 'nein', protocol: 1 });
    assert.match((await bad.wait((m) => m.t === 'error')).msg, /Passwort/);
    f1.send({ t: 'hello', name: 'Freund', password: 'pw', protocol: 1 });
    const fw = await f1.wait((m) => m.t === 'welcome');

    f1.send({ t: 'ready', ready: true });
    host.send({ t: 'perf', perf: { score: 100, cpu: 'A', cores: 4, ramGb: 8, gpu: 'x' } });
    f1.send({ t: 'perf', perf: { score: 900, cpu: 'B', cores: 16, ramGb: 32, gpu: 'RTX' } });
    const st = await host.wait((m) => m.t === 'state' && m.party.members.length === 2 && m.party.members.every((x) => x.perf && x.ready));
    assert.equal(st.party.suggestedHostId, fw.id, 'stärkster PC sollte vorgeschlagen werden');
    assert.equal(st.party.gameHostId, fw.id);

    // Nicht-Host darf nicht starten
    f1.send({ t: 'start' });
    await new Promise((r) => setTimeout(r, 150));
    assert.ok(!f1.msgs.some((m) => m.t === 'hostRequest'));

    host.send({ t: 'start' });
    const req = await f1.wait((m) => m.t === 'hostRequest');
    assert.equal(req.gameId, 'arena-shooter');
    f1.send({ t: 'hostReady', port: 27015 });
    const lh = await host.wait((m) => m.t === 'launch');
    const lf = await f1.wait((m) => m.t === 'launch');
    assert.equal(lf.address, '127.0.0.1'); // Spiel-Host verbindet sich lokal
    assert.equal(lh.address, '127.0.0.1'); // Freund ist (im Test) über Loopback verbunden
    assert.equal(lh.password, req.password);
    assert.equal(lh.port, 27015);

    // Manuelle Host-Wahl
    host.send({ t: 'setGameHost', memberId: hw.id });
    const st2 = await host.wait((m) => m.t === 'state' && m.party.gameHostId === hw.id);
    assert.ok(st2);
    host.ws.close(); f1.ws.close();
  } finally {
    await party.close();
  }
});
