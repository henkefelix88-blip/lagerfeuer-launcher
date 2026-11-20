/**
 * Kritzel & Raten – Host-Server (Partyspiel ab 2 Spielern).
 * Reihum malt einer einen Begriff (Auswahl aus 3), die anderen raten im Chat.
 * Richtige Antworten werden abgefangen und nicht angezeigt; je schneller, desto mehr Punkte.
 */
const CHOOSE_TIME = 12, DRAW_TIME = 80, REVEAL_TIME = 5;
const WORDS = ('Apfel Banane Haus Baum Blume Sonne Mond Stern Wolke Regen Auto Fahrrad Zug Flugzeug Schiff Katze Hund Maus Pferd Kuh Schwein ' +
  'Fisch Vogel Ente Schnecke Spinne Biene Schmetterling Elefant Giraffe Löwe Pinguin Hase Igel Frosch Drache Einhorn Roboter Rakete Ufo ' +
  'Pizza Burger Eis Kuchen Torte Brezel Wurst Käse Ei Karotte Gurke Erdbeere Kirsche Ananas Zitrone Brille Hut Schuh Socke Handschuh ' +
  'Regenschirm Uhr Schlüssel Lampe Kerze Bett Stuhl Tisch Sofa Fenster Tür Treppe Leiter Brücke Burg Zelt Lagerfeuer Berg Vulkan Insel ' +
  'Strand Welle Schneemann Weihnachtsbaum Geschenk Ballon Gitarre Trommel Klavier Mikrofon Kamera Handy Computer Tastatur Buch Brief ' +
  'Krone Schwert Schild Pfeil Bogen Hammer Säge Schere Pinsel Zahnbürste Seife Dusche Badewanne Fußball Tennis Pokal Medaille Ampel ' +
  'Regenbogen Blitz Tornado Kaktus Pilz Palme Anker Leuchtturm Pirat Geist Hexe Zauberer Ritter Prinzessin Clown Astronaut Feuerwehr').split(' ');

const norm = (s) => s.toLowerCase().trim().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]/g, '');
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export async function createServer(opts) {
  return opts.sdk.createRoom(opts, new DrawGame(), { tickRate: 5, version: 1, maxPlayers: 12 });
}

class DrawGame {
  constructor() { this.order = []; this.phase = 'wait'; this.strokes = []; this.guessed = new Set(); this.turn = -1; this.statePerPlayer = true; }
  welcome() { return { strokes: this.strokes }; }
  onJoin(p) { if (!p.bot) this.order.push(p); }
  onLeave(p) {
    this.order = this.order.filter((q) => q !== p);
    if (p === this.drawer && (this.phase === 'draw' || this.phase === 'choose')) this.reveal('Der Maler ist gegangen.');
  }

  nextTurn() {
    if (this.order.length < 2) { this.phase = 'wait'; this.drawer = null; return; }
    this.turn = (this.turn + 1) % this.order.length;
    this.drawer = this.order[this.turn];
    const pool = WORDS.slice().sort(() => Math.random() - 0.5);
    this.options = pool.slice(0, 3);
    this.phase = 'choose';
    this.ends = this.room.time + CHOOSE_TIME;
    this.strokes = []; this.guessed = new Set(); this.word = null; this.hints = new Set();
    this.room.broadcast({ t: 'clear' });
    this.room.broadcast({ t: 'turn', drawer: this.drawer.id });
  }
  choose(i) {
    this.word = this.options[Math.max(0, Math.min(2, i | 0))];
    this.phase = 'draw';
    this.ends = this.room.time + DRAW_TIME;
    this.room.broadcast({ t: 'go' });
  }
  reveal(reason) {
    this.phase = 'reveal';
    this.ends = this.room.time + REVEAL_TIME;
    this.room.broadcast({ t: 'reveal', word: this.word, reason: reason || null });
    this.room.sendScores();
  }

  onMessage(p, m) {
    if (p !== this.drawer) return;
    if (m.t === 'choose' && this.phase === 'choose') this.choose(m.i);
    else if (m.t === 'stroke' && this.phase === 'draw' && Array.isArray(m.pts) && m.pts.length <= 200 && m.pts.every(Number.isFinite)) {
      const s = { c: String(m.c).slice(0, 9), w: Math.max(2, Math.min(60, Number(m.w) || 6)), pts: m.pts.map((v) => Math.round(v)), id: m.id | 0 };
      this.strokes.push(s);
      if (this.strokes.length > 4000) this.strokes.shift();
      this.room.broadcast({ t: 'stroke', ...s }, p.ws ? p : undefined);
    } else if (m.t === 'clear' && this.phase === 'draw') { this.strokes = []; this.room.broadcast({ t: 'clear' }); }
  }

  onChat(p, text) {
    if (this.phase !== 'draw' || !this.word) return false;
    const guess = norm(text), word = norm(this.word);
    const knows = p === this.drawer || this.guessed.has(p);
    if (knows) return guess.includes(word); // wer das Wort kennt, darf es nicht verraten
    if (guess === word) {
      this.guessed.add(p);
      const left = Math.max(0, this.ends - this.room.time) / DRAW_TIME;
      p.score += Math.round(50 + 100 * left);
      this.drawer.score += 25;
      this.room.broadcast({ t: 'guessed', id: p.id });
      this.room.sendScores();
      if (this.order.every((q) => q === this.drawer || this.guessed.has(q))) this.reveal('Alle haben es erraten!');
      return true;
    }
    if (word.length > 3 && lev(guess, word) === 1) { this.room.send(p, { t: 'close' }); return true; }
    return false;
  }

  tick(dt, time) {
    if (this.phase === 'wait') { if (this.order.length >= 2) this.nextTurn(); return; }
    if (this.phase === 'choose' && time >= this.ends) this.choose(Math.floor(Math.random() * 3));
    else if (this.phase === 'draw') {
      const frac = 1 - (this.ends - time) / DRAW_TIME;
      // Tipps: nach 50 % und 75 % der Zeit je einen Buchstaben aufdecken
      for (const [f, n] of [[0.5, 1], [0.75, 2]]) {
        if (frac >= f && this.hints.size < n) {
          const free = [...this.word].map((ch, i) => i).filter((i) => this.word[i] !== ' ' && !this.hints.has(i));
          if (free.length > 1) this.hints.add(free[Math.floor(Math.random() * free.length)]);
        }
      }
      if (time >= this.ends) this.reveal('Die Zeit ist um.');
    } else if (this.phase === 'reveal' && time >= this.ends) this.nextTurn();
  }

  state(p) {
    const knows = p === this.drawer || this.guessed.has(p) || this.phase === 'reveal';
    const pattern = this.word ? [...this.word].map((ch, i) => (knows || this.hints.has(i) || ch === ' ' ? ch : '_')).join('') : '';
    return {
      ph: this.phase, drawer: this.drawer?.id ?? 0, left: Math.max(0, Math.ceil((this.ends ?? 0) - this.room.time)),
      word: pattern, len: this.word?.length ?? 0, guessed: [...this.guessed].map((q) => q.id),
      options: this.phase === 'choose' && p === this.drawer ? this.options : null,
      order: this.order.map((q) => q.id),
    };
  }
}
