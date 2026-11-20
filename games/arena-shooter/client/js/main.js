/**
 * Blumenfeld Arena – Client-Hauptmodul.
 *  - verbindet sich mit dem Host (Server ist autoritativ für Treffer/Spawns/Items)
 *  - eigene Bewegung wird lokal vorhergesagt (flüssig), fremde Spieler werden interpoliert
 *  - Rendering: Welt-Szene + Ego-Waffen-Szene (Viewmodel)
 *  - Chat (T), Zielen (Rechtsklick), Items (Q), Cheat-Effekte (Fliegen, Triggerbot …)
 */
import * as THREE from 'three';
import {
  PROTOCOL_VERSION, WEAPONS, WEAPON_ORDER, BUFF_ORDER, EYE_HEIGHT, WALK_SPEED, SPRINT_SPEED, SNEAK_FACTOR, CROUCH_FACTOR, GRAVITY,
  JUMP_SPEED, STAMINA, RESPAWN_TIME, MAX_HP, generateWorld, collide, groundHeight, raycastWorld, hitPlayer, spreadDir, dirFromAngles, speedMultiplier,
} from '../../shared/world.mjs';
import { buildScene, QUALITY } from './scene.js';
import { createPlayerModel, setPlayerWeapon, createNameTag, createPickupModel, createProjectileModel, mat } from './models.js';
import { ViewModel } from './viewmodel.js';
import { Sfx } from './sfx.js';
import { Hud } from './hud.js';
import { Net } from './net.js';

const $ = (id) => document.getElementById(id);
const INTERP_DELAY = 0.1; // Sekunden Puffer für die Interpolation fremder Spieler
const DEFAULT_BINDS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ControlLeft', sneak: 'ShiftLeft', reload: 'KeyR',
  weapon1: 'Digit1', weapon2: 'Digit2', weapon3: 'Digit3', weapon4: 'Digit4', weapon5: 'Digit5', weapon6: 'Digit6', weapon7: 'Digit7',
  scoreboard: 'Tab', fire: 'Mouse0', aim: 'Mouse2', item: 'KeyQ', chat: 'KeyT',
};

// ---------- Startparameter (vom Launcher) ----------
const DEV_DEFAULTS = {
  address: '127.0.0.1', port: 27015, password: '', name: 'Dev',
  settings: {
    audio: { master: 0.8, music: 0.5, sfx: 0.8, outputDeviceId: 'default' },
    graphics: { fpsLimit: 144, quality: 'medium' },
    controls: { sensitivity: 1, invertY: false, fov: 80, keybinds: DEFAULT_BINDS },
  },
};
const launch = (await window.launcher?.getLaunchParams?.()) || DEV_DEFAULTS;
const settings = launch.settings;
const binds = { ...DEFAULT_BINDS, ...settings.controls.keybinds };
const keyName = (action) => {
  const code = binds[action] || '';
  const map = { ControlLeft: 'Strg', ControlRight: 'Strg rechts', ShiftLeft: 'Shift', Space: 'Leertaste', Mouse0: 'LMB', Mouse1: 'MMB', Mouse2: 'RMB', Tab: 'Tab' };
  return map[code] || code.replace(/^Key|^Digit/, '');
};

// ---------- Renderer, Kameras ----------
const quality = QUALITY[settings.graphics.quality] ? settings.graphics.quality : 'medium';
const Q = QUALITY[quality];
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, Q.pixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = Q.shadows > 0;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.controls.fov, window.innerWidth / window.innerHeight, 0.05, 1500);
camera.rotation.order = 'YXZ';
const viewmodel = new ViewModel(window.innerWidth / window.innerHeight);
const muzzleLight = new THREE.PointLight('#ffb050', 0, 12, 1.5);
const boomLight = new THREE.PointLight('#ff9a40', 0, 30, 1.2);
scene.add(muzzleLight, boomLight);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  viewmodel.setAspect(camera.aspect);
});

const sfx = new Sfx(settings.audio);
const hud = new Hud(keyName);
$('hud').classList.add('hidden');
const net = new Net();

// ---------- Spielzustand ----------
let world = null;
let sceneCtl = null;
let connected = false;
let ended = false;
const me = {
  id: null, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, alive: false,
  hp: MAX_HP, maxHp: MAX_HP, tid: 0, stamina: STAMINA.max, exhausted: false, staminaDelay: 0, sprinting: false, ads: false,
  cur: 'pistol', ammo: {}, reloading: false, lastShot: -10, buffs: {}, item: null, itemReady: 0,
  cheats: { god: false, trigger: false, life: false }, protectedFlag: false,
  deathTime: 0, killerName: '', stepDist: 0, kick: 0, shake: 0, debugCamera: false,
};
const players = new Map(); // fremde Spieler
const infos = new Map(); // id → { name, color, bot, kills, deaths, ping }
const pickups = new Map();
const projectiles = new Map();
const traps = new Map();
let serverTimeOffset = null;
let clock = 0;
const has = (buff) => (me.buffs[buff] || 0) > 0;

// ---------- Effekte: Leuchtspuren, Einschläge, Rauch, Explosionen ----------
const tracers = [];
const tracerMat = new THREE.LineBasicMaterial({ color: '#ffe8a8', transparent: true, opacity: 0.9 });
function addTracer(from, to) {
  let t = tracers.find((x) => !x.line.visible);
  if (!t) {
    if (tracers.length > 80) return;
    const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(6, 3));
    t = { line: new THREE.Line(geo, tracerMat.clone()), life: 0 };
    scene.add(t.line);
    tracers.push(t);
  }
  const p = t.line.geometry.attributes.position;
  p.setXYZ(0, from.x, from.y, from.z);
  p.setXYZ(1, to.x, to.y, to.z);
  p.needsUpdate = true;
  t.line.geometry.computeBoundingSphere();
  t.line.visible = true;
  t.life = 0.09;
}
const particles = [];
const particleGeo = new THREE.IcosahedronGeometry(0.07, 0);
function addParticle(pos, color, vel, life, size = 1, grav = 12) {
  let p = particles.find((x) => !x.mesh.visible);
  if (!p) {
    if (particles.length > 400) return;
    p = { mesh: new THREE.Mesh(particleGeo, mat('#ffffff')), vel: new THREE.Vector3(), life: 0, max: 1, size: 1, grav: 12 };
    scene.add(p.mesh);
    particles.push(p);
  }
  p.mesh.material = mat(color);
  p.mesh.position.copy(pos);
  p.mesh.visible = true;
  p.vel.copy(vel);
  p.life = p.max = life;
  p.size = size;
  p.grav = grav;
}
function addImpact(pos, isPlayer) {
  const color = isPlayer ? '#e2534a' : pos.y < 0.05 ? '#7a5a3a' : '#c9c2b0';
  for (let i = 0; i < (isPlayer ? 5 : 4); i++) addParticle(pos, color, new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3 + 1, (Math.random() - 0.5) * 3), 0.4);
}
const booms = [];
function addExplosion(x, y, z, r, small) {
  const pos = new THREE.Vector3(x, y, z);
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9 }));
  ball.position.copy(pos);
  scene.add(ball);
  booms.push({ mesh: ball, t: 0, r: small ? 1.2 : r });
  for (let i = 0; i < (small ? 8 : 26); i++) {
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(small ? 3 : 7 + Math.random() * 5);
    addParticle(pos, i % 3 ? '#5a5a5a' : '#ff8a2a', v, 0.6 + Math.random() * 0.6, small ? 1.5 : 3, 4);
  }
  boomLight.position.copy(pos);
  boomLight.intensity = small ? 40 : 160;
  sfx.explosion(pos, small);
  const d = Math.hypot(x - me.x, y - me.y, z - me.z);
  me.shake = Math.max(me.shake, Math.max(0, 1 - d / (small ? 8 : 35)));
}
const flashSpriteMat = new THREE.SpriteMaterial({ color: '#ffd25a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
function thirdPersonFlash(model) {
  if (!model.flash) {
    model.flash = new THREE.Sprite(flashSpriteMat);
    model.flash.scale.setScalar(0.5);
  }
  model.weapon.muzzle.add(model.flash);
  model.flash.visible = true;
  model.flashTime = 0.06;
}

// ---------- Fremde Spieler ----------
function ensurePlayer(id) {
  if (id === me.id || players.has(id)) return players.get(id);
  const info = infos.get(id) || { name: `Spieler ${id}`, color: '#cccccc' };
  const model = createPlayerModel(info.color);
  setPlayerWeapon(model, 'pistol');
  const tag = createNameTag(info.name, info.color);
  model.root.add(tag);
  scene.add(model.root);
  const p = { id, model, tag, buf: [], phase: 0, alive: true, deadT: 0, kick: 0, slash: 0, lastPos: new THREE.Vector3(), stepDist: 0, shrink: 1 };
  players.set(id, p);
  return p;
}
function removePlayer(id) {
  const p = players.get(id);
  if (p) scene.remove(p.model.root);
  players.delete(id);
  infos.delete(id);
}

// ---------- Pickups / Projektile / Fallen ----------
function upsertPickup(d) {
  let k = pickups.get(d.id);
  if (!k) {
    const model = createPickupModel(d.kind, d.type);
    model.root.position.set(d.x, d.y || 0, d.z);
    scene.add(model.root);
    k = { ...d, model, phase: Math.random() * 6 };
    pickups.set(d.id, k);
  }
  k.active = d.active;
  k.model.spin.visible = d.active;
  if (k.model.root.userData.q) k.model.root.userData.q.visible = d.active;
}

function syncProjectiles(list, now) {
  const seen = new Set();
  for (const [id, kind, x, y, z, vx, vy, vz] of list) {
    seen.add(id);
    let p = projectiles.get(id);
    if (!p) {
      p = { kind, mesh: createProjectileModel(kind), smokeT: 0 };
      scene.add(p.mesh);
      projectiles.set(id, p);
      if (kind === 'rocket') p.mesh.position.set(x, y, z);
    }
    Object.assign(p, { x, y, z, vx, vy, vz, t0: now });
  }
  for (const [id, p] of projectiles) if (!seen.has(id)) { scene.remove(p.mesh); projectiles.delete(id); }
}
function syncTraps(list) {
  const seen = new Set();
  for (const [id, x, y, z] of list) {
    seen.add(id);
    if (!traps.has(id)) {
      const m = createProjectileModel('banana');
      m.position.set(x, y, z);
      m.rotation.y = Math.random() * 6;
      scene.add(m);
      traps.set(id, m);
    }
  }
  for (const [id, m] of traps) if (!seen.has(id)) { scene.remove(m); traps.delete(id); }
}

// ---------- Netzwerk-Nachrichten ----------
function onMessage(m) {
  switch (m.t) {
    case 'welcome': {
      me.id = m.id;
      world = generateWorld(m.seed);
      sceneCtl = buildScene(scene, world, quality);
      for (const p of m.players) infos.set(p.id, { ...p, ping: 0 });
      for (const p of m.players) if (p.id !== me.id) ensurePlayer(p.id);
      for (const k of m.pickups) upsertPickup(k);
      connected = true;
      $('status').textContent = 'Verbunden. Klicken zum Spielen.';
      $('menu').classList.remove('hidden');
      hud.setWeapon(me.cur, me.ammo, false, false);
      $('hud').classList.remove('hidden');
      window.launcher?.reportReady?.();
      break;
    }
    case 'error':
      showError(m.text);
      break;
    case 'pjoin':
      infos.set(m.p.id, { ...m.p, ping: 0 });
      ensurePlayer(m.p.id);
      break;
    case 'pleave':
      removePlayer(m.id);
      break;
    case 's': {
      const offset = m.time - performance.now() / 1000;
      serverTimeOffset = serverTimeOffset == null ? offset : serverTimeOffset * 0.95 + offset * 0.05;
      if (Math.abs(serverTimeOffset - offset) > 0.5) serverTimeOffset = offset;
      for (const [id, x, y, z, yaw, pitch, hp, flags, w, bm] of m.p) {
        if (id === me.id) {
          me.hp = hp;
          me.protectedFlag = !!(flags & 16);
          continue;
        }
        const p = ensurePlayer(id);
        p.buf.push({ time: m.time, x, y, z, yaw, pitch, flags, w, bm });
        if (p.buf.length > 30) p.buf.shift();
      }
      syncProjectiles(m.pr || [], performance.now() / 1000);
      syncTraps(m.tr || []);
      break;
    }
    case 'you': {
      const prevBuffs = Object.keys(me.buffs);
      me.hp = m.hp;
      me.maxHp = m.maxHp;
      me.ammo = m.ammo;
      me.cheats = m.cheats;
      if (m.cur !== me.cur && !me.debugCamera) { me.cur = m.cur; viewmodel.setWeapon(m.cur); }
      if (m.reload > 0 && !me.reloading) { viewmodel.startReload(m.reload); sfx.reload(me.cur); }
      if (m.reload <= 0 && me.reloading && viewmodel.reload) viewmodel.cancelReload();
      me.reloading = m.reload > 0;
      me.buffs = m.buffs;
      if (m.buffs.star && !prevBuffs.includes('star')) sfx.star();
      if (m.buffs.turbo && !prevBuffs.includes('turbo')) sfx.turbo();
      hud.setBuffs(m.buffs);
      hud.setInk(!!m.buffs.ink);
      if (m.item && !me.item) sfx.itemGot();
      me.item = m.item;
      me.itemReady = clock + (m.itemReady || 0);
      hud.setItem(m.item, m.itemReady);
      hud.setCheats(m.cheats);
      viewmodel.setLoaded(!!(m.ammo.rocket && (m.ammo.rocket.mag > 0 || m.cheats.god)));
      hud.setWeapon(me.cur, me.ammo, me.reloading, me.cheats.god);
      break;
    }
    case 'spawn':
      if (m.id === me.id) {
        Object.assign(me, { x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: 0, vx: 0, vy: 0, vz: 0, tid: m.tid, alive: true, stamina: STAMINA.max, exhausted: false, reloading: false });
        viewmodel.cancelReload();
        hud.setDeath(false);
        sfx.spawn();
      } else {
        const p = ensurePlayer(m.id);
        p.buf = [{ time: Infinity, x: m.x, y: m.y, z: m.z, yaw: m.yaw, pitch: 0, flags: 1, w: 1, bm: 0 }];
        p.alive = true;
      }
      break;
    case 'shot': {
      const from = new THREE.Vector3(...m.o);
      const p = players.get(m.id);
      if (m.id !== me.id && p) {
        if (m.w === 'knife') p.slash = 1; else p.kick = 1;
        if (p.model.weapon && m.w !== 'knife') {
          thirdPersonFlash(p.model);
          p.model.weapon.muzzle.getWorldPosition(from);
        }
        sfx.shot(m.w, from);
        for (const e of m.e) addTracer(from, new THREE.Vector3(e[0], e[1], e[2]));
      }
      for (const e of m.e) addImpact(new THREE.Vector3(e[0], e[1], e[2]), !!e[3]);
      break;
    }
    case 'hit': {
      const dx = m.from[0] - me.x, dz = m.from[1] - me.z;
      hud.damage(Math.atan2(-dx, -dz) - me.yaw);
      sfx.hurt();
      break;
    }
    case 'hitc':
      hud.hitmarker(m.kill);
      if (me.cur === 'knife') sfx.knifeHit(); else sfx.hitmarker(m.head);
      if (m.kill) sfx.kill();
      break;
    case 'kill': {
      const k = infos.get(m.k) || { name: '?', color: '#fff' };
      const v = infos.get(m.v) || { name: '?', color: '#fff' };
      hud.killfeed(k.name, k.color, v.name, v.color, m.w, m.head, m.k === me.id || m.v === me.id);
      if (m.v === me.id) {
        me.alive = false;
        me.deathTime = clock;
        me.killerName = m.k === me.id ? '' : k.name;
        me.item = null;
        hud.setItem(null, 0);
        hud.setInk(false);
        sfx.death();
      } else {
        const p = players.get(m.v);
        if (p) { p.alive = false; p.deadT = 0; }
      }
      break;
    }
    case 'pick':
      if (m.p) upsertPickup(m.p);
      if (m.by === me.id && m.p?.kind === 'weapon') sfx.pickup();
      break;
    case 'scores':
      for (const [id, kills, deaths, ping] of m.s) {
        const i = infos.get(id);
        if (i) Object.assign(i, { kills, deaths, ping });
      }
      break;
    case 'boom':
      addExplosion(m.x, m.y, m.z, m.r, m.small);
      break;
    case 'push':
      me.vx += m.v[0]; me.vz += m.v[2];
      me.vy = Math.max(me.vy, m.v[1]);
      me.onGround = false;
      break;
    case 'itemUse': {
      const who = infos.get(m.id)?.name || '?';
      if (m.item === 'lightning') { hud.flash('#fff6a0'); sfx.lightning(); hud.message(`⚡ ${who} hat einen Blitz gezündet!`); }
      else if (m.item === 'ink' && m.id !== me.id) { sfx.inkSplat(); hud.message(`${who} hat Tinte verspritzt!`); }
      else if (m.item === 'slip') { if (m.id === me.id) { sfx.slip(); hud.message('Ausgerutscht!'); } }
      else if (m.id === me.id && ['greenShell', 'redShell', 'banana'].includes(m.item)) sfx.throwItem();
      else if (m.item === 'star' && m.id !== me.id) hud.message(`★ ${who} ist unbesiegbar!`);
      break;
    }
    case 'chat':
      hud.chat(m.name, m.color, m.text);
      sfx.chatPing();
      break;
    case 'cheat':
      hud.message(`✦ ${m.text}`, 'cheat');
      break;
    case 'fix':
      if (me.debugCamera) break;
      Object.assign(me, { x: m.x, y: m.y, z: m.z, vx: 0, vz: 0 });
      break;
    case 'msg':
      hud.message(m.text);
      if (m.end) { ended = true; showError(m.text); }
      break;
  }
}

function showError(text) {
  ended = true;
  document.exitPointerLock?.();
  $('overlay').classList.remove('hidden');
  $('menu').classList.add('hidden');
  $('status').textContent = text;
  $('btn-error-quit').classList.remove('hidden');
}

// ---------- Eingabe ----------
const keys = new Set();
const pressed = new Set();
const locked = () => document.pointerLockElement === canvas;
const isDown = (action) => keys.has(binds[action]);
const wasPressed = (action) => pressed.has(binds[action]);

window.addEventListener('keydown', (e) => {
  if (hud.chatOpen) {
    if (e.key === 'Enter') {
      const text = $('chat-input').value.trim();
      if (text) net.send({ t: 'chat', text });
      hud.closeChat();
      e.preventDefault();
    } else if (e.key === 'Escape') hud.closeChat();
    return; // Tippen im Chat steuert nicht das Spiel
  }
  if (e.code === 'Tab' || (e.ctrlKey && e.code !== 'ControlLeft' && e.code !== 'ControlRight')) e.preventDefault();
  if (!locked()) return;
  if (e.code === binds.chat) {
    e.preventDefault();
    keys.clear();
    hud.openChat();
    return;
  }
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('mousedown', (e) => {
  if (!locked() || hud.chatOpen) return;
  const code = `Mouse${e.button}`;
  if (!keys.has(code)) pressed.add(code);
  keys.add(code);
});
window.addEventListener('mouseup', (e) => keys.delete(`Mouse${e.button}`));
window.addEventListener('blur', () => keys.clear());
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('mousemove', (e) => {
  if (!locked() || !me.alive) return;
  // Beim Zielen langsamer drehen (passend zum Zoom)
  const s = settings.controls.sensitivity * 0.0022 * (camera.fov / settings.controls.fov);
  me.yaw -= e.movementX * s;
  me.pitch -= e.movementY * s * (settings.controls.invertY ? -1 : 1);
  me.pitch = Math.max(-1.5, Math.min(1.5, me.pitch));
  viewmodel.addSway(e.movementX, e.movementY);
});
window.addEventListener('wheel', (e) => {
  if (!locked() || !me.alive || hud.chatOpen) return;
  const owned = WEAPON_ORDER.filter((w) => me.ammo[w]);
  const i = owned.indexOf(me.cur);
  switchWeapon(owned[(i + (e.deltaY > 0 ? 1 : -1) + owned.length) % owned.length]);
});

document.addEventListener('pointerlockchange', () => {
  const l = locked();
  $('overlay').classList.toggle('hidden', l);
  if (!l) { keys.clear(); if (hud.chatOpen) hud.closeChat(); }
});
function requestPlay() {
  if (!connected || ended) return;
  sfx.resume();
  sfx.startMusic();
  canvas.requestPointerLock()?.catch?.(() => {});
}
$('overlay').addEventListener('click', (e) => { if (e.target.closest('.card') === null || e.target.id === 'btn-resume') requestPlay(); });
$('btn-resume').addEventListener('click', requestPlay);
const quit = () => { net.close(); window.launcher?.exitGame?.(); };
$('btn-quit').addEventListener('click', quit);
$('btn-error-quit').addEventListener('click', quit);

// Schnelleinstellungen im Pausenmenü
$('q-sens').value = Math.round(settings.controls.sensitivity * 100);
$('q-sens-v').textContent = settings.controls.sensitivity.toFixed(2);
$('q-vol').value = Math.round(settings.audio.master * 100);
$('q-vol-v').textContent = `${Math.round(settings.audio.master * 100)}%`;
let saveTimer;
function saveQuick() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!window.launcher) return;
    const full = await window.launcher.getSettings();
    full.controls.sensitivity = settings.controls.sensitivity;
    full.audio.master = settings.audio.master;
    window.launcher.setSettings(full);
  }, 300);
}
$('q-sens').oninput = (e) => { settings.controls.sensitivity = e.target.value / 100; $('q-sens-v').textContent = settings.controls.sensitivity.toFixed(2); saveQuick(); };
$('q-vol').oninput = (e) => { settings.audio.master = e.target.value / 100; $('q-vol-v').textContent = `${e.target.value}%`; sfx.apply(settings.audio); saveQuick(); };
$('keys-help').innerHTML = [
  ['Bewegen', `${keyName('forward')} ${keyName('left')} ${keyName('back')} ${keyName('right')}`], ['Boost', keyName('sprint')], ['Springen', keyName('jump')], ['Schleichen', keyName('sneak')],
  ['Schießen', keyName('fire')], ['Zielen / Zoom', keyName('aim')], ['Nachladen', keyName('reload')],
  ['Waffen', `1–7 · Mausrad`], ['Item einsetzen', keyName('item')], ['Chat', keyName('chat')],
  ['Scoreboard', keyName('scoreboard')], ['Menü', 'Esc'],
].map(([a, b]) => `<span>${a}</span><b>${b}</b>`).join('');

function switchWeapon(w) {
  if (!w || !me.ammo[w] || w === me.cur || !me.alive) return;
  me.cur = w;
  me.reloading = false;
  me.lastShot = clock - WEAPONS[w].rate + 0.3;
  viewmodel.setWeapon(w);
  net.send({ t: 'switch', w });
  hud.setWeapon(me.cur, me.ammo, false, me.cheats.god);
}

// ---------- Lokale Spiellogik ----------
const tmpV = new THREE.Vector3();
function activeBuffs() {
  const out = {};
  for (const [k, v] of Object.entries(me.buffs)) if (v > 0) out[k] = true;
  return out;
}
function currentSpread() {
  const w = WEAPONS[me.cur];
  const speed = Math.hypot(me.vx, me.vz);
  let s = me.ads ? w.adsSpread : w.spread;
  if (speed > 1) s *= me.ads ? 1.2 : 1.4;
  if (me.sprinting) s *= 1.8;
  if (me.sneaking) s *= 0.7;
  if (!me.onGround && !me.cheats.god) s *= 1.5;
  return s;
}
function eyePos() { return [me.x, me.y + EYE_HEIGHT * (has('shrink') ? 0.6 : 1) * (me.sneaking ? CROUCH_FACTOR : 1), me.z]; }

/** Triggerbot-Cheat: zielt das Fadenkreuz gerade auf einen Gegner (ohne Wand dazwischen)? */
function aimingAtEnemy() {
  const w = WEAPONS[me.cur];
  const o = eyePos();
  const d = dirFromAngles(me.yaw, me.pitch);
  const wall = raycastWorld(world, o, d, w.range);
  for (const p of players.values()) {
    if (!p.alive || p.protectedFlag) continue;
    if (hitPlayer(o, d, p.model.root.position, p.shrink, p.crouch).t < wall) return true;
  }
  return false;
}

function tryShoot() {
  const w = WEAPONS[me.cur];
  const ammo = me.ammo[me.cur];
  if (!ammo || me.reloading || has('stun') || clock - me.lastShot < w.rate) return;
  const trigger = (w.auto ? isDown('fire') : wasPressed('fire')) || (me.cheats.trigger && aimingAtEnemy());
  if (!trigger) return;
  const infinite = me.cheats.god;
  if (!w.melee && ammo.mag <= 0 && !infinite) {
    if (wasPressed('fire')) { sfx.empty(); net.send({ t: 'reload' }); }
    return;
  }
  me.lastShot = clock;
  if (!w.melee && !infinite) ammo.mag--;
  const dir = dirFromAngles(me.yaw, me.pitch);
  net.send({ t: 'shoot', d: dir.map((v) => Math.round(v * 10000) / 10000) });
  viewmodel.shoot();
  sfx.shot(me.cur, null);
  if (!w.melee) {
    me.pitch = Math.min(1.5, me.pitch + w.recoil * (me.ads ? 0.3 : 0.5));
    me.kick = Math.min(1, me.kick + w.recoil * 8);
    muzzleLight.intensity = me.cur === 'rocket' ? 50 : 25;
  }
  // Lokale Leuchtspur (sofortiges Feedback; Treffer entscheidet der Host)
  if (!w.melee && !w.projectile) {
    const origin = eyePos();
    const start = new THREE.Vector3(0.18, -0.14, -0.6).applyQuaternion(camera.quaternion).add(camera.position);
    if (viewmodel.scoped || me.ads) start.set(0, -0.05, -0.4).applyQuaternion(camera.quaternion).add(camera.position);
    const spread = currentSpread();
    for (let i = 0; i < w.pellets; i++) {
      const d = spreadDir(dir, spread);
      let t = raycastWorld(world, origin, d, w.range);
      for (const p of players.values()) {
        if (!p.alive) continue;
        const h = hitPlayer(origin, d, p.model.root.position, p.shrink, p.crouch);
        if (h.t < t) t = h.t;
      }
      addTracer(start, tmpV.set(origin[0] + d[0] * t, origin[1] + d[1] * t, origin[2] + d[2] * t).clone());
    }
  }
  hud.setWeapon(me.cur, me.ammo, me.reloading, infinite);
  if (!w.melee && ammo.mag === 0 && ammo.reserve > 0 && !infinite) net.send({ t: 'reload' });
}

function updateMe(dt) {
  if (!me.alive) {
    hud.setDeath(true, me.killerName, RESPAWN_TIME - (clock - me.deathTime));
    return;
  }
  const active = locked() && !hud.chatOpen;
  const stunned = has('stun');
  const fly = me.cheats.god;
  const f = active && !stunned ? (isDown('forward') ? 1 : 0) - (isDown('back') ? 1 : 0) : 0;
  const r = active && !stunned ? (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0) : 0;
  const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
  let wx = -sin * f + cos * r, wz = -cos * f - sin * r;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }

  me.ads = ((active && isDown('aim')) || me.debugAds) && me.cur !== 'knife' && !me.reloading;

  // Boost (Strg gedrückt halten) mit Ausdauer
  // Schleichen (Shift): langsam, leise, geduckt – beim Fliegen-Cheat heißt Shift "runter"
  me.sneaking = active && !fly && isDown('sneak');
  const wantSprint = active && isDown('sprint') && wl > 0 && !me.ads && !me.sneaking;
  if (me.exhausted && me.stamina >= STAMINA.minToStart) me.exhausted = false;
  me.sprinting = wantSprint && !me.exhausted && me.stamina > 0;
  if (me.sprinting && !fly) {
    me.stamina = Math.max(0, me.stamina - STAMINA.drain * dt);
    me.staminaDelay = STAMINA.regenDelay;
    if (me.stamina === 0) me.exhausted = true;
  } else {
    me.staminaDelay -= dt;
    if (me.staminaDelay <= 0) me.stamina = Math.min(STAMINA.max, me.stamina + STAMINA.regen * dt);
  }
  hud.setStamina(me.stamina, STAMINA.max, me.exhausted);

  const speed = (me.sprinting ? SPRINT_SPEED : WALK_SPEED) * (me.sneaking ? SNEAK_FACTOR : 1) * (me.ads ? 0.6 : 1) * speedMultiplier(activeBuffs(), me.cheats);
  const accel = me.onGround || fly ? 12 : 2.5;
  me.vx += (wx * speed - me.vx) * Math.min(1, accel * dt);
  me.vz += (wz * speed - me.vz) * Math.min(1, accel * dt);
  if (fly) {
    // Fliegen (Cheat): Leertaste hoch, Shift runter
    const up = active ? (isDown('jump') ? 1 : 0) - (isDown('sneak') ? 1 : 0) : 0;
    me.vy += (up * 14 - me.vy) * Math.min(1, 10 * dt);
  } else {
    if (active && !stunned && me.onGround && wasPressed('jump')) { me.vy = JUMP_SPEED; me.onGround = false; sfx.jump(); }
    me.vy -= GRAVITY * dt;
  }
  const ox = me.x, oz = me.z;
  me.x += me.vx * dt;
  me.z += me.vz * dt;
  me.y += me.vy * dt;
  collide(world, me);
  const g = groundHeight(world, me.x, me.z, me.y);
  if (me.y <= g) { me.y = g; me.vy = Math.max(0, me.vy); me.onGround = true; } else if (me.y > g + 0.05) me.onGround = false;
  if (me.onGround && !fly && g > 0 && me.y - g < 0.6 && me.vy <= 0) me.y = g; // Treppen glatt hochlaufen
  const moved = Math.hypot(me.x - ox, me.z - oz);
  if (me.onGround) {
    me.stepDist += moved;
    if (me.stepDist > (me.sprinting ? 2.8 : 2.2)) { me.stepDist = 0; if (!me.sneaking) sfx.step(null, me.sprinting); }
  }

  if (active) {
    if (wasPressed('reload')) {
      const a = me.ammo[me.cur];
      if (a && !WEAPONS[me.cur].melee && a.mag < WEAPONS[me.cur].mag && a.reserve > 0 && !me.reloading && !me.cheats.god) net.send({ t: 'reload' });
    }
    WEAPON_ORDER.forEach((w, i) => { if (wasPressed(`weapon${i + 1}`)) switchWeapon(w); });
    if (wasPressed('item') && me.item && clock >= me.itemReady && !stunned) {
      net.send({ t: 'item', d: dirFromAngles(me.yaw, me.pitch).map((v) => Math.round(v * 1000) / 1000) });
    }
    tryShoot();
  }
}

let sendAcc = 0;
function sendInput(dt) {
  sendAcc += dt;
  if (sendAcc < 1 / 30 || !me.alive) return;
  sendAcc = 0;
  net.send({
    t: 'in', x: +me.x.toFixed(3), y: +me.y.toFixed(3), z: +me.z.toFixed(3), yaw: +me.yaw.toFixed(4), pitch: +me.pitch.toFixed(4),
    mv: Math.hypot(me.vx, me.vz) > 0.5, sp: me.sprinting, ads: me.ads, cr: me.sneaking, tid: me.tid,
  });
}

/** Fremde Spieler interpolieren und animieren (Laufen, Schießen, Messer, Nachladen, Tod, Stern, Schrumpfen). */
function updateOthers(dt) {
  const renderTime = performance.now() / 1000 + (serverTimeOffset || 0) - INTERP_DELAY;
  for (const p of players.values()) {
    const b = p.buf;
    if (!b.length) continue;
    let s = b[b.length - 1];
    let x = s.x, y = s.y, z = s.z, yaw = s.yaw, pitch = s.pitch;
    for (let i = b.length - 1; i > 0; i--) {
      if (b[i - 1].time <= renderTime && b[i].time >= renderTime && b[i].time !== Infinity) {
        const a = b[i - 1], c = b[i];
        const k = (renderTime - a.time) / Math.max(1e-4, c.time - a.time);
        x = a.x + (c.x - a.x) * k; y = a.y + (c.y - a.y) * k; z = a.z + (c.z - a.z) * k;
        let dy = c.yaw - a.yaw;
        dy = ((dy + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        yaw = a.yaw + dy * k;
        pitch = a.pitch + (c.pitch - a.pitch) * k;
        s = c;
        break;
      }
    }
    if (b[0].time === Infinity && b.length > 1) b.shift();
    const m = p.model;
    const prev = p.lastPos.clone();
    m.root.position.set(x, y, z);
    m.root.rotation.y = yaw;
    p.lastPos.set(x, y, z);
    const flags = s.flags;
    const alive = !!(flags & 1);
    const moving = !!(flags & 2), sprint = !!(flags & 4), reloading = !!(flags & 8), star = !!(flags & 32), shrunk = !!(flags & 64), crouch = !!(flags & 256);
    p.crouch = crouch;
    p.protectedFlag = !!(flags & 16);
    setPlayerWeapon(m, WEAPON_ORDER[s.w] || 'pistol');
    // Schrumpfen / Superstern
    p.shrink += ((shrunk ? 0.6 : 1) - p.shrink) * Math.min(1, dt * 8);
    m.root.scale.setScalar(p.shrink);
    m.aura.visible = star && alive;
    if (star) { m.aura.rotation.y += dt * 4; m.aura.material.color.setHSL((clock * 1.5) % 1, 0.9, 0.6); }

    const dist = Math.hypot(x - prev.x, z - prev.z);
    p.phase += dist * (sprint ? 2.2 : 2.8);
    const swing = moving && alive ? Math.sin(p.phase) * (sprint ? 0.9 : 0.6) : 0;
    m.legL.rotation.x += (swing - m.legL.rotation.x) * Math.min(1, dt * 15);
    m.legR.rotation.x += (-swing - m.legR.rotation.x) * Math.min(1, dt * 15);
    m.upper.rotation.x = Math.max(-0.5, Math.min(0.5, pitch * 0.5));
    // Schleichen: geduckte Haltung (Knie gebeugt, Oberkörper tiefer und nach vorn)
    p.crouchK = (p.crouchK || 0) + ((crouch && alive ? 1 : 0) - (p.crouchK || 0)) * Math.min(1, dt * 10);
    m.upper.position.y = 0.95 - p.crouchK * 0.38 + (moving ? Math.abs(Math.cos(p.phase)) * 0.04 : 0);
    m.upper.rotation.x += p.crouchK * 0.25;
    m.legL.position.y = m.legR.position.y = 0.9 - p.crouchK * 0.38;
    m.legL.rotation.z = p.crouchK * 0.15; m.legR.rotation.z = -p.crouchK * 0.15;
    p.kick = Math.max(0, p.kick - dt * 8);
    p.slash = Math.max(0, p.slash - dt * 4);
    let hx = 0, hz = 0, hy = 0;
    if (reloading) { hx = -0.7 + Math.sin(clock * 9) * 0.1; hz = 0.4; } else if (sprint && moving) { hx = -0.5; }
    if (p.slash > 0) { const e = Math.sin(p.slash * Math.PI); hy = e * 0.9; hx -= e * 0.4; }
    m.hands.rotation.x += (hx + p.kick * 0.3 - m.hands.rotation.x) * Math.min(1, dt * 12);
    m.hands.rotation.z += (hz - m.hands.rotation.z) * Math.min(1, dt * 12);
    m.hands.rotation.y = hy;
    m.hands.position.z = -0.3 + p.kick * 0.08;
    if (m.flash) { m.flashTime -= dt; m.flash.visible = m.flashTime > 0; }
    if (!alive) p.deadT += dt; else p.deadT = 0;
    const fall = Math.min(1, p.deadT * 3);
    m.body.rotation.x = -fall * Math.PI / 2;
    m.body.position.y = fall * 0.2;
    p.tag.visible = alive && Math.hypot(x - me.x, z - me.z) < 90;
    if (moving && alive && !crouch && Math.abs(y - (prev.y || y)) < 0.5) {
      p.stepDist += dist;
      if (p.stepDist > 2.5) { p.stepDist = 0; sfx.step({ x, z }, sprint); }
    }
    p.alive = alive;
  }
}

function updateEffects(dt) {
  const now = performance.now() / 1000;
  for (const t of tracers) {
    if (!t.line.visible) continue;
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
    if (t.life <= 0) t.line.visible = false;
  }
  for (const p of particles) {
    if (!p.mesh.visible) continue;
    p.life -= dt;
    p.vel.y -= p.grav * dt;
    p.vel.multiplyScalar(Math.max(0, 1 - dt * (p.grav < 10 ? 1.5 : 0)));
    p.mesh.position.addScaledVector(p.vel, dt);
    const k = p.life / p.max;
    p.mesh.scale.setScalar(Math.max(0.01, p.grav < 10 ? p.size * (1.4 - k) : k * p.size));
    if (p.life <= 0) p.mesh.visible = false;
  }
  for (let i = booms.length - 1; i >= 0; i--) {
    const b = booms[i];
    b.t += dt;
    const k = b.t / 0.4;
    b.mesh.scale.setScalar(b.r * Math.min(1, k * 1.4));
    b.mesh.material.opacity = Math.max(0, 0.9 * (1 - k));
    b.mesh.material.color.setHSL(0.08 - k * 0.06, 1, 0.6 - k * 0.3);
    if (k >= 1) { scene.remove(b.mesh); booms.splice(i, 1); }
  }
  boomLight.intensity = Math.max(0, boomLight.intensity - dt * 500);
  // Projektile: zwischen den Snapshots weiterrechnen
  for (const p of projectiles.values()) {
    const age = Math.min(0.2, now - p.t0);
    const tx = p.x + p.vx * age, ty = p.y + p.vy * age, tz = p.z + p.vz * age;
    if (p.kind === 'rocket') {
      p.mesh.position.set(tx, ty, tz);
      p.mesh.lookAt(tx - p.vx, ty - p.vy, tz - p.vz);
      p.smokeT -= dt;
      if (p.smokeT <= 0) { p.smokeT = 0.025; addParticle(p.mesh.position, '#bfbfbf', new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.4, (Math.random() - 0.5) * 0.4), 0.7, 1.6, 0); }
      p.mesh.userData.flame.scale.y = 0.8 + Math.random() * 0.5;
    } else {
      p.mesh.position.lerp(tmpV.set(tx, ty - 0.3, tz), Math.min(1, dt * 20));
      p.mesh.rotation.y += dt * 12;
    }
  }
  for (const m of traps.values()) m.rotation.y += dt * 0.3;
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 400);
  muzzleLight.position.set(me.x, me.y + EYE_HEIGHT, me.z).addScaledVector(new THREE.Vector3(...dirFromAngles(me.yaw, me.pitch)), 1);
  for (const k of pickups.values()) {
    k.phase += dt;
    k.model.spin.rotation.y += dt * (k.kind === 'itembox' ? 1.2 : 1.6);
    k.model.spin.position.y = 1.0 + Math.sin(k.phase * 2) * 0.15;
    if (k.kind === 'itembox') k.model.root.userData.q.position.y = k.model.spin.position.y;
  }
}

function updateCamera(dt) {
  me.kick = Math.max(0, me.kick - dt * 6);
  me.shake = Math.max(0, me.shake - dt * 2.5);
  const shake = me.shake * me.shake * 0.08;
  const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
  if (me.alive) {
    me.eyeK = (me.eyeK ?? 1) + ((me.sneaking ? CROUCH_FACTOR : 1) - (me.eyeK ?? 1)) * Math.min(1, dt * 12);
    const eye = EYE_HEIGHT * (has('shrink') ? 0.6 : 1) * me.eyeK;
    camera.position.set(me.x, me.y + eye, me.z);
    const spin = has('stun') ? Math.sin(clock * 14) * 0.25 : 0;
    camera.rotation.set(me.pitch + me.kick * 0.03 + sy, me.yaw + sx + spin, spin * 0.5);
  } else {
    const k = Math.min(1, (clock - me.deathTime) * 2);
    camera.position.set(me.x, me.y + EYE_HEIGHT - k * 1.2, me.z);
    camera.rotation.set(me.pitch * (1 - k) - k * 0.2, me.yaw, k * 0.5);
  }
  const w = WEAPONS[me.cur];
  const zoom = 1 + (w.zoom - 1) * viewmodel.adsBlend;
  const targetFov = settings.controls.fov / zoom + (me.sprinting ? 7 : 0) + (has('turbo') ? 12 : 0);
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
    camera.updateProjectionMatrix();
  }
  sfx.listener = { x: me.x, z: me.z, yaw: me.yaw };
}

// ---------- Hauptschleife (mit FPS-Limit) ----------
let lastFrame = performance.now();
let lastRender = 0;
let fpsCount = 0, fpsTime = 0, fps = 0;
let hudTimer = 0;
let chatRefresh = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const limit = settings.graphics.fpsLimit;
  if (limit > 0) {
    const interval = 1000 / limit;
    if (now - lastRender < interval - 0.5) return;
    lastRender = now - ((now - lastRender) % interval);
  }
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  clock += dt;
  fpsCount++;
  fpsTime += dt;
  if (fpsTime >= 1) { fps = Math.round(fpsCount / fpsTime); fpsCount = 0; fpsTime = 0; hud.setInfo(net.rtt, fps); }

  if (connected && world) {
    updateMe(dt);
    sendInput(dt);
    updateOthers(dt);
    updateEffects(dt);
    updateCamera(dt);
    sceneCtl.update(dt, me);
    viewmodel.update(dt, { speed: Math.hypot(me.vx, me.vz), sprinting: me.sprinting, onGround: me.onGround || me.cheats.god, ads: me.ads });
    hud.setHealth(me.hp, me.maxHp, has('shield'), has('star'));
    hud.setSpawnProtection(me.protectedFlag && me.alive);
    hud.setScope(viewmodel.scoped && me.alive);
    hud.setCrosshairSpread(6 + currentSpread() * 500 + viewmodel.recoil * 8, viewmodel.adsBlend > 0.5 && me.cur !== 'knife');
    for (const k of Object.keys(me.buffs)) me.buffs[k] = Math.max(0, me.buffs[k] - dt);
    const r = hud.tick(dt);
    if (r === 'tick') sfx.roulette();
    chatRefresh -= dt;
    if (chatRefresh <= 0) { chatRefresh = 0.5; hud.refreshChat(); }
    hudTimer -= dt;
    const showBoard = locked() && !hud.chatOpen ? isDown('scoreboard') : false;
    if (showBoard && hudTimer <= 0) {
      hudTimer = 0.25;
      hud.setScoreboard(true, [...infos.values()].map((i) => ({ ...i })), me.id);
    } else if (!showBoard) hud.setScoreboard(false);
  }
  pressed.clear();

  renderer.clear();
  renderer.render(scene, camera);
  if (connected && me.alive && !viewmodel.scoped) {
    renderer.clearDepth();
    renderer.render(viewmodel.scene, viewmodel.camera);
  }
}

// Debug-Hooks für den Selbsttest des Launchers
window.__gameDebug = () => ({ connected, players: players.size + (me.id ? 1 : 0), fps, alive: me.alive, pickups: pickups.size, hp: me.hp, buildings: world?.buildings.length || 0 });
/** Kamera ein paar Meter vor den nächsten Mitspieler stellen (nur Screenshots). */
window.__gameLookAtPlayer = () => {
  const p = [...players.values()].find((x) => x.alive);
  if (!p) return false;
  const t = p.model.root.position;
  me.x = t.x + Math.sin(p.model.root.rotation.y) * -3.5;
  me.z = t.z + Math.cos(p.model.root.rotation.y) * -3.5;
  me.yaw = Math.atan2(-(t.x - me.x), -(t.z - me.z));
  me.pitch = -0.12;
  me.alive = true;
  me.debugCamera = true;
  return true;
};
/** Kamera an einen Punkt stellen und dorthin schauen (nur Screenshots). */
window.__gameCamera = (x, y, z, yaw, pitch, weapon) => {
  Object.assign(me, { x, y, z, yaw, pitch, alive: true, debugCamera: true, vx: 0, vy: 0, vz: 0 });
  if (weapon) { me.ammo[weapon] ??= { mag: 5, reserve: 5 }; me.cur = weapon; viewmodel.setWeapon(weapon); }
  return world ? world.buildings.map((b) => [b.type, Math.round(b.x), Math.round(b.z)]) : null;
};
window.__gameViewmodel = (action, arg) => {
  if (action === 'reload') viewmodel.startReload(arg || 2);
  if (action === 'shoot') viewmodel.shoot();
  if (action === 'ads') me.debugAds = arg;
  return true;
};

// ---------- Start ----------
net.addEventListener('msg', (e) => onMessage(e.detail));
net.addEventListener('close', () => { if (connected && !ended) showError('Verbindung zum Host verloren.'); });
requestAnimationFrame(frame);
viewmodel.setWeapon('pistol');
$('status').textContent = `Verbinde mit ${launch.address}:${launch.port} …`;
try {
  await net.connect(launch.address, launch.port);
  net.send({ t: 'join', name: launch.name || settings.playerName || 'Spieler', password: launch.password || '', version: PROTOCOL_VERSION });
} catch (err) {
  showError(err.message);
}
