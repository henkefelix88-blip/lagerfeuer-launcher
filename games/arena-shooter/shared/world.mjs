/**
 * Blumenfeld Arena – gemeinsame Spiellogik für Server (Node) und Client (Browser).
 * Enthält: Konstanten, Waffen, Items (Kart-Racer-artige Power-Ups), deterministische Map-Erzeugung
 * inkl. begehbarer Gebäude, Kollision und Raycasts. Server und Client sehen dadurch exakt dieselbe Map.
 */

export const PROTOCOL_VERSION = 2;
export const MAP_HALF = 180; // Map ist 360 × 360 m
export const PLAYER_RADIUS = 0.45;
export const EYE_HEIGHT = 1.6;
export const MAX_HP = 100;
export const WALK_SPEED = 6.2;
export const SPRINT_SPEED = 10.5;
export const SNEAK_FACTOR = 0.45;  // Schleichen (Shift): langsamer, leise, geduckt
export const CROUCH_FACTOR = 0.72; // Körperhöhe beim Schleichen
export const GRAVITY = 22;
export const JUMP_SPEED = 7.5;
export const STEP_HEIGHT = 0.5; // so hohe Stufen/Kanten werden automatisch erklommen
export const RESPAWN_TIME = 3;
export const SPAWN_PROTECTION = 1.5;
export const STAMINA = { max: 100, drain: 28, regen: 20, regenDelay: 0.8, minToStart: 15 };
export const TICK_RATE = 20;

/**
 * Waffen. damage pro Projektil, rate = Sekunden zwischen Schüssen, spread/adsSpread in Radiant,
 * zoom = Faktor, um den das Sichtfeld beim Zielen (Rechtsklick) verkleinert wird.
 */
export const WEAPONS = {
  knife: { id: 'knife', name: 'Messer', damage: 55, rate: 0.5, mag: 0, reserve: 0, reload: 0, spread: 0, adsSpread: 0, pellets: 1, range: 2.6, auto: true, falloff: 99, recoil: 0, zoom: 1, melee: true, headMul: 1.3 },
  pistol: { id: 'pistol', name: 'Pistole', damage: 24, rate: 0.24, mag: 12, reserve: 48, reload: 1.3, spread: 0.014, adsSpread: 0.006, pellets: 1, range: 140, auto: false, falloff: 60, recoil: 0.025, zoom: 1.3, headMul: 1.6 },
  smg: { id: 'smg', name: 'MP', damage: 11, rate: 0.065, mag: 35, reserve: 140, reload: 1.7, spread: 0.035, adsSpread: 0.02, pellets: 1, range: 110, auto: true, falloff: 35, recoil: 0.01, zoom: 1.3, headMul: 1.5 },
  rifle: { id: 'rifle', name: 'Sturmgewehr', damage: 16, rate: 0.095, mag: 30, reserve: 120, reload: 2.1, spread: 0.022, adsSpread: 0.008, pellets: 1, range: 200, auto: true, falloff: 90, recoil: 0.014, zoom: 1.6, headMul: 1.6 },
  shotgun: { id: 'shotgun', name: 'Schrotflinte', damage: 11, rate: 0.85, mag: 6, reserve: 24, reload: 2.6, spread: 0.085, adsSpread: 0.065, pellets: 9, range: 45, auto: false, falloff: 12, recoil: 0.06, zoom: 1.2, headMul: 1.4 },
  sniper: { id: 'sniper', name: 'Scharfschützengewehr', damage: 90, rate: 1.4, mag: 5, reserve: 20, reload: 2.8, spread: 0.07, adsSpread: 0.0004, pellets: 1, range: 400, auto: false, falloff: 400, recoil: 0.08, zoom: 4.5, headMul: 2, scope: true },
  rocket: { id: 'rocket', name: 'Raketenwerfer', damage: 120, rate: 1.1, mag: 1, reserve: 8, reload: 1.9, spread: 0.004, adsSpread: 0.002, pellets: 1, range: 250, auto: false, falloff: 999, recoil: 0.07, zoom: 1.4, headMul: 1, projectile: 'rocket' },
};
export const WEAPON_ORDER = ['knife', 'pistol', 'smg', 'rifle', 'shotgun', 'sniper', 'rocket'];
export const ROCKET = { speed: 48, radius: 6, selfDamage: 0.5, knockback: 16 };

/**
 * Buffs/Debuffs mit Dauer (Sekunden), werden im HUD mit Restzeit angezeigt.
 */
export const BUFFS = {
  turbo: { id: 'turbo', name: 'Turbo', duration: 3, color: '#ff8a2a' },
  star: { id: 'star', name: 'Superstern', duration: 8, color: '#ffd84d' },
  damage: { id: 'damage', name: 'Schadens-Boost', duration: 15, color: '#f0503a' },
  shield: { id: 'shield', name: 'Schild', duration: 15, color: '#5b8def' },
  regen: { id: 'regen', name: 'Regeneration', duration: 10, color: '#e2534a' },
  shrink: { id: 'shrink', name: 'Geschrumpft', duration: 6, color: '#a77bff', debuff: true },
  ink: { id: 'ink', name: 'Tinte', duration: 5, color: '#3b3355', debuff: true },
  stun: { id: 'stun', name: 'Ausgerutscht', duration: 1.2, color: '#f2d24e', debuff: true },
};
export const BUFF_ORDER = ['turbo', 'star', 'damage', 'shield', 'regen', 'shrink', 'ink', 'stun'];

/**
 * Items aus den Item-Boxen (angelehnt an Fun-Racer): Man trägt eins im Item-Slot und setzt es mit Q ein.
 * weight[x]: Wahrscheinlichkeit für Führende (0) … Letzte (1) → Hintere bekommen stärkere Items.
 */
export const ITEMS = {
  turbo: { id: 'turbo', name: 'Turbo-Pilz', desc: '3 s extrem schnell', color: '#ff8a2a', weight: [3, 2] },
  star: { id: 'star', name: 'Superstern', desc: '8 s unverwundbar, schnell, Berührung = K.O.', color: '#ffd84d', weight: [0.3, 2.5] },
  lightning: { id: 'lightning', name: 'Blitz', desc: 'Alle Gegner: Schaden + 6 s geschrumpft', color: '#ffe14d', weight: [0.2, 1.8] },
  greenShell: { id: 'greenShell', name: 'Abprall-Kugel', desc: 'Prallt von Wänden ab, 60 Schaden', color: '#4cc26a', weight: [3, 1.5] },
  redShell: { id: 'redShell', name: 'Such-Kugel', desc: 'Verfolgt den nächsten Gegner, 70 Schaden', color: '#e2534a', weight: [1, 2.5] },
  banana: { id: 'banana', name: 'Bananenschale', desc: 'Falle: Gegner rutschen aus', color: '#f6d743', weight: [3, 0.8] },
  ink: { id: 'ink', name: 'Tintenklecks', desc: 'Verschmiert allen Gegnern 5 s die Sicht', color: '#6a5acd', weight: [1.5, 1.5] },
  heart: { id: 'heart', name: 'Herz', desc: '+60 LP und Regeneration', color: '#ff5a7a', weight: [1.5, 2] },
  shield: { id: 'shield', name: 'Schild', desc: '15 s halber Schaden', color: '#5b8def', weight: [1.5, 1.5] },
  damage: { id: 'damage', name: 'Feuerkraft', desc: '15 s +50 % Schaden', color: '#f0503a', weight: [1.5, 1.5] },
};
export const ITEM_ORDER = Object.keys(ITEMS);
export const SHELL = { speed: 26, life: 7, radius: 0.35, bounces: 6, damage: { greenShell: 60, redShell: 70 } };
export const ITEMBOX_RESPAWN = 6;
export const WEAPON_RESPAWN = 20;

/** Cheat-Codes (im Chat eintippen; werden NICHT im Chat angezeigt, erneutes Eintippen schaltet aus). */
export const CHEATS = {
  '##########': { id: 'god', name: 'Dreifaches Tempo, Fliegen & unendlich Munition' },
  '!!!!!!!!!!': { id: 'trigger', name: 'Triggerbot' },
  '$$$$$$$$$$': { id: 'life', name: '10-faches Leben' },
};

/** Kleiner, deterministischer Zufallsgenerator (Mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ======================================================================
//  Gebäude-Baukasten. Alles sind achsenparallele Quader ("box"), damit
//  Kollision und Treffer exakt zur Grafik passen. Fenster/Türen sind echte
//  Öffnungen (man kann durchschießen und durch Türen laufen).
// ======================================================================
class Builder {
  constructor(cx, cz, rot) { this.cx = cx; this.cz = cz; this.rot = rot; this.boxes = []; this.decor = []; this.spots = []; }
  /** lokale Box (Mittelpunkt lx/lz, Breite w entlang x, Tiefe d entlang z, Unterkante y, Höhe h) → Welt */
  box(lx, lz, w, d, y, h, mat) {
    const [x, z, ww, dd] = this.tf(lx, lz, w, d);
    this.boxes.push({ type: 'box', x, z, y, w: ww, d: dd, h, mat });
  }
  tf(lx, lz, w, d) {
    switch (this.rot & 3) {
      case 1: return [this.cx - lz, this.cz + lx, d, w];
      case 2: return [this.cx - lx, this.cz - lz, w, d];
      case 3: return [this.cx + lz, this.cz - lx, d, w];
      default: return [this.cx + lx, this.cz + lz, w, d];
    }
  }
  /** Spitzdach (nur Grafik), First entlang der lokalen z-Achse. */
  roof(lx, lz, w, d, y, h, mat) {
    const [x, z, ww, dd] = this.tf(lx, lz, w, d);
    const alongZ = (this.rot & 1) === 0;
    this.decor.push({ type: 'roof', x, z, y, w: ww, d: dd, h, alongZ, mat });
  }
  spot(lx, lz, y) { const [x, z] = this.tf(lx, lz, 0, 0); this.spots.push({ x, z, y }); }
  /**
   * Wand entlang x (axis 'x', bei lokalem z) oder entlang z (axis 'z', bei lokalem x) mit Öffnungen.
   * openings: [{ at, width, bottom, top }] – at = Mitte entlang der Wand (relativ zur Wandmitte)
   */
  wall(axis, pos, from, to, y, h, t, openings, mat) {
    const ops = [...openings].sort((a, b) => a.at - b.at);
    const seg = (a, b, yy, hh) => {
      if (b - a < 0.02 || hh < 0.02) return;
      const mid = (a + b) / 2, len = b - a;
      if (axis === 'x') this.box(mid, pos, len, t, yy, hh, mat);
      else this.box(pos, mid, t, len, yy, hh, mat);
    };
    let cur = from;
    for (const o of ops) {
      const a = o.at - o.width / 2, b = o.at + o.width / 2;
      seg(cur, a, y, h);
      seg(a, b, y, o.bottom);                 // Brüstung unter dem Fenster
      seg(a, b, y + o.top, h - o.top);        // Sturz über Fenster/Tür
      cur = b;
    }
    seg(cur, to, y, h);
  }
}

const door = (at) => ({ at, width: 1.7, bottom: 0, top: 2.5 });
const win = (at, w = 1.5) => ({ at, width: w, bottom: 1.0, top: 2.2 });

function buildHouse(b, rand) {
  const W = 9, D = 11, H = 3.2, T = 0.3;
  const wall = ['plaster', 'plasterWarm', 'wood'][Math.floor(rand() * 3)];
  b.box(0, 0, W, D, 0, 0.12, 'floor');
  b.wall('x', -D / 2 + T / 2, -W / 2, W / 2, 0, H, T, [door(0), win(-2.8, 1.3), win(2.8, 1.3)], wall);
  b.wall('x', D / 2 - T / 2, -W / 2, W / 2, 0, H, T, [win(-2.2), win(2.2)], wall);
  b.wall('z', -W / 2 + T / 2, -D / 2 + T, D / 2 - T, 0, H, T, [win(-2.5), win(2.5)], wall);
  b.wall('z', W / 2 - T / 2, -D / 2 + T, D / 2 - T, 0, H, T, [win(0, 2)], wall);
  b.box(0, 0, W, D, H, 0.25, 'ceiling');
  b.roof(0, 0, W + 0.8, D + 0.8, H + 0.25, 2.6, 'roof');
  b.box(-2.5, 3, 1.6, 0.9, 0, 0.8, 'furniture'); // Tisch
  b.spot(0, 1, 0.12);
}

function buildTownhouse(b) {
  const W = 10, D = 10, H = 3.4, T = 0.3, SL = 0.25;
  const top = H + SL; // Oberkante Zwischendecke
  b.box(0, 0, W, D, 0, 0.12, 'floor');
  b.wall('x', -D / 2 + T / 2, -W / 2, W / 2, 0, H, T, [door(-2), win(2.5)], 'brick');
  b.wall('x', D / 2 - T / 2, -W / 2, W / 2, 0, H, T, [win(-2.5), win(2.5)], 'brick');
  b.wall('z', -W / 2 + T / 2, -D / 2 + T, D / 2 - T, 0, H, T, [win(0, 2.2)], 'brick');
  b.wall('z', W / 2 - T / 2, -D / 2 + T, D / 2 - T, 0, H, T, [], 'brick');
  // Treppe innen entlang der rechten Wand (jede Stufe ein Klotz bis zum Boden)
  const n = 12, stepH = top / n, stepD = 0.55, sx = W / 2 - T - 0.65, z0 = -D / 2 + T + 1.0;
  for (let i = 0; i < n; i++) b.box(sx, z0 + i * stepD + stepD / 2, 1.3, stepD, 0, (i + 1) * stepH, 'stairs');
  // Zwischendecke mit Treppenloch
  const holeX0 = sx - 0.65, holeZ1 = z0 + n * stepD;
  b.box((-W / 2 + holeX0) / 2, 0, holeX0 + W / 2, D, H, SL, 'ceiling');
  b.box((holeX0 + W / 2) / 2, (holeZ1 + D / 2) / 2, W / 2 - holeX0, D / 2 - holeZ1, H, SL, 'ceiling');
  b.box((holeX0 + W / 2) / 2, (-D / 2 + z0) / 2, W / 2 - holeX0, z0 + D / 2, H, SL, 'ceiling');
  // Dachterrasse mit Brüstung (Scharfschützen-Nest)
  const pH = 1.1;
  b.wall('x', -D / 2 + T / 2, -W / 2, W / 2, top, pH, T, [{ at: 0, width: 1.4, bottom: 0.5, top: pH }], 'brick');
  b.wall('x', D / 2 - T / 2, -W / 2, W / 2, top, pH, T, [{ at: 0, width: 1.4, bottom: 0.5, top: pH }], 'brick');
  b.wall('z', -W / 2 + T / 2, -D / 2 + T, D / 2 - T, top, pH, T, [], 'brick');
  b.wall('z', W / 2 - T / 2, -D / 2 + T, D / 2 - T, top, pH, T, [], 'brick');
  b.spot(-2, 2, top);
}

function buildBarn(b) {
  const W = 14, D = 22, H = 5.5, T = 0.35;
  b.box(0, 0, W, D, 0, 0.12, 'floor');
  const big = (at) => ({ at, width: 4.2, bottom: 0, top: 4.2 });
  const high = (at) => ({ at, width: 2, bottom: 3, top: 4.4 });
  b.wall('x', -D / 2 + T / 2, -W / 2, W / 2, 0, H, T, [big(0)], 'barn');
  b.wall('x', D / 2 - T / 2, -W / 2, W / 2, 0, H, T, [big(0)], 'barn');
  b.wall('z', -W / 2 + T / 2, -D / 2 + T, D / 2 - T, 0, H, T, [high(-6), high(0), high(6), door(3)], 'barn');
  b.wall('z', W / 2 - T / 2, -D / 2 + T, D / 2 - T, 0, H, T, [high(-6), high(0), high(6), door(-3)], 'barn');
  b.box(0, 0, W, D, H, 0.3, 'ceiling');
  b.roof(0, 0, W + 1, D + 1, H + 0.3, 4, 'barnRoof');
  // Heuballen & Kisten als Deckung innen
  b.box(-3.5, -5, 2.2, 1.4, 0, 1.2, 'hay'); b.box(-3.5, -5, 2.2, 1.4, 1.2, 1.2, 'hay');
  b.box(3.5, 4, 2.2, 1.4, 0, 1.2, 'hay');
  b.box(-4, 6, 1.6, 1.6, 0, 1.6, 'crate'); b.box(4, -6, 1.6, 1.6, 0, 1.6, 'crate');
  b.spot(0, 0, 0.12);
}

function buildTower(b) {
  const P = 4.6, Y = 6.3, T = 0.3;
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) b.box(x, z, 0.5, 0.5, 0, Y, 'woodDark');
  b.box(0, 0, P, P, Y - 0.3, 0.3, 'planks');
  // Brüstung mit Öffnung zur Treppe
  b.wall('x', P / 2 - T / 2, -P / 2, P / 2, Y, 1.1, T, [], 'wood');
  b.wall('z', -P / 2 + T / 2, -P / 2 + T, P / 2 - T, Y, 1.1, T, [], 'wood');
  b.wall('z', P / 2 - T / 2, -P / 2 + T, P / 2 - T, Y, 1.1, T, [], 'wood');
  b.wall('x', -P / 2 + T / 2, -P / 2, P / 2, Y, 1.1, T, [{ at: 0, width: 1.4, bottom: 0, top: 1.1 }], 'wood');
  b.roof(0, 0, P + 0.8, P + 0.8, Y + 2.6, 1.8, 'roof');
  for (const [x, z] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) b.box(x, z, 0.25, 0.25, Y + 1.1, 1.5, 'woodDark');
  // Außentreppe (Steinstufen) zur Plattform
  const n = 21, stepH = Y / n, stepD = 0.55;
  for (let i = 0; i < n; i++) b.box(0, -P / 2 - (n - i) * stepD + stepD / 2, 1.4, stepD, 0, (i + 1) * stepH, 'stone');
  b.spot(0, 0.6, Y);
}

function buildRuin(b, rand) {
  const W = 10, D = 8, T = 0.5;
  const h = () => 1.2 + rand() * 2.6;
  b.wall('x', -D / 2, -W / 2, -1, 0, h(), T, [win(-3)], 'stone');
  b.wall('x', D / 2, 1, W / 2, 0, h(), T, [], 'stone');
  b.wall('z', -W / 2, -D / 2, D / 2 - 2, 0, h(), T, [win(0)], 'stone');
  b.wall('z', W / 2, -1, D / 2, 0, h(), T, [], 'stone');
  b.box(0, 0, 1.6, 1.6, 0, 0.8, 'stone');
  b.spot(-2.5, 1.5, 0);
}

const BUILDERS = { house: buildHouse, townhouse: buildTownhouse, barn: buildBarn, tower: buildTower, ruin: buildRuin };
const FOOTPRINT = { house: 8, townhouse: 7.5, barn: 13, tower: 9, ruin: 7 };

/**
 * Erzeugt die Map aus einem Seed.
 *  obstacles: rock {x,z,r,h}, tree {x,z,r,trunkH,crownR}, box {x,z,y,w,d,h,mat}
 *  decor:     nur Grafik (Dächer)
 */
export function generateWorld(seed = 1337) {
  const rand = rng(seed);
  const range = (a, b) => a + rand() * (b - a);
  const obstacles = [];
  const decor = [];
  const reserved = []; // Kreise, die frei bleiben müssen

  const free = (x, z, r) => {
    if (Math.abs(x) > MAP_HALF - r - 2 || Math.abs(z) > MAP_HALF - r - 2) return false;
    for (const p of reserved) if (Math.hypot(p.x - x, p.z - z) < p.r + r) return false;
    return true;
  };

  // --- Spieler-Spawns ---
  const playerSpawns = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2;
    const d = i % 2 ? 150 : 105;
    playerSpawns.push({ x: Math.cos(a) * d, z: Math.sin(a) * d });
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.5;
    playerSpawns.push({ x: Math.cos(a) * 60, z: Math.sin(a) * 60 });
  }
  for (const p of playerSpawns) reserved.push({ ...p, r: 4 });

  // --- Gebäude ---
  const buildings = [];
  const spots = [];
  const place = (type, x, z) => {
    const r = FOOTPRINT[type];
    if (!free(x, z, r)) return false;
    // Eingang zeigt grob zur Kartenmitte
    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const len = Math.hypot(x, z) || 1;
    let best = 0, bestDot = -2;
    dirs.forEach(([dx, dz], k) => { const dot = (dx * -x + dz * -z) / len; if (dot > bestDot) { bestDot = dot; best = k; } });
    const b = new Builder(x, z, best);
    BUILDERS[type](b, rand);
    obstacles.push(...b.boxes);
    decor.push(...b.decor);
    spots.push(...b.spots.map((s) => ({ ...s, building: type })));
    buildings.push({ type, x, z, rot: best });
    reserved.push({ x, z, r: r + 2 });
    return true;
  };
  // Dorf um den Platz in der Mitte
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    place(i % 3 === 1 ? 'townhouse' : 'house', Math.cos(a) * 34, Math.sin(a) * 34);
  }
  // Außenbereiche
  const outer = [['barn', 95, -70], ['barn', -85, 95], ['tower', 125, 125], ['tower', -125, -125], ['tower', 128, -120], ['tower', -120, 128],
    ['townhouse', 0, 95], ['townhouse', 0, -100], ['house', 70, 40], ['house', -70, -40], ['house', 60, -125], ['house', -60, 125],
    ['ruin', -110, 20], ['ruin', 115, 10], ['ruin', 20, 140], ['ruin', -25, -140], ['house', 150, 60], ['house', -150, -60]];
  for (const [type, x, z] of outer) {
    for (let t = 0; t < 12; t++) if (place(type, x + (t ? range(-12, 12) : 0), z + (t ? range(-12, 12) : 0))) break;
  }

  // --- Waffen-Spawns: in/auf Gebäuden + im Gelände ---
  const weaponSpawns = [];
  const typeFor = { tower: 'sniper', townhouse: 'sniper', barn: 'shotgun', house: 'smg', ruin: 'rifle' };
  for (const s of spots) weaponSpawns.push({ x: s.x, z: s.z, y: s.y, weapon: typeFor[s.building] });
  weaponSpawns.push({ x: 0, z: 0, y: 0, weapon: 'rocket' });
  const fieldTypes = ['rifle', 'shotgun', 'smg', 'pistol', 'rifle', 'rocket', 'shotgun', 'smg', 'rifle', 'pistol', 'sniper', 'smg'];
  for (let i = 0; i < fieldTypes.length; i++) {
    for (let t = 0; t < 40; t++) {
      const a = (i / fieldTypes.length) * Math.PI * 2 + range(-0.2, 0.2), d = range(50, 160);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!free(x, z, 3)) continue;
      weaponSpawns.push({ x, z, y: 0, weapon: fieldTypes[i] });
      reserved.push({ x, z, r: 3 });
      break;
    }
  }
  reserved.push({ x: 0, z: 0, r: 6 });

  // --- Item-Box-Reihen (wie auf einer Rennstrecke: 3 nebeneinander) ---
  const itemBoxSpawns = [];
  for (let i = 0; i < 10; i++) {
    for (let t = 0; t < 40; t++) {
      const a = (i / 10) * Math.PI * 2 + range(-0.25, 0.25), d = i % 2 ? range(70, 90) : range(115, 160);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (!free(x, z, 6)) continue;
      const tx = -Math.sin(a), tz = Math.cos(a); // quer zur Blickrichtung
      for (let k = -1; k <= 1; k++) itemBoxSpawns.push({ x: x + tx * k * 3, z: z + tz * k * 3 });
      reserved.push({ x, z, r: 6 });
      break;
    }
  }

  // --- Kisten-Gruppen, Felsen, Bäume ---
  for (let g = 0; g < 45; g++) {
    for (let tries = 0; tries < 30; tries++) {
      const cx = range(-MAP_HALF + 10, MAP_HALF - 10), cz = range(-MAP_HALF + 10, MAP_HALF - 10);
      if (!free(cx, cz, 5)) continue;
      const n = 2 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        const s = range(1.3, 1.9);
        const x = cx + (i % 2) * 2.1 + range(-0.2, 0.2);
        const z = cz + Math.floor(i / 2) * 2.1 + range(-0.2, 0.2);
        obstacles.push({ type: 'box', x, z, y: 0, w: s, d: s, h: s, mat: 'crate' });
        if (rand() < 0.35) obstacles.push({ type: 'box', x, z, y: s, w: s * 0.8, d: s * 0.8, h: s * 0.8, mat: 'crate' });
      }
      reserved.push({ x: cx + 1, z: cz + 1, r: 4 });
      break;
    }
  }
  for (let i = 0; i < 130; i++) {
    for (let tries = 0; tries < 30; tries++) {
      const r = range(1.0, 3.6);
      const x = range(-MAP_HALF, MAP_HALF), z = range(-MAP_HALF, MAP_HALF);
      if (!free(x, z, r + 1)) continue;
      obstacles.push({ type: 'rock', x, z, r, h: r * range(0.7, 1.1), seed: Math.floor(rand() * 1e9) });
      reserved.push({ x, z, r: r + 0.5 });
      break;
    }
  }
  for (let i = 0; i < 210; i++) {
    for (let tries = 0; tries < 30; tries++) {
      const x = range(-MAP_HALF, MAP_HALF), z = range(-MAP_HALF, MAP_HALF);
      if (!free(x, z, 2)) continue;
      obstacles.push({ type: 'tree', x, z, r: 0.38, trunkH: range(1.8, 3.2), crownR: range(1.8, 3.0), seed: Math.floor(rand() * 1e9) });
      reserved.push({ x, z, r: 1.2 });
      break;
    }
  }
  return { seed, half: MAP_HALF, obstacles, decor, buildings, playerSpawns, weaponSpawns, itemBoxSpawns, grid: buildGrid(obstacles) };
}

// ---------- Räumliches Gitter für schnelle Abfragen ----------
const CELL = 8;
function extent(o) { return o.type === 'box' ? Math.max(o.w, o.d) / 2 + 0.1 : o.type === 'tree' ? o.crownR : o.r; }
function buildGrid(obstacles) {
  const grid = new Map();
  obstacles.forEach((o, idx) => {
    const ext = extent(o);
    for (let gx = Math.floor((o.x - ext) / CELL); gx <= Math.floor((o.x + ext) / CELL); gx++) {
      for (let gz = Math.floor((o.z - ext) / CELL); gz <= Math.floor((o.z + ext) / CELL); gz++) {
        const k = gx * 100000 + gz;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(idx);
      }
    }
  });
  return grid;
}
function nearby(world, x, z, out = new Set()) {
  const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const list = world.grid.get((gx + dx) * 100000 + gz + dz);
    if (list) for (const i of list) out.add(i);
  }
  return out;
}

/**
 * Schiebt einen Kreis (Spieler) aus Hindernissen heraus und hält ihn in der Map.
 * Niedrige Kanten (≤ STEP_HEIGHT) werden ignoriert – groundHeight() hebt den Spieler dann darauf.
 * @param {{x:number,z:number,y?:number}} p wird verändert
 */
export function collide(world, p, radius = PLAYER_RADIUS, height = 1.8) {
  const feet = p.y ?? 0;
  for (const i of nearby(world, p.x, p.z)) {
    const o = world.obstacles[i];
    if (o.type === 'box') {
      const top = o.y + o.h;
      if (feet >= top - STEP_HEIGHT || feet + height <= o.y) continue;
      const hw = o.w / 2, hd = o.d / 2;
      const cx = Math.max(o.x - hw, Math.min(p.x, o.x + hw));
      const cz = Math.max(o.z - hd, Math.min(p.z, o.z + hd));
      const dx = p.x - cx, dz = p.z - cz;
      const d = Math.hypot(dx, dz);
      if (d < radius) {
        if (d < 1e-6) { // Mittelpunkt in der Box → zur nächsten Kante
          const ex = hw - Math.abs(p.x - o.x), ez = hd - Math.abs(p.z - o.z);
          if (ex < ez) p.x = o.x + Math.sign(p.x - o.x || 1) * (hw + radius);
          else p.z = o.z + Math.sign(p.z - o.z || 1) * (hd + radius);
        } else {
          p.x = cx + (dx / d) * radius;
          p.z = cz + (dz / d) * radius;
        }
      }
    } else {
      if (o.type === 'rock' && feet > o.h * 1.0) continue;
      const or = o.type === 'tree' ? o.r : o.r * 0.85;
      const dx = p.x - o.x, dz = p.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = or + radius;
      if (d < min && d > 1e-6) {
        p.x = o.x + (dx / d) * min;
        p.z = o.z + (dz / d) * min;
      }
    }
  }
  const lim = MAP_HALF - radius;
  p.x = Math.max(-lim, Math.min(lim, p.x));
  p.z = Math.max(-lim, Math.min(lim, p.z));
  return p;
}

/** Höhe der Fläche unter den Füßen (Boden 0, Kisten, Treppen, Decken/Terrassen). */
export function groundHeight(world, x, z, feetY, radius = PLAYER_RADIUS * 0.6) {
  let g = 0;
  for (const i of nearby(world, x, z)) {
    const o = world.obstacles[i];
    if (o.type !== 'box') continue;
    const top = o.y + o.h;
    if (Math.abs(x - o.x) < o.w / 2 + radius && Math.abs(z - o.z) < o.d / 2 + radius && feetY >= top - STEP_HEIGHT - 0.01 && top > g) g = top;
  }
  return g;
}

// ---------- Raycasts ----------
function raySphere(o, d, c, r) {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  if (t >= 0) return t;
  const t2 = -b + Math.sqrt(disc);
  return t2 >= 0 && cc < 0 ? 0 : Infinity;
}
function rayBox(o, d, min, max) {
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < min[a] || o[a] > max[a]) return Infinity;
    } else {
      let ta = (min[a] - o[a]) / d[a], tb = (max[a] - o[a]) / d[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return Infinity;
    }
  }
  return t0;
}
function rayCylinder(o, d, cx, cz, r, h) {
  const ox = o[0] - cx, oz = o[2] - cz;
  const a = d[0] * d[0] + d[2] * d[2];
  if (a < 1e-9) return Infinity;
  const b = ox * d[0] + oz * d[2];
  const c = ox * ox + oz * oz - r * r;
  const disc = b * b - a * c;
  if (disc < 0) return Infinity;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0) return Infinity;
  const y = o[1] + d[1] * t;
  return y >= 0 && y <= h ? t : Infinity;
}

/** Distanz bis zum ersten Treffer mit der Welt (Boden + Hindernisse). */
export function raycastWorld(world, o, d, maxDist) {
  let best = maxDist;
  if (d[1] < -1e-6) best = Math.min(best, -o[1] / d[1]);
  const seen = new Set();
  const step = CELL / 2;
  for (let s = 0; s * step <= best + step; s++) {
    const t = Math.min(s * step, best);
    const cand = nearby(world, o[0] + d[0] * t, o[2] + d[2] * t);
    for (const i of cand) {
      if (seen.has(i)) continue;
      seen.add(i);
      const ob = world.obstacles[i];
      let hit = Infinity;
      if (ob.type === 'box') {
        hit = rayBox(o, d, [ob.x - ob.w / 2, ob.y, ob.z - ob.d / 2], [ob.x + ob.w / 2, ob.y + ob.h, ob.z + ob.d / 2]);
      } else if (ob.type === 'rock') {
        hit = raySphere(o, d, [ob.x, ob.h * 0.25, ob.z], ob.r * 0.9);
      } else if (ob.type === 'tree') {
        hit = Math.min(rayCylinder(o, d, ob.x, ob.z, ob.r, ob.trunkH), raySphere(o, d, [ob.x, ob.trunkH + ob.crownR * 0.9, ob.z], ob.crownR * 0.85));
      }
      if (hit < best) best = hit;
    }
  }
  return best;
}

/** Trefferzonen eines Spielers: Kopf und Körper (Füße bei y). scale < 1 = geschrumpft, crouch = schleicht (geduckt). */
export function hitPlayer(o, d, p, scale = 1, crouch = false) {
  const h = scale * (crouch ? CROUCH_FACTOR : 1);
  const head = raySphere(o, d, [p.x, p.y + 1.62 * h, p.z], 0.27 * scale);
  const body = Math.min(
    raySphere(o, d, [p.x, p.y + 1.1 * h, p.z], 0.45 * scale),
    raySphere(o, d, [p.x, p.y + 0.5 * h, p.z], 0.42 * scale),
  );
  if (head < body) return { t: head, head: true };
  return { t: body, head: false };
}

/** Streut eine Richtung zufällig in einem Kegel (für Waffen-Streuung). */
export function spreadDir(d, spread, rand = Math.random) {
  if (spread <= 0) return d.slice();
  const up = Math.abs(d[1]) < 0.99 ? [0, 1, 0] : [1, 0, 0];
  let rx = up[1] * d[2] - up[2] * d[1], ry = up[2] * d[0] - up[0] * d[2], rz = up[0] * d[1] - up[1] * d[0];
  const rl = Math.hypot(rx, ry, rz); rx /= rl; ry /= rl; rz /= rl;
  const ux = d[1] * rz - d[2] * ry, uy = d[2] * rx - d[0] * rz, uz = d[0] * ry - d[1] * rx;
  const a = rand() * Math.PI * 2, m = Math.sqrt(rand()) * spread;
  const sx = Math.cos(a) * m, sy = Math.sin(a) * m;
  const out = [d[0] + rx * sx + ux * sy, d[1] + ry * sx + uy * sy, d[2] + rz * sx + uz * sy];
  const l = Math.hypot(...out);
  return [out[0] / l, out[1] / l, out[2] / l];
}

/** Blickrichtung aus Yaw/Pitch (Yaw 0 = Blick nach -Z, wie bei three.js-Kameras). */
export function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

/** Bewegungs-Multiplikator aus Buffs/Cheats (gleich auf Server und Client). */
export function speedMultiplier(buffs, cheats) {
  let m = 1;
  if (buffs.turbo) m *= 2.2;
  if (buffs.star) m *= 1.4;
  if (buffs.shrink) m *= 0.6;
  if (cheats && cheats.god) m *= 3;
  return m;
}

/** Stabiler Farbton je Spieler-ID. */
export function playerColor(id) {
  const palette = ['#e85934', '#5b8def', '#f2c14e', '#3fbf7f', '#b467d6', '#3fd0c9', '#ef7aa8', '#9acd32', '#ff9f43', '#7f8cff', '#d4a373', '#e2e2e2'];
  return palette[(id - 1) % palette.length];
}
