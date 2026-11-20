// Erzeugt Icon (icon.svg) und Cover (cover.svg) für die SDK-Spiele im einheitlichen Low-Poly-/Flat-Stil.
// Alle Bilder sind selbst gezeichnet (Vektor, keine externen Grafiken). Aufruf: node scripts/make-game-art.mjs
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hexPts = (cx, cy, r) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 6 + (i * Math.PI) / 3; return `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`; }).join(' ');
const hex = (cx, cy, r, fill) => `<polygon points="${hexPts(cx, cy, r)}" fill="${fill}"/>`;
const icon = (bg, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${hex(32, 32, 30, '#2c3848')}${hex(32, 32, 26, bg)}${inner}</svg>\n`;
const cover = (bg, inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 500" preserveAspectRatio="xMidYMid slice"><rect width="1200" height="500" fill="${bg}"/>${inner}</svg>\n`;
const checker = (c1, c2, size = 50) => { let s = ''; for (let y = 0; y < 500; y += size) for (let x = 0; x < 1200; x += size) s += `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${(x / size + y / size) % 2 ? c1 : c2}"/>`; return s; };
const stars = (n, seed = 3) => { let s = '', v = seed; for (let i = 0; i < n; i++) { v = (v * 16807) % 2147483647; const x = v % 1200; v = (v * 16807) % 2147483647; const y = v % 500; s += `<rect x="${x}" y="${y}" width="${1 + (i % 3)}" height="${1 + (i % 3)}" fill="${i % 7 ? '#dfe8ff' : '#ffd25a'}"/>`; } return s; };
const snake = (pts, color, light, r) => pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${i % 2 ? color : light}"/>`).reverse().join('');
const apple = (x, y, r) => `<polygon points="${Array.from({ length: 8 }, (_, i) => `${x + Math.cos(i * Math.PI / 4) * r},${y + Math.sin(i * Math.PI / 4) * r}`).join(' ')}" fill="#d8433a"/><polygon points="${x},${y - r} ${x - r},${y} ${x - r * 0.7},${y + r * 0.7} ${x},${y}" fill="#f0625a"/><rect x="${x - 2}" y="${y - r - 8}" width="4" height="10" fill="#6b4226"/><polygon points="${x + 2},${y - r - 4} ${x + 16},${y - r - 12} ${x + 10},${y - r}" fill="#4cc26a"/>`;

const ART = {
  'snake-oi': {
    icon: icon('#6ab94e', `<rect x="14" y="14" width="12" height="12" fill="#79c35a"/><rect x="38" y="38" width="12" height="12" fill="#79c35a"/>${snake([[40, 24], [34, 30], [28, 36], [22, 42], [18, 48]], '#b467d6', '#c98be3', 6)}<circle cx="42" cy="22" r="2.5" fill="#fff"/><circle cx="43" cy="22" r="1.2" fill="#1b222c"/>${apple(46, 44, 5)}`),
    cover: cover('#6ab94e', checker('#79c35a', '#6ab94e') + snake(Array.from({ length: 22 }, (_, i) => [180 + i * 32, 260 + Math.sin(i * 0.5) * 70]), '#b467d6', '#c98be3', 30) + `<circle cx="180" cy="250" r="9" fill="#fff"/><circle cx="182" cy="250" r="4" fill="#1b222c"/><circle cx="180" cy="280" r="9" fill="#fff"/><circle cx="182" cy="280" r="4" fill="#1b222c"/>` + snake(Array.from({ length: 12 }, (_, i) => [1050 - i * 26, 100 + i * 14]), '#5b8def', '#7fa6f5', 22) + apple(110, 230, 26) + apple(900, 380, 22) + apple(620, 110, 20) + [[300, 80, '#ffd84d'], [500, 420, '#ff6b6b'], [760, 230, '#74c0fc'], [980, 300, '#ffd84d'], [420, 150, '#c77dff']].map(([x, y, c]) => hex(x, y, 9, c)).join('')),
  },
  parkour: {
    icon: icon('#4f9fe0', `<rect x="10" y="44" width="16" height="6" fill="#6abf4b"/><rect x="10" y="50" width="16" height="4" fill="#8a6a4a"/><rect x="36" y="30" width="16" height="6" fill="#6abf4b"/><rect x="36" y="36" width="16" height="4" fill="#8a6a4a"/><rect x="25" y="20" width="8" height="10" fill="#f08c32"/><circle cx="29" cy="16" r="4" fill="#f0c49a"/><rect x="22" y="30" width="4" height="8" fill="#3b4656" transform="rotate(-30 24 30)"/><rect x="31" y="30" width="4" height="8" fill="#3b4656" transform="rotate(30 33 30)"/><rect x="47" y="14" width="2" height="16" fill="#dfe5ec"/><polygon points="49,14 57,17 49,20" fill="#e2534a"/>`),
    cover: cover('#86c3ea', `<rect width="1200" height="250" fill="#5aa9e6"/><polygon points="0,500 0,380 300,420 600,360 900,420 1200,370 1200,500" fill="#4e9a3a"/>` +
      [[80, 330, 200], [360, 270, 150], [580, 300, 110], [760, 220, 130], [990, 160, 180]].map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="24" fill="#6abf4b"/><rect x="${x}" y="${y + 24}" width="${w}" height="40" fill="#8a6a4a"/>`).join('') +
      `<rect x="640" y="140" width="130" height="18" fill="#f08c32"/><polygon points="460,200 480,200 470,180" fill="#fff"/>` +
      `<g transform="translate(520 170) rotate(-12)"><rect x="-14" y="-30" width="28" height="36" fill="#f08c32"/><circle cx="0" cy="-44" r="13" fill="#f0c49a"/><rect x="-16" y="-58" width="32" height="8" fill="#f08c32"/><rect x="-14" y="6" width="10" height="30" fill="#3b4656" transform="rotate(-40 -9 6)"/><rect x="4" y="6" width="10" height="30" fill="#3b4656" transform="rotate(30 9 6)"/><rect x="-30" y="-28" width="8" height="30" fill="#f08c32" transform="rotate(-120 -26 -28)"/><rect x="22" y="-28" width="8" height="30" fill="#f08c32" transform="rotate(120 26 -28)"/></g>` +
      `<rect x="1060" y="60" width="6" height="100" fill="#dfe5ec"/><polygon points="1066,60 1120,80 1066,100" fill="#e2534a"/><ellipse cx="1100" cy="135" rx="46" ry="40" fill="none" stroke="#ffd84d" stroke-width="12"/>` +
      `<g fill="#fff"><polygon points="140,90 180,62 240,70 270,95 230,112 160,110"/><polygon points="800,60 840,40 900,46 930,70 880,84 820,82"/></g>`),
  },
  panzer: {
    icon: icon('#a9c862', `<rect x="12" y="12" width="10" height="10" fill="#9aa0a8"/><rect x="42" y="42" width="10" height="10" fill="#9aa0a8"/><g transform="rotate(-30 32 34)"><rect x="18" y="22" width="28" height="6" fill="#2b2f36"/><rect x="18" y="40" width="28" height="6" fill="#2b2f36"/><rect x="20" y="27" width="24" height="14" fill="#5b8def"/><rect x="32" y="31" width="20" height="5" fill="#2b2f36"/></g>${hex(32, 34, 7, '#7fa6f5')}<circle cx="52" cy="18" r="3" fill="#ffd25a"/>`),
    cover: cover('#a9c862', checker('#a3c35e', '#a9c862', 60) + [[200, 120, 180, 60], [200, 120, 60, 180], [820, 300, 180, 60], [940, 180, 60, 180], [520, 220, 160, 60]].map(([x, y, w, h]) => `<rect x="${x}" y="${y + 10}" width="${w}" height="${h}" fill="#5d6068"/><rect x="${x}" y="${y}" width="${w}" height="${h - 6}" fill="#9aa0a8"/>`).join('') +
      `<g transform="translate(400 330) rotate(-20)"><rect x="-60" y="-46" width="120" height="22" fill="#2b2f36"/><rect x="-60" y="24" width="120" height="22" fill="#2b2f36"/><rect x="-52" y="-30" width="104" height="60" fill="#e85934"/><rect x="0" y="-9" width="90" height="18" fill="#2b2f36"/></g>${hex(400, 330, 30, '#f07a5a')}` +
      `<g transform="translate(860 140) rotate(150)"><rect x="-50" y="-38" width="100" height="18" fill="#2b2f36"/><rect x="-50" y="20" width="100" height="18" fill="#2b2f36"/><rect x="-44" y="-24" width="88" height="48" fill="#5b8def"/><rect x="0" y="-7" width="75" height="14" fill="#2b2f36"/></g>${hex(860, 140, 24, '#7fa6f5')}` +
      `<circle cx="560" cy="300" r="12" fill="#ffd25a"/><circle cx="560" cy="300" r="22" fill="#ffb347" opacity=".35"/><circle cx="700" cy="200" r="10" fill="#ffd25a"/>`),
  },
  bomben: {
    icon: icon('#7fbf5a', `<rect x="12" y="12" width="12" height="12" fill="#9aa0a8"/><rect x="40" y="12" width="12" height="12" fill="#c99556"/><rect x="12" y="40" width="12" height="12" fill="#c99556"/><circle cx="34" cy="36" r="11" fill="#23272d"/><circle cx="30" cy="32" r="3" fill="#4a5260"/><rect x="40" y="20" width="3" height="8" fill="#a0703f" transform="rotate(35 41 24)"/>${hex(46, 19, 4, '#ffd25a')}`),
    cover: cover('#7fbf5a', checker('#74b450', '#7fbf5a', 70) + Array.from({ length: 30 }, (_, i) => { const x = (i * 210) % 1190, y = Math.floor(i / 6) * 100 + 10; return i % 3 === 0 ? `<rect x="${x}" y="${y + 6}" width="66" height="66" fill="#5d6068"/><rect x="${x}" y="${y}" width="66" height="60" fill="#9aa0a8"/>` : i % 3 === 1 ? `<rect x="${x + 70}" y="${y}" width="62" height="62" fill="#c99556" stroke="#8a5a2e" stroke-width="6"/>` : ''; }).join('') +
      `<rect x="480" y="230" width="260" height="70" fill="#ff8a2a"/><rect x="575" y="140" width="70" height="250" fill="#ff8a2a"/><rect x="500" y="245" width="220" height="40" fill="#ffd25a"/><rect x="590" y="160" width="40" height="210" fill="#ffd25a"/>` +
      `<circle cx="300" cy="380" r="46" fill="#23272d"/><circle cx="285" cy="365" r="12" fill="#4a5260"/><rect x="320" y="315" width="8" height="30" fill="#a0703f" transform="rotate(35 324 330)"/>${hex(340, 312, 12, '#ffd25a')}` +
      `<circle cx="900" cy="370" r="38" fill="#5b8def"/><circle cx="900" cy="368" r="24" fill="#f4e3c8"/><rect x="890" y="360" width="5" height="8" fill="#1b222c"/><rect x="904" y="360" width="5" height="8" fill="#1b222c"/>`),
  },
  pong: {
    icon: icon('#243041', `<rect x="18" y="50" width="28" height="5" fill="#6abf4b"/><rect x="18" y="9" width="28" height="5" fill="#5b8def"/><rect x="9" y="20" width="5" height="24" fill="#e85934"/><rect x="50" y="20" width="5" height="24" fill="#ffd25a"/>${hex(36, 30, 5, '#fff6d0')}`),
    cover: cover('#161c24', `<rect x="350" y="20" width="500" height="460" fill="#243041"/>${hex(600, 250, 60, 'rgba(240,140,50,.15)')}<rect x="520" y="455" width="160" height="16" fill="#6abf4b"/><rect x="460" y="29" width="160" height="16" fill="#5b8def"/><rect x="359" y="150" width="16" height="160" fill="#e85934"/><rect x="825" y="220" width="16" height="160" fill="#ffd25a"/>` +
      [0.15, 0.3, 0.45, 0.6].map((o, i) => hex(560 - i * 30, 300 + i * 22, 14, `rgba(255,210,90,${o})`)).join('') + hex(680, 230, 18, '#fff6d0') + hex(680, 230, 11, '#ffd25a')),
  },
  rennen: {
    icon: icon('#6ab94e', `<path d="M8 44 Q32 4 56 30" stroke="#fff" stroke-width="14" fill="none"/><path d="M8 44 Q32 4 56 30" stroke="#4a5260" stroke-width="10" fill="none"/><g transform="translate(32 26) rotate(-15)"><rect x="-9" y="-5" width="18" height="10" fill="#e85934"/><rect x="2" y="-3" width="4" height="6" fill="#9fd8ff"/></g>`),
    cover: cover('#6ab94e', checker('#79c35a', '#6ab94e', 100) + `<path d="M-50 420 C 250 420 300 120 600 140 S 1000 380 1250 260" stroke="#fff" stroke-width="150" fill="none"/><path d="M-50 420 C 250 420 300 120 600 140 S 1000 380 1250 260" stroke="#e2534a" stroke-width="150" stroke-dasharray="40 40" fill="none"/><path d="M-50 420 C 250 420 300 120 600 140 S 1000 380 1250 260" stroke="#4a5260" stroke-width="128" fill="none"/><path d="M-50 420 C 250 420 300 120 600 140 S 1000 380 1250 260" stroke="rgba(255,255,255,.4)" stroke-width="4" stroke-dasharray="30 30" fill="none"/>` +
      [[560, 120, -4, '#e85934'], [700, 190, 25, '#5b8def'], [430, 230, -55, '#ffd25a']].map(([x, y, a, c]) => `<g transform="translate(${x} ${y}) rotate(${a})"><rect x="-34" y="-24" width="16" height="8" fill="#1b222c"/><rect x="18" y="-24" width="16" height="8" fill="#1b222c"/><rect x="-34" y="16" width="16" height="8" fill="#1b222c"/><rect x="18" y="16" width="16" height="8" fill="#1b222c"/><polygon points="-40,-20 28,-20 44,-10 44,10 28,20 -40,20" fill="${c}"/><rect x="4" y="-14" width="16" height="28" fill="#9fd8ff"/><rect x="-32" y="-4" width="52" height="8" fill="#fff"/></g>`).join('') +
      [[120, 120], [240, 60], [980, 120], [1100, 420], [860, 460], [80, 260]].map(([x, y]) => hex(x, y, 34, '#3f8f3a') + hex(x - 6, y - 6, 20, '#4c9e3f')).join('')),
  },
  sterne: {
    icon: icon('#0d1018', `${stars(0)}<rect x="12" y="14" width="2" height="2" fill="#fff"/><rect x="48" y="44" width="2" height="2" fill="#ffd25a"/><polygon points="44,18 54,22 52,32 42,30 38,22" fill="#7a828c"/><g transform="rotate(-35 28 38)"><polygon points="40,38 20,30 24,38 20,46" fill="#7f8cff"/><polygon points="40,38 20,30 24,38" fill="#a6afff"/></g><rect x="38" y="26" width="4" height="4" fill="#ffd25a"/>`),
    cover: cover('#0d1018', stars(240) + `<polygon points="820,90 900,70 960,120 940,190 860,210 800,160" fill="#7a828c"/><polygon points="820,90 900,70 880,140" fill="#9aa1a9"/><polygon points="1020,300 1070,290 1090,340 1050,370 1010,345" fill="#7a828c"/><polygon points="660,360 700,350 720,390 680,410" fill="#7a828c"/>` +
      `<g transform="translate(360 280) rotate(-20)"><polygon points="80,0 -50,-56 -26,0 -50,56" fill="#5b6ad6"/><polygon points="80,0 -50,-56 -26,0" fill="#7f8cff"/><polygon points="40,0 0,-16 0,16" fill="#9fd8ff"/><polygon points="-40,-20 -90,0 -40,20" fill="#ffb347"/></g>` +
      `<g transform="translate(520 400) rotate(-35)"><polygon points="50,0 -30,-34 -16,0 -30,34" fill="#d64a3a"/><polygon points="50,0 -30,-34 -16,0" fill="#e85934"/></g>` +
      [[470, 240], [560, 210], [650, 180], [740, 150]].map(([x, y]) => `<rect x="${x}" y="${y}" width="12" height="6" fill="#ffd25a"/>`).join('') + hex(1000, 160, 34, '#3a2230') + hex(1000, 160, 26, '#e2534a') + `<circle cx="1010" cy="160" r="9" fill="#ffd25a"/>`),
  },
  vier: {
    icon: icon('#3d6fd6', Array.from({ length: 9 }, (_, i) => `<circle cx="${18 + (i % 3) * 14}" cy="${20 + Math.floor(i / 3) * 13}" r="5" fill="${[0, 4, 8].includes(i) ? '#e2534a' : [5, 7].includes(i) ? '#ffd25a' : '#1b222c'}"/>`).join('')),
    cover: cover('#1b222c', `<rect x="300" y="60" width="600" height="420" fill="#3d6fd6"/>` + Array.from({ length: 42 }, (_, i) => { const x = i % 7, y = Math.floor(i / 7); const cx = 343 + x * 86, cy = 100 + y * 68; const v = (y === 5 && x < 5) || (y === 4 && [1, 2, 4].includes(x)) || (y === 3 && x === 2) ? (x + y) % 2 ? '#e2534a' : '#ffd25a' : '#1b222c'; return `<circle cx="${cx}" cy="${cy}" r="28" fill="${v}"/>`; }).join('') + hex(687, 30, 30, '#e2534a') + `<path d="M 429 440 L 515 372 L 601 304" stroke="#fff" stroke-width="8"/>`),
  },
  kritzel: {
    icon: icon('#ef7aa8', `<rect x="14" y="16" width="36" height="30" fill="#fffdf6"/><path d="M20 38 Q26 22 32 34 T44 26" stroke="#5b8def" stroke-width="3" fill="none"/><circle cx="24" cy="24" r="3" fill="#ffd25a"/><g transform="rotate(40 44 42)"><rect x="40" y="30" width="6" height="20" fill="#f08c32"/><polygon points="40,50 46,50 43,56" fill="#f0c49a"/></g>`),
    cover: cover('#ef7aa8', `<rect x="160" y="50" width="640" height="400" fill="#fffdf6"/><rect x="160" y="450" width="640" height="10" fill="#c45a85"/>` +
      `<path d="M260 360 L340 220 L420 360 Z" fill="none" stroke="#e2534a" stroke-width="10" stroke-linejoin="round"/><rect x="420" y="260" width="200" height="100" fill="none" stroke="#5b8def" stroke-width="10"/><path d="M420 260 L520 180 L620 260" fill="none" stroke="#8a5a2e" stroke-width="10" stroke-linejoin="round"/><circle cx="690" cy="130" r="40" fill="none" stroke="#ffd25a" stroke-width="10"/><path d="M200 400 Q 400 380 760 410" stroke="#6abf4b" stroke-width="12" fill="none"/>` +
      `<g transform="translate(860 210) rotate(30)"><rect x="-14" y="-110" width="28" height="160" fill="#f08c32"/><rect x="-14" y="-130" width="28" height="22" fill="#ef7aa8"/><polygon points="-14,50 14,50 0,80" fill="#f0c49a"/><polygon points="-5,66 5,66 0,80" fill="#1b222c"/></g>` +
      `<rect x="930" y="300" width="230" height="44" rx="4" fill="#232c38"/><text x="945" y="330" font-family="Segoe UI" font-weight="800" font-size="22" fill="#6abf4b">✔ Haus!</text><rect x="930" y="240" width="230" height="44" rx="4" fill="#232c38"/><text x="945" y="270" font-family="Segoe UI" font-weight="700" font-size="20" fill="#fff">Burg?</text>`),
  },
};

for (const [id, art] of Object.entries(ART)) {
  writeFileSync(join(root, 'games', id, 'icon.svg'), art.icon);
  writeFileSync(join(root, 'games', id, 'cover.svg'), art.cover);
  console.log('Grafik erzeugt:', id);
}
