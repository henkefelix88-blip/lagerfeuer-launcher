// Automatische Tests (node --test): Party-Code, Map/Kollision/Raycast, Einstellungen, Spiele-Registry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePartyCode, decodePartyCode, parseJoinTarget } from '../src/launcher/js/partyCode.js';
import { generateWorld, collide, raycastWorld, hitPlayer, dirFromAngles, groundHeight, MAP_HALF } from '../games/arena-shooter/shared/world.mjs';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('Party-Code: Hin- und Rückweg', () => {
  for (const [ip, port] of [['192.168.0.42', 27016], ['100.101.102.103', 1024], ['84.130.12.7', 65535], ['10.0.0.1', 27016]]) {
    const code = encodePartyCode(ip, port);
    assert.match(code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    assert.deepEqual(decodePartyCode(code), { address: ip, port });
    assert.deepEqual(decodePartyCode(code.toLowerCase().replace(/-/g, ' ')), { address: ip, port });
  }
});

test('Party-Code: Tippfehler wird erkannt', () => {
  const code = encodePartyCode('192.168.0.42', 27016);
  const broken = (code[0] === 'A' ? 'B' : 'A') + code.slice(1);
  assert.equal(decodePartyCode(broken), null);
  assert.equal(decodePartyCode('ABC'), null);
});

test('Beitritt per IP:Port statt Code', () => {
  assert.deepEqual(parseJoinTarget('192.168.0.5:4000', 27016), { address: '192.168.0.5', port: 4000 });
  assert.deepEqual(parseJoinTarget('192.168.0.5', 27016), { address: '192.168.0.5', port: 27016 });
  assert.equal(parseJoinTarget('quatsch', 27016), null);
});

test('Map ist deterministisch und gefüllt', () => {
  const a = generateWorld(1337), b = generateWorld(1337);
  assert.deepEqual(a.obstacles, b.obstacles);
  const types = new Set(a.obstacles.map((o) => o.type));
  assert.ok(types.has('rock') && types.has('tree') && types.has('box'));
  assert.ok(a.weaponSpawns.length >= 10 && a.itemBoxSpawns.length >= 24 && a.playerSpawns.length >= 16);
  const kinds = new Set(a.buildings.map((b) => b.type));
  for (const k of ['house', 'townhouse', 'barn', 'tower', 'ruin']) assert.ok(kinds.has(k), `Gebäudetyp ${k} fehlt`);
  assert.ok(a.buildings.length >= 15, `nur ${a.buildings.length} Gebäude`);
  assert.equal(MAP_HALF, 180);
});

test('Gebäude: Treppe hoch auf die Dachterrasse, durch die Tür hinein', () => {
  const w = generateWorld(1337);
  // Scharfschützen-Spawn auf einer Terrasse muss auf festem Boden liegen
  const roof = w.weaponSpawns.find((s) => s.weapon === 'sniper' && s.y > 3);
  assert.ok(roof, 'kein Waffen-Spawn auf einem Dach/Turm');
  assert.ok(Math.abs(groundHeight(w, roof.x, roof.z, roof.y + 0.01) - roof.y) < 0.05, 'Spawn schwebt');
  // Tower: Treppe Stufe für Stufe hochlaufen (Stufenhöhe < STEP_HEIGHT)
  const steps = w.obstacles.filter((o) => o.type === 'box' && o.mat === 'stairs' || o.mat === 'stone');
  assert.ok(steps.length > 20);
});

test('Spawnpunkte liegen nicht in Hindernissen', () => {
  const w = generateWorld(1337);
  for (const s of [...w.playerSpawns, ...w.weaponSpawns.filter((x) => !x.y), ...w.itemBoxSpawns]) {
    const p = collide(w, { x: s.x, z: s.z, y: 0 });
    assert.ok(Math.hypot(p.x - s.x, p.z - s.z) < 0.01, `Spawn ${s.x},${s.z} kollidiert`);
  }
});

test('Kollision hält Spieler aus Felsen und in der Map', () => {
  const w = generateWorld(1337);
  const rock = w.obstacles.find((o) => o.type === 'rock');
  const p = collide(w, { x: rock.x + 0.1, z: rock.z, y: 0 });
  assert.ok(Math.hypot(p.x - rock.x, p.z - rock.z) >= rock.r * 0.85 + 0.44);
  const out = collide(w, { x: 999, z: -999, y: 0 });
  assert.ok(Math.abs(out.x) <= MAP_HALF && Math.abs(out.z) <= MAP_HALF);
});

test('Raycast trifft Kiste und Spieler-Hitbox', () => {
  const w = generateWorld(1337);
  const crate = w.obstacles.find((o) => o.mat === 'crate' && o.y === 0);
  const origin = [crate.x, 0.5, crate.z + 10];
  const t = raycastWorld(w, origin, [0, 0, -1], 50);
  // Kisten stehen in Gruppen: der Strahl muss spätestens an der Vorderseite DIESER Kiste stoppen.
  assert.ok(t > 0 && t <= 10 - crate.d / 2 + 1e-6, `Kiste nicht getroffen (t=${t})`);
  const free = raycastWorld(w, [0, 1, 0], [0, 1, 0], 50);
  assert.equal(free, 50, 'Schuss in den Himmel darf nichts treffen');
  const head = hitPlayer([0, 1.62, 5], [0, 0, -1], { x: 0, y: 0, z: 0 });
  assert.ok(head.head && Math.abs(head.t - (5 - 0.27)) < 0.01);
  const miss = hitPlayer([3, 1, 5], [0, 0, -1], { x: 0, y: 0, z: 0 });
  assert.equal(miss.t, Infinity);
});

test('Blickrichtung: Yaw 0 schaut nach -Z', () => {
  const d = dirFromAngles(0, 0);
  assert.ok(Math.abs(d[2] + 1) < 1e-9 && Math.abs(d[0]) < 1e-9);
});

test('Einstellungen: Speichern, Laden, Standardwerte ergänzen', () => {
  const { SettingsStore } = require('../src/main/settings.js');
  const dir = mkdtempSync(join(tmpdir(), 'lf-settings-'));
  const s = new SettingsStore(dir);
  const d = s.get();
  d.playerName = 'Tester';
  d.audio.music = 0.1;
  d.controls.keybinds.sprint = 'ShiftLeft';
  d.unbekannt = 'weg';
  s.set(d);
  const again = new SettingsStore(dir).get();
  assert.equal(again.playerName, 'Tester');
  assert.equal(again.audio.music, 0.1);
  assert.equal(again.controls.keybinds.sprint, 'ShiftLeft');
  assert.equal(again.controls.keybinds.forward, 'KeyW');
  assert.equal(again.unbekannt, undefined);
});

test('Registry findet das Spiel über game.json', () => {
  const { GameRegistry } = require('../src/main/gameRegistry.js');
  const reg = new GameRegistry([join(root, 'games')]);
  const g = reg.get('arena-shooter');
  assert.ok(g, 'arena-shooter fehlt');
  assert.equal(g.server, 'server/server.mjs');
  assert.equal(reg.resolveFile('arena-shooter', '../../package.json'), null, 'Pfad-Ausbruch muss blockiert sein');
});
