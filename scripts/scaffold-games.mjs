// Legt für die SDK-basierten 2D-Spiele Manifest (game.json) und client/index.html an.
// Einmal ausführen nach dem Hinzufügen eines Spiels: node scripts/scaffold-games.mjs
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = [
  { id: 'panzer', name: 'Panzerduell', port: 27023, max: 12, accent: '#9aa0a8', bots: true, modes: ['singleplayer', 'multiplayer', 'party'],
    tagline: 'Abprallende Geschosse, enge Gassen', description: 'Top-Down-Panzerschlacht für bis zu 12 Spieler: Fahre mit WASD, ziele mit der Maus und lass deine Geschosse um die Ecke abprallen. Sammle Schild, Dreifachschuss und Turbo-Ketten ein.' },
  { id: 'bomben', name: 'Bombenlabyrinth', port: 27024, max: 8, accent: '#e2534a', bots: true, modes: ['singleplayer', 'multiplayer', 'party'],
    tagline: 'Sprengen, ausweichen, überleben', description: 'Lege Bomben, sprenge Kisten frei und sammle mehr Bomben, größere Explosionen und Tempo. Kettenreaktionen inklusive – wer als Letzter steht, gewinnt die Runde.' },
  { id: 'pong', name: 'Viereck-Pong', port: 27025, max: 8, accent: '#ffd25a', bots: true, modes: ['singleplayer', 'multiplayer', 'party'],
    tagline: 'Pong für vier – auf jeder Seite einer', description: 'Vier Spieler, vier Seiten, ein (oder zwei) Bälle. Verteidige deine Seite, wer alle 5 Leben verliert, wird zur Wand. Deine Seite ist immer unten.' },
  { id: 'rennen', name: 'Turbo-Rennen', port: 27026, max: 8, accent: '#e85934', bots: true, modes: ['singleplayer', 'multiplayer', 'party'],
    tagline: 'Drei Runden, Vollgas, Driften', description: 'Top-Down-Rennen über eine kurvige Strecke durch die Blumenwiese. Driften in den Kurven, Boost-Felder und Rempeln erlaubt – wer zuerst drei Runden schafft, gewinnt.' },
  { id: 'sterne', name: 'Sternenjäger', port: 27027, max: 8, accent: '#7f8cff', bots: true, modes: ['singleplayer', 'multiplayer', 'party'],
    tagline: 'Gemeinsam gegen Asteroiden und Drohnen', description: 'Koop-Weltraum-Shooter: Steuert eure Raumschiffe mit WASD, zielt mit der Maus und überlebt gemeinsam immer stärkere Wellen aus Asteroiden und Drohnen.' },
  { id: 'vier', name: 'Vier in Reihe', port: 27028, max: 8, accent: '#5b8def', bots: true, modes: ['singleplayer', 'multiplayer', 'party'], turnBased: true,
    tagline: 'Der Klassiker – gegen Freunde oder den Computer', description: 'Bring vier Steine deiner Farbe in eine Reihe – waagerecht, senkrecht oder diagonal. Spiel gegen einen Freund oder gegen den Computer; weitere Spieler schauen zu und sind danach dran.' },
  { id: 'kritzel', name: 'Kritzel & Raten', port: 27029, max: 12, accent: '#ef7aa8', bots: false, modes: ['multiplayer', 'party'], turnBased: true,
    tagline: 'Einer malt, alle raten', description: 'Partyspiel ab 2 Spielern: Reihum malt einer einen Begriff, alle anderen raten im Chat. Je schneller du richtig rätst, desto mehr Punkte – auch der Maler wird belohnt.' },
];

for (const g of GAMES) {
  const dir = join(root, 'games', g.id);
  mkdirSync(join(dir, 'client'), { recursive: true });
  mkdirSync(join(dir, 'server'), { recursive: true });
  const manifest = {
    id: g.id, name: g.name, version: '1.0.0', tagline: g.tagline, description: g.description,
    client: 'client/index.html', server: 'server/server.mjs', icon: 'icon.svg', cover: 'cover.svg', accent: g.accent,
    modes: g.modes, maxPlayers: g.max, defaultPort: g.port, supportsBots: g.bots, ...(g.turnBased ? { turnBased: true } : {}),
  };
  writeFileSync(join(dir, 'game.json'), JSON.stringify(manifest, null, 2) + '\n');
  const html = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self' app:; script-src 'self' app:; style-src 'self' 'unsafe-inline' app:; img-src 'self' app: data: blob:; connect-src ws: wss:" />
  <title>${g.name}</title>
  <link rel="stylesheet" href="app://sdk/ui.css" />
</head>
<body>
  <canvas id="game"></canvas>
  <script type="module" src="game.js"></script>
</body>
</html>
`;
  if (!existsSync(join(dir, 'client', 'index.html'))) writeFileSync(join(dir, 'client', 'index.html'), html);
  console.log('angelegt:', g.id);
}
