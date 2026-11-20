/**
 * Parkour – Client: 3D-Jump-&-Run mit Third-Person-Kamera.
 * Steuerung: WASD laufen (relativ zur Kamera), Maus Kamera, Leertaste springen (Doppelsprung!),
 * Shift/Strg sprinten, R zurück zum Checkpoint.
 */
import * as THREE from 'three';
import { startGame } from 'app://sdk/client.js';
import { buildLevel, partPos, partSolid, PHYS, THEMES } from '../shared/levels.mjs';

const $ = (id) => document.getElementById(id);
const S = {
  level: null, phase: 'countdown', ends: 0, offset: 0, cp: -1, finished: false, finishList: [],
  meshes: [], dyn: [], cpFlags: [], others: new Map(), camYaw: Math.PI, camPitch: 0.35, sendT: 0, lastCount: 0,
};
const me = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: false, jumps: 0, coyote: 0, buffer: 0, yaw: Math.PI, on: null, phase: 0 };

// ---------- Three.js ----------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 800);
const hemi = new THREE.HemisphereLight('#e6f4ff', '#6b6f78', 1.6);
const sun = new THREE.DirectionalLight('#fff0d2', 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 200 });
scene.add(hemi, sun, sun.target);
const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
addEventListener('resize', resize);
resize();

const matCache = new Map();
const mat = (c, o = {}) => { const k = c + JSON.stringify(o); if (!matCache.has(k)) matCache.set(k, new THREE.MeshLambertMaterial({ color: c, flatShading: true, ...o })); return matCache.get(k); };
const boxMesh = (w, h, d, c, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); m.castShadow = true; return m; };

/** Kleine Low-Poly-Läuferfigur mit Lauf- und Sprunganimation. */
function createRunner(color) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.14, 0.85, 0); legR.position.set(0.14, 0.85, 0);
  for (const l of [legL, legR]) { l.add(boxMesh(0.2, 0.75, 0.22, '#3b4656', 0, -0.37, 0)); l.add(boxMesh(0.22, 0.14, 0.3, '#2b2f36', 0, -0.8, -0.04)); body.add(l); }
  const torso = boxMesh(0.55, 0.65, 0.32, color, 0, 1.2, 0); body.add(torso);
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.36, 1.45, 0); armR.position.set(0.36, 1.45, 0);
  for (const a of [armL, armR]) { a.add(boxMesh(0.14, 0.6, 0.14, color, 0, -0.28, 0)); a.add(boxMesh(0.13, 0.13, 0.13, '#f0c49a', 0, -0.62, 0)); body.add(a); }
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), mat('#f0c49a')); head.position.y = 1.72; body.add(head);
  body.add(boxMesh(0.42, 0.1, 0.44, color, 0, 1.92, 0.01));
  body.add(boxMesh(0.34, 0.08, 0.16, '#1f2a36', 0, 1.74, -0.17));
  body.add(boxMesh(0.3, 0.35, 0.12, '#f08c32', 0, 1.2, 0.2)); // Rucksack
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, body, legL, legR, armL, armR };
}
function animRunner(r, mode, phase) {
  // mode 0 = stehen, 1 = laufen, 2 = in der Luft
  const s = mode === 1 ? Math.sin(phase) : 0;
  const air = mode === 2 ? 1 : 0;
  r.legL.rotation.x = s * 0.9 - air * 0.6; r.legR.rotation.x = -s * 0.9 + air * 0.3;
  r.armL.rotation.x = -s * 0.8 - air * 2.4; r.armR.rotation.x = s * 0.8 - air * 2.4;
  r.body.position.y = mode === 1 ? Math.abs(Math.cos(phase)) * 0.08 : 0;
}
function nameTag(name, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px Segoe UI'; const w = Math.min(244, g.measureText(name).width + 28);
  g.fillStyle = 'rgba(20,26,34,.75)'; g.fillRect((256 - w) / 2, 10, w, 44); g.fillStyle = color; g.fillRect((256 - w) / 2, 50, w, 4);
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(name, 128, 32, 230);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false })); s.scale.set(1.6, 0.4, 1); s.position.y = 2.4;
  return s;
}

const meRunner = createRunner('#f08c32');
scene.add(meRunner.root);

// ---------- Level aufbauen ----------
function loadLevel(n) {
  for (const m of S.meshes) scene.remove(m);
  S.meshes = []; S.dyn = []; S.cpFlags = [];
  const L = buildLevel(n);
  S.level = L;
  const th = L.theme;
  scene.fog = new THREE.Fog(th.fog, 40, 220);
  // Himmel
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 16, 10), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(th.sky[0]) }, bottom: { value: new THREE.Color(th.sky[1]) } },
    vertexShader: 'varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ gl_FragColor = vec4(mix(bottom, top, clamp(h*1.6+0.2,0.0,1.0)),1.0); }',
  }));
  add(sky);
  const side = mat(th.side);
  for (const p of L.parts) {
    if (p.type === 'box' || p.type === 'mover' || p.type === 'blink') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), [side, side, mat(p.c), side, side, side]);
      m.castShadow = m.receiveShadow = true;
      m.position.set(p.x, p.y + p.h / 2, p.z);
      add(m);
      if (p.type !== 'box') S.dyn.push({ p, m });
      // Grasbüschel / Wölkchen-Deko auf festen Plattformen
      if (p.type === 'box' && n === 0 && p.w > 2) for (let i = 0; i < 3; i++) {
        const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), mat(['#ffd84d', '#ff6b6b', '#ffffff', '#c77dff'][i]));
        f.position.set(p.x + (Math.random() - 0.5) * p.w * 0.8, p.y + p.h + 0.08, p.z + (Math.random() - 0.5) * p.d * 0.8);
        add(f);
      }
    } else if (p.type === 'pad') {
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1, 0.2, 6), mat('#3fd0c9', { emissive: '#3fd0c9', emissiveIntensity: 0.5 }));
      pad.position.set(p.x, p.y + 0.1, p.z); add(pad);
      const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.4, 0.6, 4), mat('#ffffff', { emissive: '#ffffff', emissiveIntensity: 0.4 }));
      arrow.position.set(p.x, p.y + 0.8, p.z); add(arrow); S.dyn.push({ p, m: arrow, spin: true });
    } else if (p.type === 'cp') {
      const g = new THREE.Group();
      g.add(boxMesh(0.12, 3, 0.12, '#dfe5ec', 0, 1.5, 0));
      const flag = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.2, -0.4, 0), new THREE.Vector3(0, -0.8, 0)]), new THREE.MeshLambertMaterial({ color: '#e2534a', side: THREE.DoubleSide, flatShading: true }));
      flag.geometry.computeVertexNormals();
      flag.position.set(0.06, 2.95, 0); g.add(flag);
      g.position.set(p.x + 2, p.y, p.z); add(g);
      S.cpFlags[p.i] = flag;
    } else if (p.type === 'goal') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.35, 6, 16), mat('#ffd84d', { emissive: '#ffb347', emissiveIntensity: 0.6 }));
      ring.position.set(p.x, p.y + 2.8, p.z); add(ring); S.dyn.push({ p, m: ring, spin: true });
      const inner = new THREE.Mesh(new THREE.CircleGeometry(2.1, 16), new THREE.MeshBasicMaterial({ color: '#fff6d0', transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      inner.position.copy(ring.position); add(inner); S.dyn.push({ p, m: inner, spin: true });
    }
  }
  // Boden-Thema: Lava / Wolkenmeer / tiefe Wiese
  const floorColor = th.floor === 'lava' ? '#ff5a1f' : n === 1 ? '#ffffff' : '#4e9a3a';
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(800, 800, 40, 40), new THREE.MeshLambertMaterial({ color: floorColor, flatShading: true, emissive: th.floor === 'lava' ? '#ff3a00' : '#000000', emissiveIntensity: th.floor === 'lava' ? 0.6 : 0 }));
  const fp = floor.geometry.attributes.position;
  for (let i = 0; i < fp.count; i++) fp.setZ(i, Math.random() * 3);
  floor.geometry.computeVertexNormals();
  floor.rotation.x = -Math.PI / 2; floor.position.y = PHYS.killY - 4;
  add(floor);
  S.floor = floor;
  $('pk-level').textContent = `Level ${n + 1}: ${th.name}`;
  S.cp = -1; S.finished = false; S.finishList = [];
  renderPlaces();
  function add(m) { scene.add(m); S.meshes.push(m); }
}

// ---------- Netzwerk ----------
let ctx;
ctx = await startGame({
  title: 'Parkour', mode: '3d', pointerLock: true,
  help: [['WASD', 'Laufen'], ['Maus', 'Kamera'], ['Leertaste', 'Springen (2× = Doppelsprung)'], ['Shift / Strg', 'Sprinten'], ['R', 'Zum Checkpoint']],
  music: [[147, 294, 370, 440], [131, 262, 330, 392], [165, 330, 415, 494], [123, 247, 311, 370]],
  onWelcome(m, c) { ctx = c; loadLevel(m.n); S.phase = m.phase; S.ends = m.ends; },
  onMessage(m, c) {
    ctx = c;
    if (m.t === 's') {
      S.offset = m.time - performance.now() / 1000;
      if (S.phase !== m.ph && m.ph === 'race') { ctx.sfx.tone(880, 0.3, 'square', 0.2); }
      S.phase = m.ph; S.ends = m.ends;
      const seen = new Set();
      for (const [id, x, y, z, yaw, an, cp, fin] of m.r) {
        seen.add(id);
        if (id === ctx.myId) continue;
        let o = S.others.get(id);
        if (!o) {
          const info = ctx.players.get(id) || { name: '?', color: '#ccc' };
          o = { r: createRunner(info.color), x, y, z, tx: x, ty: y, tz: z, yaw, phase: 0 };
          o.r.root.add(nameTag(info.name, info.color));
          scene.add(o.r.root);
          S.others.set(id, o);
        }
        Object.assign(o, { tx: x, ty: y, tz: z, yaw, an, cp, fin });
      }
      for (const [id, o] of S.others) if (!seen.has(id)) { scene.remove(o.r.root); S.others.delete(id); }
    } else if (m.t === 'level') { loadLevel(m.n); S.phase = m.phase; S.ends = m.ends; }
    else if (m.t === 'phase') { S.phase = m.phase; S.ends = m.ends; }
    else if (m.t === 'spawn') { Object.assign(me, { x: m.x, y: m.y, z: m.z, vx: 0, vy: 0, vz: 0, jumps: 0, yaw: Math.PI }); S.camYaw = Math.PI; }
    else if (m.t === 'cpok') { S.cp = Math.max(S.cp, m.i); }
    else if (m.t === 'finish') {
      S.finishList.push(m);
      renderPlaces();
      const name = ctx.players.get(m.id)?.name || '?';
      if (m.id === ctx.myId) { S.finished = true; ctx.sfx.chord([523, 659, 784, 1046], 0.25); showCenter(`ZIEL! Platz ${m.place}`, `${fmt(m.time)}`, 3); }
      else ctx.toast(`${name} ist im Ziel (Platz ${m.place})`);
    }
  },
  onMouseMove(e) {
    S.camYaw -= e.movementX * 0.0025 * ctx.settings.controls.sensitivity;
    S.camPitch = Math.max(-0.2, Math.min(0.95, S.camPitch + e.movementY * 0.0025 * ctx.settings.controls.sensitivity * (ctx.settings.controls.invertY ? -1 : 1)));
  },
  onFrame,
  debug: () => ({ level: S.level?.n, phase: S.phase, parts: S.level?.parts.length, others: S.others.size, y: Math.round(me.y) }),
});

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${String(Math.floor((t % 1) * 10))}`;
let centerT = 0;
function showCenter(text, small = '', t = 1.2) { $('pk-center').innerHTML = `${text}<small>${small}</small>`; centerT = t; }
function renderPlaces() {
  $('pk-list').innerHTML = S.finishList.map((f) => {
    const p = ctx?.players.get(f.id);
    return `<div style="color:${f.id === ctx?.myId ? '#ffd25a' : p?.color || '#fff'}">${f.place}. ${p?.name || '?'} – ${fmt(f.time)}</div>`;
  }).join('') || '–';
}
const serverTime = () => performance.now() / 1000 + S.offset;

// ---------- Physik ----------
function solids(t) {
  const out = [];
  for (const p of S.level.parts) {
    if (!partSolid(p, t)) continue;
    const [x, y, z] = partPos(p, t);
    out.push({ p, x0: x - p.w / 2, x1: x + p.w / 2, y0: y, y1: y + p.h, z0: z - p.d / 2, z1: z + p.d / 2 });
  }
  return out;
}
const overlap = (b, x, y, z) => x + PHYS.radius > b.x0 && x - PHYS.radius < b.x1 && z + PHYS.radius > b.z0 && z - PHYS.radius < b.z1 && y + PHYS.height > b.y0 && y < b.y1;

function respawn() {
  const cp = S.level.cps[S.cp];
  const [x, y, z] = cp ? [cp.x, cp.y, cp.z] : S.level.start;
  Object.assign(me, { x, y: y + 0.1, z, vx: 0, vy: 0, vz: 0, jumps: 0 });
  ctx.sfx.tone(300, 0.3, 'sine', 0.2, 600);
}

function physics(dt) {
  const t = serverTime();
  const frozen = S.phase === 'countdown';
  // Plattform, auf der man steht, nimmt einen mit
  if (me.on && me.on.type === 'mover') {
    const [ax, ay, az] = partPos(me.on, t - dt), [bx, by, bz] = partPos(me.on, t);
    me.x += bx - ax; me.y += by - ay; me.z += bz - az;
  }
  const f = ctx.down('KeyW', 'ArrowUp') - ctx.down('KeyS', 'ArrowDown');
  const r = ctx.down('KeyD', 'ArrowRight') - ctx.down('KeyA', 'ArrowLeft');
  const sin = Math.sin(S.camYaw), cos = Math.cos(S.camYaw);
  let wx = -sin * f + cos * r, wz = -cos * f - sin * r;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; me.yaw = Math.atan2(-wx, -wz); }
  const speed = frozen ? 0 : ctx.down('ShiftLeft', 'ControlLeft') ? PHYS.sprint : PHYS.speed;
  const acc = me.onGround ? 14 : 5;
  me.vx += (wx * speed - me.vx) * Math.min(1, acc * dt);
  me.vz += (wz * speed - me.vz) * Math.min(1, acc * dt);
  // Springen mit Coyote-Time, Puffer und Doppelsprung
  me.coyote = me.onGround ? 0.12 : me.coyote - dt;
  me.buffer = ctx.pressed('Space') ? 0.12 : me.buffer - dt;
  if (!frozen && me.buffer > 0) {
    if (me.coyote > 0) { me.vy = PHYS.jump; me.coyote = 0; me.buffer = 0; me.jumps = 1; ctx.sfx.tone(420, 0.12, 'square', 0.12, 700); }
    else if (me.jumps < 2) { me.vy = PHYS.jump * 0.9; me.buffer = 0; me.jumps = 2; ctx.sfx.tone(600, 0.12, 'square', 0.12, 1000); }
  }
  me.vy -= PHYS.gravity * dt;
  const solid = solids(t);
  const wasGround = me.onGround;
  me.onGround = false; me.on = null;
  // achsenweise bewegen und auflösen
  me.x += me.vx * dt;
  for (const b of solid) if (overlap(b, me.x, me.y, me.z)) {
    if (me.y + 0.45 >= b.y1) { me.y = b.y1; continue; } // kleine Kante hochsteigen
    me.x = me.vx > 0 ? b.x0 - PHYS.radius : b.x1 + PHYS.radius; me.vx = 0;
  }
  me.z += me.vz * dt;
  for (const b of solid) if (overlap(b, me.x, me.y, me.z)) {
    if (me.y + 0.45 >= b.y1) { me.y = b.y1; continue; }
    me.z = me.vz > 0 ? b.z0 - PHYS.radius : b.z1 + PHYS.radius; me.vz = 0;
  }
  me.y += me.vy * dt;
  for (const b of solid) if (overlap(b, me.x, me.y, me.z)) {
    if (me.vy <= 0) { me.y = b.y1; me.vy = 0; me.onGround = true; me.on = b.p; me.jumps = 0; }
    else { me.y = b.y0 - PHYS.height; me.vy = 0; }
  }
  if (me.onGround && !wasGround) ctx.sfx.noise(0.06, 900, 'lowpass', 0.15);
  // Sprungpads
  for (const p of S.level.parts) if (p.type === 'pad' && me.onGround && Math.hypot(p.x - me.x, p.z - me.z) < 1.2 && Math.abs(p.y - me.y) < 0.4) {
    me.vy = PHYS.pad; me.onGround = false; me.jumps = 1; ctx.sfx.tone(200, 0.4, 'sine', 0.3, 900);
  }
  // Checkpoints / Ziel
  const next = S.level.cps[S.cp + 1];
  if (next && Math.hypot(next.x - me.x, next.z - me.z) < 3.5 && Math.abs(next.y - me.y) < 3) {
    S.cp = next.i;
    ctx.send({ t: 'cp', i: next.i });
    ctx.sfx.chord([660, 880]);
    showCenter('CHECKPOINT', `${next.i + 1}/${S.level.cps.length}`);
  }
  const g = S.level.goal;
  if (!S.finished && S.phase === 'race' && Math.hypot(g.x - me.x, g.z - me.z) < 3.5 && Math.abs(g.y - me.y) < 3) { ctx.send({ t: 'fin' }); S.finished = 'sent'; }
  if (ctx.pressed('KeyR') || me.y < PHYS.killY) respawn();
}

// ---------- Schleife ----------
function onFrame(dt) {
  if (!S.level) return;
  physics(dt);
  const t = serverTime();
  for (const d of S.dyn) {
    if (d.spin) { d.m.rotation.y += dt * 1.5; continue; }
    const [x, y, z] = partPos(d.p, t);
    d.m.position.set(x, y + d.p.h / 2, z);
    if (d.p.type === 'blink') {
      const on = partSolid(d.p, t);
      const warn = Math.sin((t / d.p.period) * Math.PI * 2 + d.p.phase);
      d.m.visible = on;
      d.m.material[2] = mat(warn < 0.2 && on ? '#ffd25a' : d.p.c);
    }
  }
  if (S.floor && S.level.theme.floor === 'lava') S.floor.material.emissiveIntensity = 0.5 + Math.sin(t * 2) * 0.15;
  S.cpFlags.forEach((f, i) => { if (f) f.material = i <= S.cp ? mat('#6abf4b', { side: THREE.DoubleSide }) : f.material; });

  // eigene Figur
  const moving = Math.hypot(me.vx, me.vz) > 0.5;
  me.phase += dt * Math.hypot(me.vx, me.vz) * 1.6;
  meRunner.root.position.set(me.x, me.y, me.z);
  meRunner.root.rotation.y += ((me.yaw - meRunner.root.rotation.y + Math.PI * 3) % (Math.PI * 2) - Math.PI) * Math.min(1, dt * 12);
  animRunner(meRunner, me.onGround ? (moving ? 1 : 0) : 2, me.phase);
  // andere
  for (const o of S.others.values()) {
    o.x += (o.tx - o.x) * Math.min(1, dt * 12); o.y += (o.ty - o.y) * Math.min(1, dt * 12); o.z += (o.tz - o.z) * Math.min(1, dt * 12);
    o.phase += dt * 10;
    o.r.root.position.set(o.x, o.y, o.z);
    o.r.root.rotation.y = o.yaw;
    animRunner(o.r, o.an, o.phase);
  }
  // Kamera
  const dist = 7;
  const cx = me.x + Math.sin(S.camYaw) * Math.cos(S.camPitch) * dist;
  const cz = me.z + Math.cos(S.camYaw) * Math.cos(S.camPitch) * dist;
  const cy = me.y + 2 + Math.sin(S.camPitch) * dist;
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 14));
  camera.lookAt(me.x, me.y + 1.5, me.z);
  sun.position.set(me.x + 30, me.y + 60, me.z + 20);
  sun.target.position.set(me.x, me.y, me.z);

  S.sendT -= dt;
  if (S.sendT <= 0) {
    S.sendT = 0.05;
    ctx.send({ t: 'in', x: +me.x.toFixed(2), y: +me.y.toFixed(2), z: +me.z.toFixed(2), yaw: +me.yaw.toFixed(2), an: me.onGround ? (moving ? 1 : 0) : 2 });
  }

  // HUD
  const remain = Math.max(0, S.ends - t);
  $('pk-time').textContent = S.phase === 'race' ? fmt(remain) : '–';
  $('pk-cp').textContent = `${S.cp + 1}/${S.level.cps.length}`;
  [...$('pk-jumps').children].forEach((el, i) => el.classList.toggle('used', me.jumps > i));
  centerT -= dt;
  if (S.phase === 'countdown') {
    const n = Math.ceil(remain);
    if (n !== S.lastCount) { S.lastCount = n; ctx.sfx.tone(440, 0.15, 'square', 0.15); }
    $('pk-center').innerHTML = `${n}<small>${S.level.theme.name}</small>`;
  } else if (S.phase === 'results') {
    $('pk-center').innerHTML = `RUNDE VORBEI<small>Nächstes Level in ${Math.ceil(remain)} s</small>`;
  } else if (centerT <= 0) $('pk-center').innerHTML = S.lastCount === 1 && remain > 178 ? 'LOS!' : '';
  renderer.render(scene, camera);
}
