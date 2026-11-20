/**
 * Parkour – Strecken (gemeinsam für Server und Client, deterministisch aus einem Seed).
 * Elemente:
 *   box   – feste Plattform              {x,y,z,w,h,d,c}
 *   mover – bewegliche Plattform          + {axis:'x'|'y'|'z', amp, period, phase}
 *   blink – erscheint/verschwindet        + {period, phase}  (sichtbar, solange sin > -0.2)
 *   pad   – Sprungpad (schleudert hoch)   {x,y,z}
 *   cp    – Checkpoint-Fahne              {x,y,z,i}
 *   goal  – Ziel-Portal                   {x,y,z}
 * Positionen beweglicher Teile hängen nur von der Serverzeit ab → alle sehen dasselbe.
 */
export const PHYS = { speed: 7.5, sprint: 11, jump: 9.5, gravity: 26, pad: 19, radius: 0.4, height: 1.8, killY: -25 };

export const THEMES = [
  { name: 'Blumenwiese', sky: ['#4f9fe0', '#cdebf7'], fog: '#cdebf7', top: ['#6abf4b', '#79c35a', '#5aa83e'], side: '#8a6a4a', accent: '#f08c32', floor: null },
  { name: 'Wolkenpfad', sky: ['#7a6fd0', '#ffd6e8'], fog: '#f2d9ec', top: ['#ffffff', '#f2f5ff', '#e6ecff'], side: '#b7c4e6', accent: '#ff7ab8', floor: null },
  { name: 'Lavaturm', sky: ['#2a1a2e', '#a8442a'], fog: '#5a2a2a', top: ['#6b6f78', '#7d8089', '#5d6068'], side: '#3b3f47', accent: '#ffb347', floor: 'lava' },
];

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Baut Level n (0…2). Rückgabe: { theme, parts, start, cps, goal, route } */
export function buildLevel(n) {
  const theme = THEMES[n % THEMES.length];
  const rand = rng(1000 + n * 77);
  const R = (a, b) => a + rand() * (b - a);
  const parts = [];
  const route = []; // Wegpunkte für Bots
  let x = 0, y = 0, z = 0;
  const c = () => theme.top[Math.floor(rand() * theme.top.length)];
  const box = (bx, by, bz, w, d, h = 1) => { parts.push({ type: 'box', x: bx, y: by - h, z: bz, w, h, d, c: c() }); };
  const land = () => route.push([x, y, z]);

  box(0, 0, 0, 8, 8, 2); // Startplattform
  land();
  const start = [0, 0.05, 0];
  let cpIndex = 0;
  const cps = [];
  const checkpoint = () => {
    z += 6; box(x, y, z, 6, 6, 1.5); land();
    const cp = { type: 'cp', x, y, z, i: cpIndex++ };
    parts.push(cp); cps.push(cp);
  };

  // Segment-Generatoren (Schwierigkeit steigt mit dem Level)
  const diff = 1 + n * 0.35;
  const segs = {
    gaps() { for (let i = 0; i < 4; i++) { z += R(3.5, 5.2) * Math.min(1.15, diff); x += R(-2, 2); y += R(-0.5, 0.8); box(x, y, z, R(2.2, 3.2) / Math.sqrt(diff), R(2.2, 3.2), 1); land(); } },
    stairs() { const dir = rand() < 0.5 ? -1 : 1; for (let i = 0; i < 6; i++) { x += dir * 2.2; z += 1.4; y += 1.1; box(x, y, z, 2, 2, 0.6); land(); } },
    zigzag() { for (let i = 0; i < 5; i++) { x += (i % 2 ? 3.5 : -3.5); z += 3; box(x, y, z, 1.6, 1.6, 0.6); land(); } },
    beam() { z += 3; const len = 12; parts.push({ type: 'box', x, y: y - 0.5, z: z + len / 2, w: 0.6, h: 0.5, d: len, c: theme.accent }); z += len; land(); z += 2.5; box(x, y, z, 3, 3, 1); land(); },
    pad() { z += 4; box(x, y, z, 3, 3, 1); parts.push({ type: 'pad', x, y, z }); land(); z += 9; y += 6.5; box(x, y, z, 4, 4, 1); land(); },
    mover() {
      for (let i = 0; i < 3; i++) {
        z += 5;
        const axis = n === 0 ? 'x' : ['x', 'y', 'z'][Math.floor(rand() * 3)];
        parts.push({ type: 'mover', x, y: y - 0.6, z, w: 2.8, h: 0.6, d: 2.8, c: theme.accent, axis, amp: axis === 'z' ? 1.2 : 2.5, period: R(2.6, 4), phase: R(0, 6.28) });
        land();
      }
      z += 5; box(x, y, z, 3, 3, 1); land();
    },
    blink() {
      for (let i = 0; i < 5; i++) {
        z += R(3.4, 4.2); x += R(-1.5, 1.5);
        parts.push({ type: 'blink', x, y: y - 0.6, z, w: 2.6, h: 0.6, d: 2.6, c: '#e2534a', period: 3, phase: i * 1.1 });
        land();
      }
      z += 4; box(x, y, z, 3, 3, 1); land();
    },
    tower() { for (let i = 0; i < 7; i++) { const a = i * 1.6; x += Math.cos(a) * 3.2; z += Math.sin(a) * 3.2 + 0.6; y += 1.3; box(x, y, z, 2.2, 2.2, 0.6); land(); } },
  };
  const pools = [
    ['gaps', 'stairs', 'zigzag', 'pad', 'beam', 'gaps', 'mover', 'stairs'],
    ['mover', 'gaps', 'beam', 'mover', 'pad', 'zigzag', 'mover', 'blink'],
    ['tower', 'blink', 'mover', 'gaps', 'tower', 'blink', 'pad', 'beam'],
  ][n % 3];
  pools.forEach((name, i) => { segs[name](); if (i % 2 === 1 && i < pools.length - 1) checkpoint(); });
  z += 6; box(x, y, z, 8, 8, 2); land();
  const goal = { type: 'goal', x, y, z };
  parts.push(goal);
  return { n, theme, parts, start, cps, goal, route };
}

/** Position einer (beweglichen) Plattform zum Zeitpunkt t. */
export function partPos(p, t) {
  if (p.type !== 'mover') return [p.x, p.y, p.z];
  const off = Math.sin((t / p.period) * Math.PI * 2 + p.phase) * p.amp;
  return [p.x + (p.axis === 'x' ? off : 0), p.y + (p.axis === 'y' ? off : 0), p.z + (p.axis === 'z' ? off : 0)];
}
export function partSolid(p, t) {
  if (p.type === 'blink') return Math.sin((t / p.period) * Math.PI * 2 + p.phase) > -0.2;
  return p.type === 'box' || p.type === 'mover' || p.type === 'blink';
}
