// Erzeugt das App-Icon (PNG + ICO) prozedural im Low-Poly-Stil – ganz ohne externe Grafik-Tools.
// Motiv: Lagerfeuer (Flammen-Dreiecke) auf dunklem Sechseck. Passt zu den SVG-Icons im Launcher.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'build');
mkdirSync(outDir, { recursive: true });

/** Rendert das Icon in einen RGBA-Puffer der Größe size×size (mit 4×4 Supersampling). */
function renderIcon(size) {
  const buf = Buffer.alloc(size * size * 4);
  const S = 4; // Supersampling
  // Polygone in Einheitskoordinaten (0..1), von hinten nach vorne gezeichnet.
  const hex = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    hex.push([0.5 + Math.cos(a) * 0.48, 0.5 + Math.sin(a) * 0.48]);
  }
  const hexInner = hex.map(([x, y]) => [0.5 + (x - 0.5) * 0.9, 0.5 + (y - 0.5) * 0.9]);
  const polys = [
    { pts: hex, col: [33, 41, 54] },
    { pts: hexInner, col: [44, 56, 72] },
    // Holzscheite
    { pts: [[0.25, 0.74], [0.72, 0.62], [0.75, 0.68], [0.28, 0.8]], col: [122, 78, 46] },
    { pts: [[0.28, 0.62], [0.75, 0.74], [0.72, 0.8], [0.25, 0.68]], col: [150, 98, 58] },
    // Flammen (Low-Poly-Dreiecke)
    { pts: [[0.3, 0.66], [0.5, 0.18], [0.7, 0.66]], col: [232, 89, 52] },
    { pts: [[0.36, 0.66], [0.44, 0.34], [0.56, 0.66]], col: [246, 140, 50] },
    { pts: [[0.46, 0.66], [0.6, 0.3], [0.66, 0.66]], col: [246, 140, 50] },
    { pts: [[0.42, 0.66], [0.52, 0.42], [0.6, 0.66]], col: [255, 210, 90] },
  ];
  const inside = (pts, x, y) => {
    let c = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const x = (px + (sx + 0.5) / S) / size, y = (py + (sy + 0.5) / S) / size;
        let col = null;
        for (const p of polys) if (inside(p.pts, x, y)) col = p.col;
        if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
      }
      const n = S * S, i = (py * size + px) * 4;
      const cov = a / n;
      buf[i] = cov ? Math.round((r / n) * 255 / cov) : 0;
      buf[i + 1] = cov ? Math.round((g / n) * 255 / cov) : 0;
      buf[i + 2] = cov ? Math.round((b / n) * 255 / cov) : 0;
      buf[i + 3] = Math.round(cov);
    }
  }
  return buf;
}

// --- Minimaler PNG-Encoder ---
const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bit, RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- ICO mit eingebetteten PNGs (von Windows Vista+ unterstützt) ---
const sizes = [16, 32, 48, 64, 128, 256];
const pngs = sizes.map((s) => encodePng(renderIcon(s), s));
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
writeFileSync(join(outDir, 'icon.ico'), Buffer.concat([header, ...entries, ...pngs]));
writeFileSync(join(outDir, 'icon.png'), pngs[pngs.length - 1]);
console.log('Icons erzeugt: build/icon.ico, build/icon.png');
