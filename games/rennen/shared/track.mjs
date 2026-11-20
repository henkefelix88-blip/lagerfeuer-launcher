/**
 * Turbo-Rennen – Strecke (gemeinsam für Server und Client): geschlossene Catmull-Rom-Kurve durch Kontrollpunkte.
 */
export const WIDTH = 130; // Streckenbreite
const CTRL = [[0, 0], [700, -80], [1150, 120], [1250, 550], [950, 850], [600, 700], [350, 950], [-150, 1000], [-550, 760], [-650, 330], [-400, 80]];
export const BOOSTS = [0.18, 0.47, 0.8]; // Anteil der Strecke, an dem Boost-Felder liegen

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return [0, 1].map((i) => 0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3));
}

/** Abtastpunkte der Mittellinie mit Tangente und Laufdistanz. */
export function buildTrack(samplesPerSeg = 40) {
  const pts = [];
  const n = CTRL.length;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < samplesPerSeg; k++) pts.push(catmull(CTRL[(i - 1 + n) % n], CTRL[i], CTRL[(i + 1) % n], CTRL[(i + 2) % n], k / samplesPerSeg));
  }
  let dist = 0;
  const out = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
    const s = { x: p[0], y: p[1], tx: dx / len, ty: dy / len, d: dist };
    dist += len;
    return s;
  });
  return { pts: out, length: dist, boosts: BOOSTS.map((f) => out[Math.floor(f * out.length)]) };
}

/** Nächster Abtastpunkt (lokale Suche um einen Hinweis-Index, sonst global). */
export function nearest(track, x, y, hint = -1) {
  const P = track.pts;
  let best = 0, bd = Infinity;
  const range = hint >= 0 ? [hint - 25, hint + 25] : [0, P.length - 1];
  for (let j = range[0]; j <= range[1]; j++) {
    const i = (j + P.length) % P.length;
    const d = (P[i].x - x) ** 2 + (P[i].y - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return { i: best, d: Math.sqrt(bd) };
}
