/**
 * Baut die 3D-Welt aus der (mit dem Server identischen) Map-Beschreibung:
 * Himmel, Licht, facettierte Wiese, Gras, Blumen, Felsen, Bäume, Kisten, Zaun, Hügel, Wolken.
 * Alle statischen Objekte werden pro Typ zu einer Geometrie zusammengeführt (wenige Draw-Calls).
 */
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { rng, MAP_HALF } from '../../shared/world.mjs';

export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: 0, flowers: 3500, grass: 3500, fogFar: 200, antialias: false },
  medium: { pixelRatio: 1, shadows: 2048, flowers: 10000, grass: 13000, fogFar: 290, antialias: false },
  high: { pixelRatio: 1.25, shadows: 2048, flowers: 20000, grass: 28000, fogFar: 400, antialias: true },
  ultra: { pixelRatio: 2, shadows: 4096, flowers: 32000, grass: 48000, fogFar: 520, antialias: true },
};

/** Farben der Gebäude-/Kistenmaterialien. */
const BOX_COLORS = {
  plaster: '#efe4cf', plasterWarm: '#f0cfa0', wood: '#b98a56', woodDark: '#6e4a2c', planks: '#a07848', brick: '#b5653f',
  barn: '#a8443a', stone: '#9ea3a8', stairs: '#8f7a66', ceiling: '#d8cbb3', floor: '#8a6a4a', furniture: '#7a5230', hay: '#e2c46a',
};
const ROOF_COLORS = { roof: '#b84a35', barnRoof: '#5b6470' };

/** Satteldach als Dreiecksprisma (First entlang z oder x). */
function roofGeometry(r) {
  const { w, d, h, alongZ } = r;
  const hw = (alongZ ? w : d) / 2, hl = (alongZ ? d : w) / 2;
  // lokale Koordinaten: u = quer, v = längs
  const P = (u, y, v) => (alongZ ? [u, y, v] : [v, y, u]);
  const a = P(-hw, 0, -hl), b = P(hw, 0, -hl), c = P(0, h, -hl), a2 = P(-hw, 0, hl), b2 = P(hw, 0, hl), c2 = P(0, h, hl);
  const tris = [a, c, b, a2, b2, c2, a, a2, c2, a, c2, c, b, c, c2, b, c2, b2, a, b, b2, a, b2, a2];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  g.translate(r.x, r.y, r.z);
  return g;
}

const SKY_TOP = new THREE.Color('#4f9fe0');
const SKY_HORIZON = new THREE.Color('#cdebf7');

/** Färbt eine (nicht indizierte) Geometrie einheitlich bzw. pro Dreieck leicht variiert ein. */
function paint(geo, color, variance = 0, rand = Math.random) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const cols = new Float32Array(g.attributes.position.count * 3);
  const tmp = new THREE.Color();
  for (let i = 0; i < g.attributes.position.count; i += 3) {
    tmp.copy(c).offsetHSL(0, 0, (rand() - 0.5) * variance);
    for (let k = 0; k < 3; k++) { cols[(i + k) * 3] = tmp.r; cols[(i + k) * 3 + 1] = tmp.g; cols[(i + k) * 3 + 2] = tmp.b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

const vcMat = (opts = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...opts });

/** Verschiebt Ecken zufällig (für Felsen/Baumkronen); gleiche Positionen bekommen denselben Versatz. */
function jitter(geo, amount, rand) {
  const pos = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!map.has(key)) map.set(key, [(rand() - 0.5) * amount, (rand() - 0.5) * amount, (rand() - 0.5) * amount]);
    const [dx, dy, dz] = map.get(key);
    pos.setXYZ(i, pos.getX(i) + dx, pos.getY(i) + dy, pos.getZ(i) + dz);
  }
  return geo;
}

export function buildScene(scene, world, quality) {
  const q = QUALITY[quality] || QUALITY.medium;
  const rand = rng(world.seed + 99);
  const range = (a, b) => a + rand() * (b - a);

  // ---------- Himmel & Nebel ----------
  scene.background = SKY_HORIZON.clone();
  scene.fog = new THREE.Fog(SKY_HORIZON.clone(), 60, q.fogFar);
  const skyGeo = new THREE.SphereGeometry(900, 16, 10);
  const skyCols = [];
  for (let i = 0; i < skyGeo.attributes.position.count; i++) {
    const y = skyGeo.attributes.position.getY(i) / 900;
    const c = SKY_HORIZON.clone().lerp(SKY_TOP, Math.max(0, Math.min(1, y * 1.6)));
    skyCols.push(c.r, c.g, c.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyCols, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -1;
  scene.add(sky);

  // ---------- Licht ----------
  const hemi = new THREE.HemisphereLight('#d6eeff', '#5c8a3a', 1.6);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff0d2', 2.4);
  sun.position.set(60, 90, 35);
  if (q.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(q.shadows, q.shadows);
    const s = 55;
    Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 260 });
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.04;
  }
  scene.add(sun, sun.target);

  // ---------- Boden (facettierte Wiese + Hügel außerhalb der Arena) ----------
  const size = MAP_HALF * 2 + 260;
  const ground = new THREE.PlaneGeometry(size, size, 130, 130);
  ground.rotateX(-Math.PI / 2);
  const gp = ground.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i);
    const out = Math.max(Math.abs(x), Math.abs(z)) - (MAP_HALF + 6);
    let y = 0;
    if (out > 0) y = Math.min(40, out * 0.35) * (0.6 + 0.4 * Math.sin(x * 0.05) * Math.cos(z * 0.06)) + Math.sin(x * 0.11 + z * 0.07) * 1.5;
    else { // innen: minimale Verschiebung für Facetten, Höhe bleibt ~0 (Spielfläche ist flach)
      gp.setX(i, x + (rand() - 0.5) * 1.2);
      gp.setZ(i, z + (rand() - 0.5) * 1.2);
      y = -0.02;
    }
    gp.setY(i, y);
  }
  const groundGeo = paint(ground, '#6abf4b', 0.06, rand);
  // Höhere Hügel etwas dunkler/gelblicher einfärben
  const gc = groundGeo.attributes.color, gpos = groundGeo.attributes.position;
  const hillCol = new THREE.Color('#7fae47'), tmp = new THREE.Color();
  for (let i = 0; i < gpos.count; i += 3) {
    const y = (gpos.getY(i) + gpos.getY(i + 1) + gpos.getY(i + 2)) / 3;
    if (y > 0.5) {
      tmp.setRGB(gc.getX(i), gc.getY(i), gc.getZ(i)).lerp(hillCol, Math.min(0.7, y / 30));
      for (let k = 0; k < 3; k++) gc.setXYZ(i + k, tmp.r, tmp.g, tmp.b);
    }
  }
  groundGeo.computeVertexNormals();
  const groundMesh = new THREE.Mesh(groundGeo, vcMat());
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // ---------- Gras-Büschel (instanziert) ----------
  const tuftGeo = paint(new THREE.ConeGeometry(0.08, 0.38, 3), '#5aa83e', 0.1, rand);
  tuftGeo.translate(0, 0.19, 0);
  const tufts = new THREE.InstancedMesh(tuftGeo, vcMat(), q.grass);
  const m4 = new THREE.Matrix4(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(), pos = new THREE.Vector3(), eul = new THREE.Euler();
  for (let i = 0; i < q.grass; i++) {
    pos.set(range(-MAP_HALF, MAP_HALF), 0, range(-MAP_HALF, MAP_HALF));
    quat.setFromEuler(eul.set(range(-0.25, 0.25), range(0, 6.28), range(-0.25, 0.25)));
    scl.setScalar(range(0.7, 1.5));
    tufts.setMatrixAt(i, m4.compose(pos, quat, scl));
  }
  scene.add(tufts);

  // ---------- Blumen (vereinzelt, teils in kleinen Gruppen) ----------
  const flowerColors = ['#ffffff', '#ffd84d', '#ff6b6b', '#c77dff', '#ff9ff3', '#74c0fc', '#ffa94d'].map((c) => new THREE.Color(c));
  const stemGeo = paint(new THREE.CylinderGeometry(0.012, 0.015, 0.32, 3), '#3f8a2e', 0, rand);
  stemGeo.translate(0, 0.16, 0);
  const headGeo = new THREE.IcosahedronGeometry(0.07, 0);
  headGeo.scale(1, 0.55, 1);
  headGeo.translate(0, 0.33, 0);
  const stems = new THREE.InstancedMesh(stemGeo, vcMat(), q.flowers);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial({ flatShading: true }), q.flowers);
  let fx = 0, fz = 0, fc = 0;
  for (let i = 0; i < q.flowers; i++) {
    if (i % 6 === 0) { fx = range(-MAP_HALF, MAP_HALF); fz = range(-MAP_HALF, MAP_HALF); fc = Math.floor(rand() * flowerColors.length); }
    const scatter = rand() < 0.5 ? 2.5 : 18; // Gruppe oder vereinzelt
    pos.set(fx + range(-scatter, scatter), 0, fz + range(-scatter, scatter));
    quat.setFromEuler(eul.set(range(-0.15, 0.15), range(0, 6.28), range(-0.15, 0.15)));
    scl.setScalar(range(0.8, 1.4));
    m4.compose(pos, quat, scl);
    stems.setMatrixAt(i, m4);
    heads.setMatrixAt(i, m4);
    heads.setColorAt(i, flowerColors[rand() < 0.75 ? fc : Math.floor(rand() * flowerColors.length)]);
  }
  scene.add(stems, heads);

  // ---------- Felsen, Bäume, Kisten ----------
  const rockGeos = [], trunkGeos = [], crownGeos = [], crateGeos = [], buildingGeos = [];
  const rockCols = ['#8b929b', '#7a828c', '#9aa1a9', '#858b80'];
  const crownCols = ['#3f8f3a', '#4c9e3f', '#357d36', '#5aa84a'];
  for (const o of world.obstacles) {
    const r2 = rng(o.seed || Math.floor(o.x * 1000 + o.z));
    if (o.type === 'rock') {
      let g = new THREE.IcosahedronGeometry(1, o.r > 2.2 ? 1 : 0);
      g = jitter(g, 0.35, r2);
      g.scale(o.r * 0.95, o.h * 0.8, o.r * 0.95);
      g.rotateY(r2() * 6.28);
      g.translate(o.x, o.h * 0.25, o.z);
      rockGeos.push(paint(g, rockCols[Math.floor(r2() * rockCols.length)], 0.08, r2));
    } else if (o.type === 'tree') {
      const t = new THREE.CylinderGeometry(o.r * 0.7, o.r, o.trunkH + 0.4, 6);
      t.translate(o.x, (o.trunkH + 0.4) / 2, o.z);
      trunkGeos.push(paint(t, '#7a5230', 0.08, r2));
      const col = crownCols[Math.floor(r2() * crownCols.length)];
      if (r2() < 0.5) { // Nadelbaum: gestapelte Kegel
        for (let k = 0; k < 3; k++) {
          const c = new THREE.ConeGeometry(o.crownR * (1 - k * 0.25), o.crownR * 1.2, 7);
          c.translate(o.x, o.trunkH * 0.75 + k * o.crownR * 0.65 + o.crownR * 0.6, o.z);
          crownGeos.push(paint(c, col, 0.1, r2));
        }
      } else { // Laubbaum: zerknautschte Kugel
        let c = new THREE.IcosahedronGeometry(o.crownR, 0);
        c = jitter(c, o.crownR * 0.35, r2);
        c.translate(o.x, o.trunkH + o.crownR * 0.9, o.z);
        crownGeos.push(paint(c, col, 0.12, r2));
      }
    } else if (o.type === 'box' && o.mat !== 'crate') {
      const g = new THREE.BoxGeometry(o.w, o.h, o.d);
      g.translate(o.x, o.y + o.h / 2, o.z);
      const variance = o.mat === 'brick' || o.mat === 'stone' || o.mat === 'barn' ? 0.1 : 0.04;
      (o.y > 0.5 || o.h > 2 ? buildingGeos : crateGeos).push(paint(g, BOX_COLORS[o.mat] || '#999999', variance, r2));
    } else if (o.type === 'box') {
      const s = o.w, h = s / 2, y0 = o.y;
      const parts = [];
      const body = new THREE.BoxGeometry(s * 0.96, s * 0.96, s * 0.96);
      body.translate(0, h, 0);
      parts.push(paint(body, '#c99556', 0.05, r2));
      const e = s * 0.12; // Rahmenbalken
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const v = new THREE.BoxGeometry(e, s, e);
        v.translate(sx * (h - e / 2), h, sz * (h - e / 2));
        parts.push(paint(v, '#8a5a2e', 0, r2));
      }
      for (const yy of [e / 2, s - e / 2]) {
        for (const [w, d, x, z] of [[s, e, 0, -(h - e / 2)], [s, e, 0, h - e / 2], [e, s, -(h - e / 2), 0], [e, s, h - e / 2, 0]]) {
          const b = new THREE.BoxGeometry(w, e, d);
          b.translate(x, yy, z);
          parts.push(paint(b, '#8a5a2e', 0, r2));
        }
      }
      const diag = new THREE.BoxGeometry(s * 1.2, e * 0.8, s * 0.99); // Diagonalbrett
      diag.rotateZ(Math.PI / 4);
      diag.translate(0, h, 0);
      parts.push(paint(diag, '#a87442', 0, r2));
      const crate = mergeGeometries(parts);
      crate.translate(o.x, y0, o.z);
      crateGeos.push(crate);
    }
  }
  const addMerged = (geos, cast = true, material = vcMat()) => {
    if (!geos.length) return null;
    const m = new THREE.Mesh(mergeGeometries(geos), material);
    m.castShadow = cast;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  addMerged(rockGeos);
  addMerged(trunkGeos);
  addMerged(crownGeos);
  addMerged(crateGeos);
  addMerged(buildingGeos);
  const roofGeos = (world.decor || []).filter((d) => d.type === 'roof').map((r) => paint(roofGeometry(r), ROOF_COLORS[r.mat] || '#b84a35', 0.08, rand));
  addMerged(roofGeos, true, vcMat({ side: THREE.DoubleSide }));

  // ---------- Zaun an der Arena-Grenze ----------
  const fence = [];
  const L = MAP_HALF + 0.5;
  for (let s = -L; s <= L; s += 4) {
    for (const [x, z] of [[s, -L], [s, L], [-L, s], [L, s]]) {
      const post = new THREE.BoxGeometry(0.22, 1.4, 0.22);
      post.translate(x, 0.7, z);
      fence.push(paint(post, '#8a5a2e', 0.05, rand));
    }
  }
  for (const y of [0.55, 1.1]) {
    for (const [w, d, x, z] of [[L * 2, 0.1, 0, -L], [L * 2, 0.1, 0, L], [0.1, L * 2, -L, 0], [0.1, L * 2, L, 0]]) {
      const rail = new THREE.BoxGeometry(w, 0.12, d);
      rail.translate(x, y, z);
      fence.push(paint(rail, '#a87442', 0, rand));
    }
  }
  addMerged(fence, false);

  // ---------- Kulisse: Bäume auf den Hügeln ----------
  const far = [];
  for (let i = 0; i < 230; i++) {
    const a = rand() * Math.PI * 2, d = range(MAP_HALF + 20, MAP_HALF + 110);
    const x = Math.cos(a) * d * 1.1, z = Math.sin(a) * d * 1.1;
    const out = Math.max(Math.abs(x), Math.abs(z)) - (MAP_HALF + 6);
    if (out < 8) continue;
    const baseY = Math.min(40, out * 0.35) * 0.6;
    const h = range(4, 9);
    const c = new THREE.ConeGeometry(h * 0.35, h, 6);
    c.translate(x, baseY + h / 2, z);
    far.push(paint(c, crownCols[i % crownCols.length], 0.1, rand));
  }
  addMerged(far, false);

  // ---------- Wolken ----------
  const clouds = new THREE.Group();
  const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, emissive: '#dfefff', emissiveIntensity: 0.4, fog: false });
  for (let i = 0; i < 18; i++) {
    const cl = new THREE.Group();
    const n = 3 + Math.floor(rand() * 3);
    for (let k = 0; k < n; k++) {
      const puff = new THREE.Mesh(jitter(new THREE.IcosahedronGeometry(range(5, 9), 0), 2, rand), cloudMat);
      puff.position.set(k * 7 - n * 3.5, range(-1, 2), range(-3, 3));
      puff.scale.y = 0.55;
      cl.add(puff);
    }
    cl.position.set(range(-400, 400), range(90, 140), range(-400, 400));
    clouds.add(cl);
  }
  scene.add(clouds);

  return {
    sun,
    clouds,
    /** Schatten-Kamera folgt dem Spieler; Wolken ziehen langsam. */
    update(dt, playerPos) {
      sun.position.set(playerPos.x + 60, 90, playerPos.z + 35);
      sun.target.position.set(playerPos.x, 0, playerPos.z);
      for (const c of clouds.children) {
        c.position.x += dt * 2.5;
        if (c.position.x > 450) c.position.x = -450;
      }
    },
  };
}
