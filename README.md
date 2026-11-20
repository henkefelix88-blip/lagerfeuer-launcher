# Lagerfeuer Launcher – 10 Spiele für dich und deine Freunde

Ein Game-Launcher für Windows, mit dem du mit deinen Freunden zusammen spielst – **ohne externen Server**.
Mit dabei sind **10 Spiele**, allen voran **Blumenfeld Arena**, ein Low-Poly-Online-Ego-Shooter auf einer großen Blumenwiese.
Weitere Spiele können jederzeit einfach als Ordner ergänzt werden, ohne den Launcher umzubauen.

---

## Inhalt

0. [Die 10 Spiele](#die-10-spiele)
1. [Features](#features)
2. [Technik & Begründung](#technik--begründung)
3. [Installation](#installation)
4. [Spielen: Singleplayer, Hosten & Beitreten](#spielen-singleplayer-hosten--beitreten)
5. [Steuerung](#steuerung)
6. [Portfreigabe, Firewall, Tailscale/ZeroTier](#portfreigabe-firewall-tailscalezerotier)
7. [Neue Spiele hinzufügen](#neue-spiele-hinzufügen)
8. [Projektstruktur](#projektstruktur)
9. [Entwickeln, Testen, Bauen](#entwickeln-testen-bauen)
10. [Abhängigkeiten & Versionen](#abhängigkeiten--versionen)
11. [Bekannte Grenzen](#bekannte-grenzen)

---

## Die 10 Spiele

Alle Spiele laufen im Singleplayer (gegen Bots), im Multiplayer (hosten / per IP verbinden) und über die Party.
Einzige Ausnahme ist Kritzel & Raten: Das braucht mindestens 2 echte Spieler.
Ein Pausenmenü (Esc), Chat (T), Scoreboard (Tab), die Lautstärke und das Ausgabegerät aus den Launcher-Einstellungen gibt es in jedem Spiel.

| # | Spiel | Worum geht's | Steuerung | Spieler |
|---|---|---|---|---|
| 1 | **Blumenfeld Arena** | 3D-Ego-Shooter: 7 Waffen, Gebäude, Item-Boxen, Schleichen | siehe [Steuerung](#steuerung) | bis 16 |
| 2 | **Snake Oi** | Klassisches Snake (Äpfel fressen → länger werden) in einer Online-Arena: Wer mit dem Kopf in eine andere Schlange fährt, zerfällt zu Futter | Maus **oder** Pfeiltasten/WASD (klassisch), Leertaste/LMB = Boost | bis 16 |
| 3 | **Parkour** | 3D-Jump-&-Run-Rennen über 3 Strecken (Blumenwiese, Wolkenpfad, Lavaturm): bewegliche und verschwindende Plattformen, Sprungpads, Checkpoints | WASD, Maus = Kamera, Leertaste = Sprung (Doppelsprung), Shift/Strg = Sprint, R = Checkpoint | bis 16 |
| 4 | **Panzerduell** | Top-Down-Panzerschlacht, Geschosse prallen 2× ab, Power-Ups (Schild, Dreifachschuss, Turbo) | W/S fahren, A/D drehen, Maus zielen, LMB/Leertaste feuern | bis 12 |
| 5 | **Bombenlabyrinth** | Bomben legen, Kisten sprengen, Kettenreaktionen, Power-Ups; der letzte Überlebende gewinnt die Runde | Pfeile/WASD, Leertaste/E = Bombe | bis 8 |
| 6 | **Viereck-Pong** | Pong zu viert, jeder verteidigt eine Seite mit 5 Leben, ab 3 Spielern zwei Bälle; deine Seite ist immer unten | A/D oder ←/→ | 4 am Feld (+ Warteschlange) |
| 7 | **Turbo-Rennen** | Top-Down-Rennen, 3 Runden, Driften, Boost-Felder, Rempeln | W/↑ Gas, S/↓ Bremse, A/D lenken, Shift/Leertaste driften | bis 8 |
| 8 | **Sternenjäger** | Koop-Weltraum-Shooter gegen Wellen aus Asteroiden und Drohnen, gemeinsame Leben | WASD fliegen, Maus zielen, LMB/Leertaste feuern | bis 8 |
| 9 | **Vier in Reihe** | Der Klassiker gegen Freunde oder einen starken Computer-Gegner (Minimax-Suche); der Gewinner bleibt sitzen | Klick auf Spalte oder ←/→ + Leertaste | 2 am Brett (+ Zuschauer) |
| 10 | **Kritzel & Raten** | Einer malt, alle raten im Feld rechts; schnelle Antworten geben mehr Punkte, die Lösung bleibt geheim | Maus = malen, Enter = raten | 2–12 |

---

## Features

### Launcher
- **Spielebibliothek** mit Cover, Beschreibung und den Modi **Singleplayer | Multiplayer | Party beitreten**.
- **Modular:** Spiele werden über eine `game.json` erkannt. Neue Spiele landen ohne Code-Änderung im Launcher.
- **Globale Einstellungen** (gelten für alle Spiele, werden in `%APPDATA%\Lagerfeuer Launcher\settings.json` gespeichert und beim Start geladen):
  - Master-, Musik- und Effekt-Lautstärke (getrennte Regler)
  - **Audio-Ausgabegerät** (Liste aller Windows-Ausgabegeräte)
  - Grafik: Auflösung, Fenster / randloses Fenster / Vollbild, FPS-Limit (30–240 oder unbegrenzt), Qualität (Niedrig–Ultra)
  - Steuerung: Maus-Empfindlichkeit, Sichtfeld, Maus-Y invertieren, **frei belegbare Tasten** (inkl. Maustasten)
  - Spielername

### Party-System (für alle Spiele)
- Ein Spieler erstellt eine Party und bekommt einen **Party-Code** (z. B. `R2MB-5GVD-BW20`).
- Der Code enthält die Adresse des Hosts samt Prüfsumme. Deshalb wird kein Vermittlungsserver gebraucht.
- Freunde geben den Code (und das Passwort) bei **„Party beitreten“** ein und landen in der Lobby.
- Die Lobby zeigt alle Mitglieder mit Name, **Bereit-Status** und Leistungswert.
- **Leistungscheck:** Jeder PC misst automatisch ca. 1 Sekunde lang CPU (alle Kerne), GPU-Typ und RAM.
  Der **stärkste PC wird als Spiel-Host vorgeschlagen**. Alternativ wählt der Party-Host den Spiel-Host **manuell**.
- Startet der Host das Spiel, öffnet der gewählte PC den Spielserver und **alle Mitglieder werden automatisch ins Spiel geholt**.
  Nach dem Spiel sind alle wieder in der Lobby.

### Netzwerk
- **Listen-Server:** Ein Spieler-PC hostet, es gibt keinen externen Server.
- Verbindung per **IP-Adresse + Port**, abgesichert durch ein **Passwort** (Vergleich in konstanter Zeit).
- Der **Host ist autoritativ** für Treffer, Schaden, Tode, Respawns, Munition sowie Waffen- und Power-Up-Spawns.
- Die eigene Bewegung wird lokal vorhergesagt (flüssig) und vom Host auf Plausibilität geprüft (Geschwindigkeits-Check).
  Fremde Spieler werden mit 100 ms Puffer interpoliert.

### Blumenfeld Arena (Ego-Shooter)
- **Große, offene Map** (360 × 360 m): grüne, facettierte Wiese mit **vereinzelt verteilten Blumen**, Grasbüscheln,
  Felsen, Bäumen und Kisten als Deckung, Zaun, Hügel-Kulisse und ziehende Wolken.
- **Echte, begehbare Gebäude** (25 Stück): Dorf mit Häusern um den Dorfplatz, **Stadthäuser mit Treppe und Dachterrasse**,
  große **Scheunen** mit Toren und Heuballen, **Wachtürme** mit Außentreppe und Plattform, **Ruinen**.
  Fenster und Türen sind echte Öffnungen: Man kann durchlaufen und hindurchschießen. Treppen lassen sich hochlaufen.
- **Boost:** Solange **Strg** gedrückt ist, läuft man schneller. Eine **Ausdauer-Anzeige** leert sich dabei und lädt sich wieder auf.
- **Schleichen:** Solange **Shift** gedrückt ist, geht man geduckt und langsam: Schritte sind für andere nicht zu hören,
  man bietet eine kleinere Trefferfläche, und die Waffe streut weniger. Andere sehen deine Figur geduckt.
- **7 Waffen** (Slots 1–7): **Messer** (Startwaffe, von hinten doppelter Schaden), **Pistole** (Startwaffe), **MP**,
  **Sturmgewehr** (mit Rotpunkt), **Schrotflinte**, **Scharfschützengewehr** (Zielfernrohr, Kopfschuss = K.O.) und
  **Raketenwerfer** (Flächenschaden + Rückstoß, Raketensprünge möglich). Scharfschützengewehre liegen auf Türmen und Dachterrassen.
- **Zielen mit Rechtsklick:** Visier in der Bildmitte, Zoom, weniger Streuung. Beim Scharfschützengewehr erscheint ein Zielfernrohr mit 4,5-fachem Zoom.
- **Item-Boxen wie im Fun-Racer:** Regenbogen-Boxen stehen in Dreierreihen über die Map verteilt. Läufst du durch, rollt ein
  **Item-Roulette** und du bekommst ein Item, das du mit **Q** einsetzt. Wer hinten liegt, bekommt häufiger starke Items.
  | Item | Wirkung |
  |---|---|
  | Turbo-Pilz | 3 s extrem schnell |
  | Superstern | 8 s unverwundbar + schneller, Berührung schaltet Gegner aus |
  | Blitz | alle Gegner bekommen Schaden und sind 6 s geschrumpft (langsamer, kleiner) |
  | Abprall-Kugel | rollt geradeaus, prallt von Wänden ab, 60 Schaden |
  | Such-Kugel | verfolgt den nächsten Gegner, 70 Schaden |
  | Bananenschale | Falle: Wer drauftritt, rutscht aus (Schaden + kurz bewegungsunfähig) |
  | Tintenklecks | verschmiert allen Gegnern 5 s die Sicht |
  | Herz / Schild / Feuerkraft | +60 LP mit Regeneration / 15 s halber Schaden / 15 s +50 % Schaden |
- **Chat:** Mit **T** öffnest du den Chat, mit **Enter** sendest du, mit **Esc** brichst du ab.
- **Geheime Cheat-Codes** (im Chat eintippen; die Nachricht erscheint **nicht** im Chat, nur du siehst eine Bestätigung;
  nochmal eintippen schaltet den Cheat aus):
  | Code | Wirkung |
  |---|---|
  | `##########` (10×#) | dreifaches Tempo, **Fliegen** (Leertaste hoch, Shift runter), unendlich Munition |
  | `!!!!!!!!!!` (10×!) | **Triggerbot**: schießt automatisch, sobald das Fadenkreuz auf einem Gegner liegt |
  | `$$$$$$$$$$` (10×$) | **10-faches Leben** (1000 LP) |
- **HUD:** Leben, Ausdauer, Munition, Waffen-Slots, Item-Slot mit Roulette, aktive Buffs/Debuffs mit Restzeit, dynamisches
  Fadenkreuz, Hitmarker, Schadensrichtung, **Kill-Feed**, Chat, **Scoreboard (Tab)**, Ping/FPS.
- **Respawn** nach 3 s am Spawnpunkt mit dem größten Abstand zu Gegnern, plus kurzer Spawnschutz.
- **Animationen (Ego-Ansicht mit Händen):** Laufen, Atmen, Sprinten, Ziehen beim Waffenwechsel, Zielen,
  **Schießen** (Rückstoß, Mündungsfeuer, Schlitten/Ladehebel, **ausgeworfene Hülsen**),
  **Sniper repetiert** nach jedem Schuss, **Schrotflinte pumpt**, **Nachladen** je Waffe (Magazin fällt heraus, linke Hand holt
  ein neues, Durchladen / Patrone für Patrone + Pumpen / neue Rakete vorne einsetzen), **Messerhiebe** abwechselnd links/rechts.
  Explosionen mit Feuerball, Rauch, Lichtblitz und Kamera-Wackeln. Raketen ziehen eine Rauchspur.
- **Bots** für Singleplayer (Leicht/Normal/Schwer). Optional lassen sie sich auch beim Hosten zuschalten.
- Sounds und Musik werden **prozedural erzeugt**, Lautstärke/Ausgabegerät aus den Launcher-Einstellungen.

### Grafikstil
Alle Grafiken sind selbst erzeugt und folgen einem einheitlichen **Low-Poly-/Flat-Stil** mit gemeinsamer Farbpalette:
3D-Modelle aus Grundkörpern mit flacher Schattierung, SVG-Icons und Cover, ein prozedural gerendertes App-Icon (Lagerfeuer).

---

## Technik & Begründung

**Gewählt: Electron + Three.js (JavaScript/Node.js)**

| Kriterium | Warum |
|---|---|
| Launcher-UI | Ein Launcher ist im Kern eine Desktop-App mit viel UI. HTML/CSS ist dafür ideal und schnell anpassbar. |
| Netzwerk ohne externen Server | Node.js (im Launcher eingebaut) kann direkt WebSocket-Server öffnen. Party- und Spielserver laufen im Launcher des Hosts. |
| Modularität | Spiele sind einfache Ordner (HTML/JS + optionaler Server). Der Launcher lädt sie dynamisch, ganz ohne Neukompilieren. |
| Low-Poly-3D | Three.js reicht für den Stil völlig aus und läuft mit WebGL auf jeder Grafikkarte. |
| Build | Eine einzige Toolchain (Node/npm) erzeugt die `.exe`. Kein Editor nötig, alles per Skript reproduzierbar. |

*Godot 4 oder Unity* wären für große 3D-Spiele stärker. Der Launcher müsste dann aber separat gebaut werden, und
neue Spiele ließen sich nicht so einfach als Ordner einhängen.

---

## Installation

1. ZIP entpacken.
2. Ordner **`Lagerfeuer Launcher`** an einen beliebigen Ort kopieren (z. B. `C:\Spiele\`).
3. **`Lagerfeuer Launcher.exe`** starten.
   - Windows SmartScreen zeigt beim ersten Start evtl. „Der Computer wurde durch Windows geschützt“, weil die `.exe` nicht signiert ist.
     Dann auf **„Weitere Informationen“ → „Trotzdem ausführen“** klicken.
4. Beim ersten Hosten fragt die **Windows-Firewall** nach Zugriff. Dann **„Private Netzwerke“ zulassen** (siehe unten).
5. In den **Einstellungen** den Spielernamen setzen.

Es muss nichts weiter installiert werden: Node.js, Chromium und alle Bibliotheken sind in der `.exe` enthalten.

---

## Spielen: Singleplayer, Hosten & Beitreten

### Singleplayer (gegen Bots)
1. Bibliothek → **Blumenfeld Arena** → **Singleplayer**.
2. Anzahl Bots und Schwierigkeit wählen → **Starten**.
3. Ins Fenster klicken, um die Maus zu fangen. **Esc** öffnet das Menü.

### Party (empfohlen für Freunde)

**Host (einer aus der Gruppe):**
1. Reiter **Party** → „Party erstellen“.
2. Bei **„Erreichbar über“** die passende Adresse wählen:
   - **LAN** – alle im selben Netzwerk / WLAN
   - **Tailscale / ZeroTier** – alle im selben virtuellen Netz (siehe unten, keine Portfreigabe nötig)
   - **Andere Adresse** – deine **öffentliche IP** (übers Internet; Portfreigabe nötig). Die öffentliche IP findest du z. B. auf *wieistmeineip.de*.
3. Optional Port ändern (Standard **27016**) und ein **Passwort** festlegen.
4. **Party erstellen**: Du bekommst den **Party-Code**. Kopieren und zusammen mit dem Passwort an die Freunde schicken.

**Freunde:**
1. Bibliothek → **Party beitreten** (oder Reiter Party → „Party beitreten“).
2. **Code** und **Passwort** eingeben → **Beitreten**. Statt des Codes geht auch `IP:Port`.
3. In der Lobby auf **Bereit** klicken.

**Spiel starten (Host):**
1. Spiel auswählen (aktuell Blumenfeld Arena).
2. **Spiel-Host** wählen: *„Automatisch: stärkster PC“* (per Leistungscheck) oder eine Person manuell.
3. **Spiel starten**. Der Spiel-Host startet automatisch den Server (Port **27015**), alle werden automatisch verbunden.
4. Nach dem Spiel (Fenster schließen oder „Zurück zum Launcher“) seid ihr wieder in der Lobby.

> Hostet *nicht* der Party-Host das Spiel, muss der gewählte Spiel-Host für alle erreichbar sein:
> gleiches LAN/VPN **oder** Portfreigabe für TCP 27015 bei *ihm*.

### Multiplayer direkt (ohne Party)
- **Hosten:** Multiplayer → Tab „Spiel hosten“ → Port (Standard 27015), Passwort und optional Bots → **Los geht's**.
  Deine IP und das Passwort an die Freunde geben.
- **Beitreten:** Multiplayer → Tab „Per IP verbinden“ → IP, Port, Passwort → **Los geht's**.

---

## Steuerung

Alle Tasten sind unter **Einstellungen → Tastenbelegung** änderbar.

| Aktion | Standard |
|---|---|
| Bewegen | W A S D |
| **Boost (schneller laufen)** | **Strg links (halten)** |
| Springen | Leertaste |
| Schießen / Messerhieb | Linke Maustaste |
| **Zielen / Zoom (Zielfernrohr)** | **Rechte Maustaste (halten)** |
| Nachladen | R |
| Waffen 1–7 (Messer, Pistole, MP, Sturmgewehr, Schrotflinte, Sniper, Raketenwerfer) | 1–7 oder Mausrad |
| **Item einsetzen** | **Q** |
| **Chat** | **T** (Enter = senden, Esc = abbrechen) |
| **Schleichen** (langsam, geduckt, lautlos, ruhigere Waffe) – mit Flug-Cheat: runterfliegen | **Shift links (halten)** |
| Scoreboard | Tab (halten) |
| Menü / Maus freigeben | Esc |

Waffen und Item-Boxen werden automatisch aufgesammelt, wenn man darüberläuft.

---

## Portfreigabe, Firewall, Tailscale/ZeroTier

Benötigte Ports (beide **TCP**, beim jeweiligen Host):

| Zweck | Standard-Port | Wer muss erreichbar sein |
|---|---|---|
| Party-Lobby | **27016** | Party-Host |
| Spielserver | **27015** | Spiel-Host (bei Party: der gewählte PC) |

### Windows-Firewall
Beim ersten Hosten erscheint ein Dialog → **„Private Netzwerke“ anhaken → Zugriff zulassen**.
Falls er weggeklickt wurde, in einer **Administrator-PowerShell** freigeben:

```powershell
New-NetFirewallRule -DisplayName "Lagerfeuer Launcher" -Direction Inbound -Protocol TCP -LocalPort 27015,27016 -Action Allow -Profile Private
```

### Portfreigabe am Router (nur für Spielen übers Internet)
1. Router-Oberfläche öffnen (z. B. FRITZ!Box: `http://fritz.box`, sonst meist `http://192.168.0.1` oder `http://192.168.1.1`).
2. Bereich **Portfreigabe / Port-Forwarding / NAT** öffnen.
   (FRITZ!Box: *Internet → Freigaben → Portfreigaben → Gerät für Freigaben hinzufügen*.)
3. Den **Host-PC** auswählen und **TCP 27016** (Party) und **TCP 27015** (Spiel) freigeben.
4. Freunde verbinden sich dann mit deiner **öffentlichen IP** (bei der Party: „Andere Adresse“ wählen).

Hinweise: Manche Anschlüsse (DS-Lite, Mobilfunk, CGNAT) erlauben keine Portfreigabe für IPv4. Dann ist ein VPN die Lösung.

### Ohne Portfreigabe: Tailscale oder ZeroTier (empfohlen)
Damit seid ihr in einem gemeinsamen virtuellen LAN, und Portfreigaben entfallen komplett.
- **Tailscale** (<https://tailscale.com>): auf allen PCs installieren, mit demselben Konto oder per Einladung ins selbe „Tailnet“.
  Die Tailscale-IP beginnt mit `100.` und wird im Launcher automatisch als **„Tailscale“** angeboten.
- **ZeroTier** (<https://www.zerotier.com>): Netzwerk anlegen, alle treten mit der Netzwerk-ID bei, im Web-Panel freischalten.
  Die Adresse wird als **„ZeroTier“** angeboten.

Danach beim Party-Erstellen einfach diese Adresse wählen. Die Firewall-Freigabe (oben) ist trotzdem nötig.

---

## Neue Spiele hinzufügen

Ein Spiel ist **ein Ordner mit einer `game.json`**. Der Launcher sucht Spiele in:

1. `Lagerfeuer Launcher\resources\games\` (mitgelieferte Spiele)
2. `Lagerfeuer Launcher\games\` (neben der `.exe`)
3. `%APPDATA%\Lagerfeuer Launcher\games\` (Bibliothek → **Ordner**-Knopf öffnet ihn)

Ordner hineinkopieren → im Launcher **„Neu laden“** klicken. Fertig.

### 1. Manifest `game.json`
```json
{
  "id": "mein-spiel",
  "name": "Mein Spiel",
  "version": "1.0.0",
  "tagline": "Kurzer Untertitel",
  "description": "Beschreibung für die Bibliothek.",
  "client": "client/index.html",
  "server": "server/server.mjs",
  "icon": "icon.svg",
  "cover": "cover.svg",
  "modes": ["singleplayer", "multiplayer", "party"],
  "maxPlayers": 8,
  "defaultPort": 27020,
  "supportsBots": false
}
```
- `id`: nur `a-z`, `0-9`, `-` (eindeutig)
- `client`: HTML-Datei, die im Spielfenster geladen wird (Pflicht)
- `server`: optionales Node-Modul für den Host-Server (für Multiplayer/Party)
- `modes`: welche Knöpfe in der Bibliothek aktiv sind

### 2. Client (läuft im Spielfenster)
Der Client wird unter `app://game/<id>/…` geladen. Über `window.launcher` stehen bereit:

| Funktion | Zweck |
|---|---|
| `await launcher.getLaunchParams()` | `{ mode, address, port, password, name, settings, game }` – wohin verbinden + alle globalen Einstellungen (Audio, Grafik, Tastenbelegung) |
| `launcher.getSettings()` / `setSettings(s)` | Einstellungen lesen/ändern |
| `launcher.exitGame()` | Spiel schließen, zurück zum Launcher |
| `launcher.reportReady()` | optional: Spiel ist geladen |

`mode` ist `singleplayer`, `host`, `join` oder `party`. Bei `singleplayer`/`host` hat der Launcher den Server
schon gestartet, und `address` ist `127.0.0.1`.

### 3. Server (optional, läuft im Launcher des Hosts)
```js
// server/server.mjs
export async function createServer({ port, host, password, bots, botDifficulty, WebSocketServer, log }) {
  const wss = new WebSocketServer({ port, host });
  await new Promise((ok, fail) => { wss.once('listening', ok); wss.once('error', fail); });
  // … eigenes Protokoll, Passwort beim Join prüfen …
  return { port: wss.address().port, stop: () => new Promise((r) => wss.close(r)) };
}
```
`WebSocketServer` (Paket `ws`) wird vom Launcher hineingereicht, das Spiel braucht also kein eigenes `node_modules`.
Party-System, Host-Wahl, Passwörter und das automatische Hereinholen der Mitglieder übernimmt der Launcher, für jedes Spiel.

### 4. Noch einfacher: das Lagerfeuer-Spiele-SDK (empfohlen)
Die Spiele 2–10 nutzen das mitgelieferte SDK. Damit besteht ein neues Mehrspieler-Spiel nur noch aus der eigentlichen Spiellogik.

**Server** – das SDK übernimmt WebSocket, Beitritt, Passwort, Spielerliste, Farben, Bots, Chat, Ping und Tickrate:
```js
// server/server.mjs
export async function createServer(opts) {
  return opts.sdk.createRoom(opts, new MeinSpiel(), { tickRate: 30, version: 1, maxPlayers: 8 });
}
class MeinSpiel {
  init(opts) { for (let i = 0; i < (opts.bots ?? 0); i++) this.room.addBot(); }
  onJoin(player) { /* Spielfigur anlegen */ }
  onLeave(player) {}
  onMessage(player, msg) { /* Eingaben, z. B. { t: 'in', keys } */ }
  onChat(player, text) { return false; /* true = Nachricht abfangen (z. B. Rate-Antwort) */ }
  tick(dt, time) { /* simulieren */ }
  state() { return { /* Zustand, geht jeden Tick an alle als { t: 's', … } */ }; }
}
```
`this.room` bietet `players`, `addBot()`, `send(player, obj)`, `broadcast(obj)`, `sendScores()` und `time`. `player.score` erscheint automatisch im Scoreboard.

**Client** – Menü, Verbindung, Chat, Scoreboard, Sound und Spielschleife sind fertig:
```html
<link rel="stylesheet" href="app://sdk/ui.css" />
<canvas id="game"></canvas>
<script type="module">
  import { startGame, draw } from 'app://sdk/client.js';
  const ctx = await startGame({
    title: 'Mein Spiel', help: [['WASD', 'Laufen']],
    onWelcome(msg, ctx) {}, onMessage(msg, ctx) { /* msg.t === 's' → Zustand */ },
    onFrame(dt, ctx) { ctx.g.fillRect(…); ctx.send({ t: 'in', keys: { up: ctx.down('KeyW') } }); },
  });
</script>
```
3D-Spiele binden three.js über `app://sdk/vendor/three.module.js` ein (siehe `games/parkour`).
Neue Spiele werden vom Test `tests/games.test.mjs` und vom Selbsttest automatisch mitgeprüft.

---

## Projektstruktur

```
src/
  main/                     ← Electron-Hauptprozess (Node)
    main.js                 Fenster, IPC, app://-Protokoll, Selbsttest
    settings.js             Einstellungen laden/speichern
    gameRegistry.js         Spiele über game.json finden
    gameServerManager.js    Host-Server eines Spiels starten/stoppen
    party/partyServer.js    Party-Lobby-Server (Host-Wahl, Start, Mitglieder)
    preload.js              sichere API window.launcher
  launcher/                 ← Launcher-Oberfläche
    index.html, style.css
    js/app.js               Bibliothek, Dialoge, Lobby, Einstellungen
    js/partyClient.js       Lobby-Verbindung (WebSocket)
    js/partyCode.js         Party-Code ⇄ IP:Port
    js/perfCheck.js         Leistungscheck
    js/audio.js, icons.js   UI-Sounds/Musik, SVG-Icons
  sdk/                      ← Spiele-SDK für alle Spiele
    server.cjs              Räume, Beitritt, Passwort, Bots, Chat, Tickrate
    client.js, ui.css       Menü, Verbindung, Chat, Scoreboard, Sound, Spielschleife
    vendor/                 three.js für 3D-Spiele
games/
  arena-shooter/            ← Blumenfeld Arena (eigene Engine-Teile, nutzt das SDK nicht)
    game.json, icon.svg, cover.svg
    shared/world.mjs        gemeinsame Regeln: Map, Gebäude, Waffen, Items, Kollision, Raycasts
    server/server.mjs       autoritativer Host-Server inkl. Bots
    client/                 index.html, style.css, js/ (main, net, scene, models, viewmodel, hud, sfx), vendor/three.js
  snake-oi/ parkour/ panzer/ bomben/ pong/ rennen/ sterne/ vier/ kritzel/
                            ← je game.json, icon.svg, cover.svg, server/server.mjs, client/ (index.html, game.js)
build/                      App-Icon (icon.ico/png, erzeugt von scripts/make-icons.mjs)
scripts/                    build.mjs, make-icons.mjs, make-game-art.mjs, scaffold-games.mjs, vendor-three.mjs
tests/                      automatische Tests (node --test)
```

---

## Entwickeln, Testen, Bauen

Voraussetzung: **Node.js 24** (getestet mit 24.15.0) und npm 11.

```powershell
npm install
```
```powershell
npm start
```
```powershell
npm test
```
```powershell
npm run selftest
```
```powershell
npm run build -- --zip
```

- `npm start` startet den Launcher im Entwicklungsmodus.
- `npm test` führt 29 automatische Tests aus: Party-Code, Map/Gebäude/Kollision/Raycasts, Einstellungen, Registry,
  Blumenfeld-Arena-Server (Passwort, Treffer → Kill → Respawn, Bots, Chat + Cheat-Codes, Messer, Raketen, Items), den Party-Ablauf
  (Beitritt, Passwort, Leistungscheck → stärkster PC hostet, Start → alle werden geholt) sowie **jeden Spielserver**
  (Beitritt, Passwort, Zustand, Bots, Chat), Kritzel & Raten (Lösung bleibt geheim) und den Vier-in-Reihe-Computergegner.
- `npm run selftest` (oder `"Lagerfeuer Launcher.exe" --selftest`) startet die echte App und klickt sich automatisch durch:
  Einstellungen → Party erstellen → Leistungscheck → Spiel starten → zurück in die Lobby → Singleplayer mit Bots →
  danach jedes weitere Spiel einmal (Verbindung, FPS, Screenshot). Einzelne Spiele: `--selftest --selftest-only=snake-oi,parkour`.
  Screenshots und `selftest.log` landen in `%TEMP%\lagerfeuer-selftest`. Exit-Code 0 = alles ok.
- `npm run build` erzeugt `dist\Lagerfeuer Launcher-win32-x64\Lagerfeuer Launcher.exe`, mit `-- --zip` zusätzlich `release\*.zip`.
- `npm run icons` erzeugt das App-Icon neu, `npm run vendor` kopiert three.js neu ins Spiel.

---

## Abhängigkeiten & Versionen

| Paket | Version | Zweck |
|---|---|---|
| Node.js | 24.15.0 (Build) | Build-Werkzeuge |
| Electron | 45.4.1 | Desktop-Laufzeit (Chromium + Node), steckt in der .exe |
| three | 0.187.0 | 3D-Grafik (WebGL), als Kopie in `games/arena-shooter/client/vendor` |
| ws | 8.23.0 | WebSocket-Server für Party und Spiel (Laufzeit) |
| @electron/packager | 20.3.0 | Erzeugt die Windows-.exe (nur Build) |

Laufzeit für Spieler: **Windows 10/11 (64 Bit)** mit einer WebGL-fähigen Grafikkarte. Sonst nichts.

---

## Bekannte Grenzen

- **Keine Lag-Kompensation:** Der Host prüft Treffer gegen die aktuellen Positionen. Bei hohem Ping (> 100 ms)
  muss man bewegten Gegnern etwas vorhalten. Für Spielen mit Freunden in Deutschland/LAN ist das unkritisch.
- **Bewegung ist client-vorhergesagt:** Der Host prüft die Geschwindigkeit, aber nicht jede Kollision. Gedacht ist das für
  Spielen unter Freunden, nicht als Anti-Cheat für Fremde.
- **Party-Codes kodieren IPv4-Adressen.** Für Hostnamen (z. B. DynDNS) bei „Party beitreten“ direkt `name.domain:Port` eingeben.
  IPv6 wird nicht unterstützt.
- Die `.exe` ist **nicht signiert** (SmartScreen-Hinweis beim ersten Start).
