/**
 * Blumenfeld Arena – Host-Server (Listen-Server, läuft im Launcher des hostenden Spielers).
 *
 * Der Host ist autoritativ für: Treffer & Schaden, Raketen/Kugeln/Fallen, Explosionen, Tode/Respawns,
 * Munition, Waffen- und Item-Box-Spawns, Items, Buffs, Chat & Cheat-Codes, Bots.
 * Bewegung wird vom Client vorhergesagt und vom Server auf Plausibilität geprüft.
 *
 * Nachrichten (JSON, Feld t):
 *  Client → Server: join, in, shoot, reload, switch, item, chat, ping
 *  Server → Client: welcome, error, s (Snapshot inkl. Projektile/Fallen), you (privater Zustand), shot, hit, hitc,
 *                   kill, spawn, pick, pjoin, pleave, scores, pong, msg, chat, cheat, boom, push, itemUse
 */
import crypto from 'node:crypto';
import {
  PROTOCOL_VERSION, TICK_RATE, MAX_HP, WALK_SPEED, SPRINT_SPEED, RESPAWN_TIME, SPAWN_PROTECTION,
  WEAPONS, WEAPON_ORDER, BUFFS, BUFF_ORDER, ITEMS, ITEM_ORDER, SHELL, ROCKET, CHEATS, ITEMBOX_RESPAWN, WEAPON_RESPAWN,
  EYE_HEIGHT, CROUCH_FACTOR, WIND, smashBonus, generateWorld, collide, groundHeight, raycastWorld, hitPlayer, spreadDir, dirFromAngles, playerColor, speedMultiplier,
} from '../shared/world.mjs';

const MAX_PLAYERS = 16;
const BOT_NAMES = ['Gänseblümchen', 'Löwenzahn', 'Klatschmohn', 'Kornblume', 'Butterblume', 'Rotklee', 'Wiesensalbei', 'Margerite', 'Schafgarbe', 'Glockenblume', 'Vergissmeinnicht', 'Hahnenfuß', 'Sauerampfer', 'Wegwarte', 'Akelei'];
const DIFFICULTY = {
  easy: { reaction: 0.9, aimError: 0.09, view: 45, burst: 0.55 },
  normal: { reaction: 0.55, aimError: 0.05, view: 65, burst: 0.75 },
  hard: { reaction: 0.3, aimError: 0.025, view: 85, burst: 0.95 },
};
const BOT_WEAPON_PREF = ['rifle', 'smg', 'shotgun', 'sniper', 'rocket', 'pistol', 'knife'];

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const hb = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}
const round = (v, n = 100) => Math.round(v * n) / n;

export async function createServer({ port = 27015, host = '0.0.0.0', password = '', bots = 0, botDifficulty = 'normal', WebSocketServer, log = console.log }) {
  const game = new GameState({ password, log, botDifficulty });
  for (let i = 0; i < bots; i++) game.addBot();

  const wss = new WebSocketServer({ port, host, maxPayload: 8 * 1024 });
  await new Promise((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });
  wss.on('connection', (ws, req) => game.onConnection(ws, req));
  const timer = setInterval(() => game.tick(), 1000 / TICK_RATE);
  log(`Läuft auf ${host}:${wss.address().port} (Bots: ${bots}, Passwort: ${password ? 'ja' : 'nein'})`);

  return {
    port: wss.address().port,
    game,
    stop: () => new Promise((resolve) => {
      clearInterval(timer);
      game.broadcast({ t: 'msg', text: 'Der Host hat das Spiel beendet.', end: true });
      for (const c of wss.clients) c.close(1001, 'server stop');
      wss.close(() => resolve());
    }),
  };
}

class GameState {
  constructor({ password, log, botDifficulty }) {
    this.password = password;
    this.log = log;
    this.difficulty = DIFFICULTY[botDifficulty] || DIFFICULTY.normal;
    this.seed = 1337;
    this.world = generateWorld(this.seed);
    this.players = new Map();
    this.nextId = 1;
    this.nextObjId = 1;
    this.time = 0;
    this.lastTick = performance.now();
    this.rand = Math.random;
    this.pickups = [];
    this.projectiles = [];
    this.traps = [];
    this.scoreTimer = 0;
    for (const ws of this.world.weaponSpawns) {
      this.pickups.push({ id: this.nextObjId++, kind: 'weapon', type: ws.weapon, x: ws.x, y: ws.y || 0, z: ws.z, active: true, respawnAt: 0 });
    }
    for (const ib of this.world.itemBoxSpawns) {
      this.pickups.push({ id: this.nextObjId++, kind: 'itembox', type: 'box', x: ib.x, y: 0, z: ib.z, active: true, respawnAt: 0 });
    }
  }

  // ---------- Verbindung ----------
  onConnection(ws, req) {
    let player = null;
    const timeout = setTimeout(() => ws.close(4000, 'join timeout'), 6000);
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      if (!player) {
        if (msg.t !== 'join') return;
        clearTimeout(timeout);
        player = this.handleJoin(ws, msg, req.socket.remoteAddress);
        return;
      }
      this.handleMessage(player, msg);
    });
    ws.on('close', () => {
      clearTimeout(timeout);
      if (player) this.removePlayer(player);
    });
    ws.on('error', () => {});
  }

  handleJoin(ws, msg, addr) {
    const reject = (text) => {
      ws.send(JSON.stringify({ t: 'error', text }));
      ws.close(4001, 'rejected');
      return null;
    };
    if (msg.version !== PROTOCOL_VERSION) return reject('Spielversion passt nicht zum Host (bitte alle denselben Launcher verwenden).');
    if (this.password && !safeEqual(msg.password, this.password)) return reject('Falsches Passwort.');
    const humans = [...this.players.values()].filter((p) => !p.bot).length;
    if (humans >= MAX_PLAYERS) return reject('Der Server ist voll.');
    if (this.players.size >= MAX_PLAYERS) {
      const bot = [...this.players.values()].find((p) => p.bot);
      if (bot) this.removePlayer(bot);
    }
    const p = this.createPlayer(String(msg.name || 'Spieler').slice(0, 20), false);
    p.ws = ws;
    this.log(`${p.name} verbunden (${addr})`);
    this.send(p, {
      t: 'welcome', id: p.id, seed: this.seed, tickRate: TICK_RATE,
      players: [...this.players.values()].map((x) => this.publicInfo(x)),
      pickups: this.pickups.map((k) => this.pickupInfo(k)),
    });
    this.broadcast({ t: 'pjoin', p: this.publicInfo(p) }, p);
    this.broadcast({ t: 'msg', text: `${p.name} ist beigetreten.` });
    this.respawn(p);
    return p;
  }

  createPlayer(name, bot) {
    const id = this.nextId++;
    const p = {
      id, name, bot, ws: null, color: playerColor(id),
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
      hp: MAX_HP, maxHp: MAX_HP, alive: false, respawnAt: 0, protectedUntil: 0,
      moving: false, sprinting: false, ads: false,
      weapons: {}, current: 'pistol', lastShot: 0, reloadUntil: 0, reloadWeapon: null,
      buffs: {}, item: null, itemReadyAt: 0, cheats: { god: false, trigger: false, life: false },
      kills: 0, deaths: 0, ping: 0, tid: 0, lastInputTime: 0, graceUntil: 0, chatAt: -10,
      ai: bot ? { target: null, waypoint: null, reactAt: 0, strafe: 1, strafeAt: 0, stuckCheck: 0, stuckPos: null, losAt: 0 } : null,
    };
    this.players.set(id, p);
    return p;
  }

  addBot() {
    const used = new Set([...this.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(`${n} [Bot]`)) || 'Bot';
    const p = this.createPlayer(`${name} [Bot]`, true);
    this.broadcast({ t: 'pjoin', p: this.publicInfo(p) });
    this.respawn(p);
  }

  removePlayer(p) {
    if (!this.players.has(p.id)) return;
    this.players.delete(p.id);
    this.broadcast({ t: 'pleave', id: p.id });
    if (!p.bot) {
      this.broadcast({ t: 'msg', text: `${p.name} hat das Spiel verlassen.` });
      this.log(`${p.name} getrennt`);
    }
  }

  publicInfo(p) {
    return { id: p.id, name: p.name, color: p.color, bot: p.bot, kills: p.kills, deaths: p.deaths };
  }
  pickupInfo(k) {
    return { id: k.id, kind: k.kind, type: k.type, x: round(k.x), y: round(k.y), z: round(k.z), active: k.active };
  }
  has(p, buff) {
    return (p.buffs[buff] || 0) > this.time;
  }
  activeBuffs(p) {
    const out = {};
    for (const [k, until] of Object.entries(p.buffs)) if (until > this.time) out[k] = true;
    return out;
  }
  addBuff(p, id, duration = BUFFS[id].duration) {
    p.buffs[id] = Math.max(p.buffs[id] || 0, this.time + duration);
  }

  // ---------- Nachrichten ----------
  handleMessage(p, msg) {
    switch (msg.t) {
      case 'in': return this.onInput(p, msg);
      case 'shoot': return this.onShoot(p, msg);
      case 'reload': return this.startReload(p);
      case 'switch':
        if (p.weapons[msg.w] && p.current !== msg.w) {
          p.current = msg.w;
          p.reloadUntil = 0;
          p.lastShot = this.time - WEAPONS[msg.w].rate + 0.3; // Zieh-Zeit
          this.sendPrivate(p);
        }
        return;
      case 'item': return this.useItem(p, msg.d);
      case 'wind': return this.throwWind(p, msg.d);
      case 'chat': return this.onChat(p, msg.text);
      case 'ping':
        this.send(p, { t: 'pong', c: msg.c });
        if (Number.isFinite(msg.rtt)) p.ping = Math.max(0, Math.min(999, Math.round(msg.rtt)));
        return;
    }
  }

  /** Chat – Cheat-Codes werden abgefangen und NICHT an die anderen geschickt. */
  onChat(p, raw) {
    const text = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!text || this.time - p.chatAt < 0.4) return;
    p.chatAt = this.time;
    if (text.startsWith('/')) return this.onCommand(p, text);
    const cheat = CHEATS[text];
    if (cheat) {
      const on = !p.cheats[cheat.id];
      p.cheats[cheat.id] = on;
      if (cheat.id === 'life') {
        p.maxHp = on ? MAX_HP * 10 : MAX_HP;
        if (p.alive) p.hp = on ? p.maxHp : Math.min(p.hp, MAX_HP);
      }
      this.send(p, { t: 'cheat', text: `${cheat.name} ${on ? 'aktiviert' : 'deaktiviert'}` });
      this.sendPrivate(p);
      return;
    }
    this.broadcast({ t: 'chat', id: p.id, name: p.name, color: p.color, text });
  }

  onInput(p, m) {
    if (!p.alive || m.tid !== p.tid) return; // Eingaben vor dem letzten Teleport ignorieren
    if (![m.x, m.y, m.z, m.yaw, m.pitch].every(Number.isFinite)) return;
    const dt = Math.max(0.03, this.time - p.lastInputTime);
    p.lastInputTime = this.time;
    // Plausibilitätsprüfung (nach Explosions-Rückstoß kurz großzügiger)
    const allowed = this.time < p.graceUntil ? 60 : SPRINT_SPEED * speedMultiplier(this.activeBuffs(p), p.cheats) * 1.3 + 2;
    if (Math.hypot(m.x - p.x, m.z - p.z) > allowed * dt + 1.5) {
      this.send(p, { t: 'fix', x: p.x, y: p.y, z: p.z });
      return;
    }
    const maxY = p.cheats.god ? 400 : 40;
    const pos = collide(this.world, { x: m.x, z: m.z, y: Math.max(0, m.y) });
    p.x = pos.x;
    p.z = pos.z;
    p.y = Math.max(0, Math.min(maxY, m.y));
    p.yaw = m.yaw;
    p.pitch = Math.max(-1.55, Math.min(1.55, m.pitch));
    p.moving = !!m.mv;
    p.sprinting = !!m.sp;
    p.ads = !!m.ads;
    p.crouch = !!m.cr;
    // Fallhöhe für den Streitkolben-Smash: höchster Punkt seit der letzten Bodenberührung
    if (p.y <= groundHeight(this.world, p.x, p.z, p.y) + 0.05) p.peakY = p.y;
    else p.peakY = Math.max(p.peakY ?? p.y, p.y);
  }

  startReload(p) {
    const w = WEAPONS[p.current];
    const ammo = p.weapons[p.current];
    if (w.melee || !p.alive || !ammo || p.reloadUntil > this.time || ammo.mag >= w.mag || ammo.reserve <= 0 || p.cheats.god) return;
    p.reloadUntil = this.time + w.reload;
    p.reloadWeapon = p.current;
    this.sendPrivate(p);
  }

  finishReload(p) {
    const w = WEAPONS[p.reloadWeapon];
    const ammo = p.weapons[p.reloadWeapon];
    p.reloadUntil = 0;
    if (!ammo || p.reloadWeapon !== p.current) return;
    const take = Math.min(w.mag - ammo.mag, ammo.reserve);
    ammo.mag += take;
    ammo.reserve -= take;
    this.sendPrivate(p);
  }

  /** Schuss: Server prüft Kadenz/Munition und wertet aus (Hitscan, Nahkampf oder Rakete). */
  onShoot(p, m) {
    if (!p.alive || this.has(p, 'stun') || !Array.isArray(m.d) || m.d.length !== 3 || !m.d.every(Number.isFinite)) return;
    const w = WEAPONS[p.current];
    const ammo = p.weapons[p.current];
    if (!ammo || p.reloadUntil > this.time) return;
    if (this.time - p.lastShot < w.rate * 0.85) return; // Toleranz für Netzwerk-Jitter
    if (!w.melee && ammo.mag <= 0 && !p.cheats.god) { this.startReload(p); return; }
    if (!w.melee && !p.cheats.god) ammo.mag--;
    p.lastShot = this.time;
    p.protectedUntil = 0;
    const l = Math.hypot(...m.d);
    this.fire(p, w, [m.d[0] / l, m.d[1] / l, m.d[2] / l]);
    if (!w.melee && ammo.mag === 0 && ammo.reserve > 0) this.startReload(p);
    else this.sendPrivate(p);
  }

  fire(p, w, dir) {
    const origin = [p.x, p.y + EYE_HEIGHT * (this.has(p, 'shrink') ? 0.6 : 1) * (p.crouch ? CROUCH_FACTOR : 1), p.z];
    const damageMul = this.has(p, 'damage') ? 1.5 : 1;
    if (w.melee) return this.melee(p, w, origin, dir, damageMul);
    if (w.projectile === 'rocket') {
      const o = [origin[0] + dir[0] * 0.8, origin[1] + dir[1] * 0.8 - 0.15, origin[2] + dir[2] * 0.8];
      this.projectiles.push({ id: this.nextObjId++, kind: 'rocket', owner: p.id, x: o[0], y: o[1], z: o[2], vx: dir[0] * ROCKET.speed, vy: dir[1] * ROCKET.speed, vz: dir[2] * ROCKET.speed, life: 6, born: this.time, dmg: w.damage * damageMul });
      this.broadcast({ t: 'shot', id: p.id, w: w.id, o: origin.map((v) => round(v)), e: [] });
      return;
    }
    let spread = p.ads ? w.adsSpread : w.spread;
    if (p.moving) spread *= p.ads ? 1.2 : 1.4;
    if (p.sprinting) spread *= 1.8;
    if (p.crouch) spread *= 0.7;
    if (p.y > 0.05 && !p.bot && !p.cheats.god && groundHeight(this.world, p.x, p.z, p.y) < p.y - 0.2) spread *= 1.5;
    const ends = [];
    const dmgByTarget = new Map();
    for (let i = 0; i < w.pellets; i++) {
      const d = spreadDir(dir, spread, this.rand);
      let best = raycastWorld(this.world, origin, d, w.range);
      let target = null, head = false;
      for (const q of this.players.values()) {
        if (q === p || !q.alive) continue;
        const h = hitPlayer(origin, d, q, this.has(q, 'shrink') ? 0.6 : 1, q.crouch);
        if (h.t < best) { best = h.t; target = q; head = h.head; }
      }
      ends.push([round(origin[0] + d[0] * best), round(origin[1] + d[1] * best), round(origin[2] + d[2] * best), target ? 1 : 0]);
      if (target) {
        const falloff = best > w.falloff ? Math.max(0.35, 1 - (best - w.falloff) / w.range) : 1;
        const dmg = w.damage * damageMul * falloff * (head ? w.headMul : 1);
        const prev = dmgByTarget.get(target) || { dmg: 0, head: false };
        dmgByTarget.set(target, { dmg: prev.dmg + dmg, head: prev.head || head });
      }
    }
    this.broadcast({ t: 'shot', id: p.id, w: w.id, o: origin.map((v) => round(v)), e: ends });
    for (const [target, { dmg, head }] of dmgByTarget) this.damage(target, dmg, p, w.id, head);
  }

  /** Messer: kurzer Strahl, notfalls kleiner Kegel vor dem Spieler. */
  melee(p, w, origin, dir, damageMul) {
    let target = null, head = false, best = w.range;
    for (const q of this.players.values()) {
      if (q === p || !q.alive) continue;
      const h = hitPlayer(origin, dir, q, this.has(q, 'shrink') ? 0.6 : 1, q.crouch);
      if (h.t < best) { best = h.t; target = q; head = h.head; }
    }
    if (!target) {
      for (const q of this.players.values()) {
        if (q === p || !q.alive) continue;
        const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
        if (d < w.range && Math.abs(q.y - p.y) < (w.smash ? 3 : 1.5) && (dx * dir[0] + dz * dir[2]) / (d || 1) > 0.7) { target = q; break; }
      }
    }
    if (target && raycastWorld(this.world, origin, dir, best) < best - 0.2) target = null; // Wand dazwischen
    this.broadcast({ t: 'shot', id: p.id, w: w.id, o: origin.map((v) => round(v)), e: [] });
    if (!target) return;
    if (w.smash) return this.maceHit(p, target, w, damageMul, head);
    // Von hinten erstechen = mehr Schaden
    const back = Math.cos(target.yaw - p.yaw) > 0.5;
    this.damage(target, w.damage * damageMul * (head ? w.headMul : 1) * (back ? 2 : 1), p, 'knife', head);
  }

  /** Streitkolben: Schaden wächst mit der Fallhöhe. Ein Smash schleudert Umstehende weg und federt dich ab. */
  maceHit(p, target, w, damageMul, head) {
    const fall = Math.max(0, (p.peakY ?? p.y) - p.y);
    const bonus = smashBonus(fall);
    if (bonus > 0) {
      this.broadcast({ t: 'smash', id: p.id, x: round(target.x), y: round(target.y), z: round(target.z), fall: round(fall, 10) });
      for (const q of this.players.values()) { // Schockwelle
        if (q === p || !q.alive) continue;
        const dx = q.x - target.x, dz = q.z - target.z, d = Math.hypot(dx, dz);
        if (d > 3.5) continue;
        if (q !== target) this.damage(q, 6, p, 'mace');
        q.graceUntil = this.time + 1.5;
        const n = d > 0.01 ? [dx / d, dz / d] : [0, 0];
        this.send(q, { t: 'push', v: [round(n[0] * 7), 6, round(n[1] * 7)] });
      }
      p.peakY = p.y;
      p.graceUntil = this.time + 1.5;
      this.send(p, { t: 'push', v: [0, 7, 0], reset: true }); // Rückprall wie nach einer Landung auf dem Gegner
    }
    this.damage(target, (w.damage + bonus) * damageMul * (head ? w.headMul : 1), p, 'mace', head);
  }

  /** Chat-Befehle (beginnen mit "/"). Werden nie an die anderen gesendet. */
  onCommand(p, text) {
    const cmd = text.split(' ')[0].toLowerCase();
    if (cmd === '/mace') {
      p.maceKit = !p.maceKit;
      if (p.maceKit) { p.weapons.mace = { mag: 0, reserve: 0 }; p.current = 'mace'; p.reloadUntil = 0; }
      else { delete p.weapons.mace; if (p.current === 'mace') p.current = 'pistol'; }
      this.send(p, { t: 'cheat', text: p.maceKit ? 'Streitkolben + unendlich Windladungen erhalten (Taste F = Windladung)' : 'Streitkolben abgelegt' });
      this.sendPrivate(p);
    } else {
      this.send(p, { t: 'cheat', text: `Unbekannter Befehl ${cmd} – verfügbar: /mace` });
    }
  }

  /** Windladung werfen (nur mit /mace, dafür unendlich). */
  throwWind(p, d) {
    if (!p.alive || !p.maceKit || this.has(p, 'stun') || this.time - (p.windAt ?? -10) < WIND.cooldown) return;
    if (!Array.isArray(d) || d.length !== 3 || !d.every(Number.isFinite)) return;
    const l = Math.hypot(...d) || 1;
    const dir = [d[0] / l, d[1] / l, d[2] / l];
    p.windAt = this.time;
    const eye = p.y + EYE_HEIGHT * (p.crouch ? CROUCH_FACTOR : 1);
    this.projectiles.push({ id: this.nextObjId++, kind: 'wind', owner: p.id, x: p.x + dir[0] * 0.5, y: eye + dir[1] * 0.5 - 0.1, z: p.z + dir[2] * 0.5, vx: dir[0] * WIND.speed, vy: dir[1] * WIND.speed, vz: dir[2] * WIND.speed, life: WIND.life, born: this.time });
    this.broadcast({ t: 'shot', id: p.id, w: 'wind', o: [round(p.x), round(eye), round(p.z)], e: [] });
  }

  /** Windladung platzt: Rückstoß weg vom Zentrum + nach oben, kaum Schaden. Wirkt auch auf den Werfer (Wind-Sprung). */
  windBurst(x, y, z, owner) {
    this.broadcast({ t: 'wind', x: round(x), y: round(y), z: round(z) });
    const attacker = this.players.get(owner) || { id: owner, x, z, kills: 0 };
    for (const q of this.players.values()) {
      if (!q.alive) continue;
      const cx = q.x, cy = q.y + 0.9, cz = q.z;
      const dx = cx - x, dy = cy - y, dz = cz - z, d = Math.hypot(dx, dy, dz);
      if (d > WIND.radius) continue;
      const k = 1 - d / WIND.radius * 0.6; // auch am Rand noch spürbar
      const h = Math.hypot(dx, dz);
      const nx = h > 0.05 ? dx / h : 0, nz = h > 0.05 ? dz / h : 0;
      q.graceUntil = this.time + 2;
      q.peakY = q.y; // Fallhöhe zählt ab dem höchsten Punkt des neuen Flugs
      if (q.id !== owner) this.damage(q, WIND.damage, attacker, 'wind');
      this.send(q, { t: 'push', v: [round(nx * WIND.push * k), round(WIND.up * k), round(nz * WIND.push * k)], reset: true });
    }
  }

  damage(target, amount, attacker, weaponId, head = false) {
    if (!target.alive || target.protectedUntil > this.time || this.has(target, 'star')) return;
    let dmg = amount;
    if (this.has(target, 'shield')) dmg *= 0.5;
    dmg = Math.max(1, Math.round(dmg));
    target.hp -= dmg;
    this.send(target, { t: 'hit', by: attacker.id, dmg, from: [round(attacker.x), round(attacker.z)] });
    const killed = target.hp <= 0;
    if (attacker !== target) this.send(attacker, { t: 'hitc', dmg, head, kill: killed });
    if (target.bot && target.ai && !target.ai.target && attacker !== target) { target.ai.target = attacker.id; target.ai.reactAt = this.time + this.difficulty.reaction * 0.6; }
    if (killed) {
      target.hp = 0;
      target.alive = false;
      target.deaths++;
      target.respawnAt = this.time + RESPAWN_TIME;
      target.reloadUntil = 0;
      target.buffs = {};
      target.item = null;
      if (attacker !== target) attacker.kills++;
      this.broadcast({ t: 'kill', k: attacker.id, v: target.id, w: weaponId, head });
      this.sendScores();
      this.sendPrivate(target);
    } else {
      this.sendPrivate(target);
    }
  }

  /** Explosion: Flächenschaden mit Abnahme, Sichtlinie, Rückstoß (Raketensprünge möglich). */
  explode(x, y, z, owner, maxDmg, weaponId = 'rocket') {
    this.broadcast({ t: 'boom', x: round(x), y: round(y), z: round(z), r: ROCKET.radius });
    const attacker = this.players.get(owner) || { id: owner, x, z, kills: 0 };
    for (const q of this.players.values()) {
      if (!q.alive) continue;
      const c = [q.x, q.y + 1, q.z];
      const dx = c[0] - x, dy = c[1] - y, dz = c[2] - z;
      const d = Math.hypot(dx, dy, dz);
      if (d > ROCKET.radius) continue;
      if (d > 0.5) {
        const dir = [-dx / d, -dy / d, -dz / d];
        if (raycastWorld(this.world, c, dir, d) < d - 0.4) continue; // Deckung schützt
      }
      const k = 1 - d / ROCKET.radius;
      const isSelf = q.id === owner;
      if (!isSelf || !q.cheats.god) this.damage(q, maxDmg * (0.25 + 0.75 * k) * (isSelf ? ROCKET.selfDamage : 1), attacker, weaponId);
      const n = d > 0.01 ? [dx / d, dy / d, dz / d] : [0, 1, 0];
      const f = ROCKET.knockback * k;
      q.graceUntil = this.time + 1.5;
      this.send(q, { t: 'push', v: [round(n[0] * f), round(Math.max(3, n[1] * f + 6 * k)), round(n[2] * f)] });
    }
  }

  // ---------- Items ----------
  rollItem(p) {
    const ranked = [...this.players.values()].sort((a, b) => b.kills - a.kills);
    const r = ranked.length > 1 ? ranked.indexOf(p) / (ranked.length - 1) : 0.5;
    const weights = ITEM_ORDER.map((id) => ITEMS[id].weight[0] * (1 - r) + ITEMS[id].weight[1] * r);
    let roll = this.rand() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < weights.length; i++) { roll -= weights[i]; if (roll <= 0) return ITEM_ORDER[i]; }
    return ITEM_ORDER[0];
  }

  useItem(p, dirIn) {
    if (!p.alive || !p.item || this.time < p.itemReadyAt || this.has(p, 'stun')) return;
    const item = p.item;
    p.item = null;
    const dir = Array.isArray(dirIn) && dirIn.length === 3 && dirIn.every(Number.isFinite) ? dirIn : dirFromAngles(p.yaw, 0);
    const flat = Math.hypot(dir[0], dir[2]) > 0.01 ? [dir[0] / Math.hypot(dir[0], dir[2]), dir[2] / Math.hypot(dir[0], dir[2])] : [-Math.sin(p.yaw), -Math.cos(p.yaw)];
    const others = [...this.players.values()].filter((q) => q !== p && q.alive);
    switch (item) {
      case 'turbo': this.addBuff(p, 'turbo'); break;
      case 'star': for (const d of ['shrink', 'ink', 'stun']) delete p.buffs[d]; this.addBuff(p, 'star'); break;
      case 'heart': p.hp = Math.min(p.maxHp, p.hp + 60); this.addBuff(p, 'regen'); break;
      case 'shield': this.addBuff(p, 'shield'); break;
      case 'damage': this.addBuff(p, 'damage'); break;
      case 'lightning':
        for (const q of others) {
          if (this.has(q, 'star')) continue;
          this.addBuff(q, 'shrink');
          this.damage(q, 25, p, 'lightning');
          this.sendPrivate(q);
        }
        break;
      case 'ink':
        for (const q of others) { if (!this.has(q, 'star')) { this.addBuff(q, 'ink'); this.sendPrivate(q); } }
        break;
      case 'banana':
        this.traps.push({ id: this.nextObjId++, x: p.x - flat[0] * 1.3, y: groundHeight(this.world, p.x, p.z, p.y), z: p.z - flat[1] * 1.3, owner: p.id, born: this.time, until: this.time + 90 });
        if (this.traps.length > 30) this.traps.shift();
        break;
      case 'greenShell':
      case 'redShell': {
        const y = p.y + 0.45;
        this.projectiles.push({
          id: this.nextObjId++, kind: item, owner: p.id, x: p.x + flat[0] * 1.2, y, z: p.z + flat[1] * 1.2,
          vx: flat[0] * SHELL.speed, vy: 0, vz: flat[1] * SHELL.speed, life: SHELL.life, born: this.time, bounces: 0,
        });
        break;
      }
    }
    this.broadcast({ t: 'itemUse', id: p.id, item });
    this.sendPrivate(p);
  }

  // ---------- Projektile & Fallen ----------
  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.life -= dt;
      let remove = pr.life <= 0;
      if (pr.kind === 'rocket' || pr.kind === 'wind') {
        const speed = Math.hypot(pr.vx, pr.vy, pr.vz);
        const d = [pr.vx / speed, pr.vy / speed, pr.vz / speed];
        const stepLen = speed * dt;
        const o = [pr.x, pr.y, pr.z];
        let t = raycastWorld(this.world, o, d, stepLen);
        for (const q of this.players.values()) {
          if (!q.alive || (q.id === pr.owner && this.time - pr.born < 0.3)) continue;
          const h = hitPlayer(o, d, q, this.has(q, 'shrink') ? 0.6 : 1, q.crouch);
          if (h.t < t) t = h.t;
        }
        if (t < stepLen || remove || Math.abs(pr.x) > 260 || Math.abs(pr.z) > 260) {
          const k = Math.min(t, stepLen) - 0.1;
          if (pr.kind === 'wind') this.windBurst(pr.x + d[0] * k, pr.y + d[1] * k, pr.z + d[2] * k, pr.owner);
          else this.explode(pr.x + d[0] * k, pr.y + d[1] * k, pr.z + d[2] * k, pr.owner, pr.dmg);
          remove = true;
        } else {
          pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.z += pr.vz * dt;
        }
      } else {
        // Kugeln: rollen über den Boden, prallen von Wänden ab; die rote sucht sich ein Ziel
        if (pr.kind === 'redShell') {
          let target = null, best = 90;
          for (const q of this.players.values()) {
            if (q.id === pr.owner || !q.alive) continue;
            const dd = Math.hypot(q.x - pr.x, q.z - pr.z);
            if (dd < best) { best = dd; target = q; }
          }
          if (target) {
            const want = Math.atan2(target.z - pr.z, target.x - pr.x);
            const cur = Math.atan2(pr.vz, pr.vx);
            let diff = ((want - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
            const turn = Math.max(-3 * dt, Math.min(3 * dt, diff));
            const sp = Math.hypot(pr.vx, pr.vz);
            pr.vx = Math.cos(cur + turn) * sp;
            pr.vz = Math.sin(cur + turn) * sp;
          }
        }
        const nx = pr.x + pr.vx * dt, nz = pr.z + pr.vz * dt;
        const feet = pr.y - 0.4;
        const pos = collide(this.world, { x: nx, z: nz, y: feet }, SHELL.radius, 0.7);
        if (Math.abs(pos.x - nx) > 1e-4 || Math.abs(pos.z - nz) > 1e-4) {
          if (Math.abs(pos.x - nx) > Math.abs(pos.z - nz)) pr.vx = -pr.vx; else pr.vz = -pr.vz;
          if (++pr.bounces > SHELL.bounces) remove = true;
        }
        pr.x = pos.x; pr.z = pos.z;
        const g = groundHeight(this.world, pr.x, pr.z, feet);
        pr.y = g + 0.45;
        for (const q of this.players.values()) {
          if (!q.alive || (q.id === pr.owner && this.time - pr.born < 0.5)) continue;
          if (Math.hypot(q.x - pr.x, q.z - pr.z) < 0.9 && pr.y > q.y - 0.3 && pr.y < q.y + 1.6) {
            const owner = this.players.get(pr.owner) || { id: pr.owner, x: pr.x, z: pr.z, kills: 0 };
            this.damage(q, SHELL.damage[pr.kind], owner, pr.kind);
            this.broadcast({ t: 'boom', x: round(pr.x), y: round(pr.y), z: round(pr.z), r: 1.5, small: true });
            remove = true;
            break;
          }
        }
      }
      if (remove) this.projectiles.splice(i, 1);
    }

    for (let i = this.traps.length - 1; i >= 0; i--) {
      const tr = this.traps[i];
      if (this.time > tr.until) { this.traps.splice(i, 1); continue; }
      for (const q of this.players.values()) {
        if (!q.alive || (q.id === tr.owner && this.time - tr.born < 1.5)) continue;
        if (Math.hypot(q.x - tr.x, q.z - tr.z) < 0.9 && Math.abs(q.y - tr.y) < 0.8) {
          this.traps.splice(i, 1);
          if (!this.has(q, 'star')) {
            this.addBuff(q, 'stun');
            const owner = this.players.get(tr.owner) || { id: tr.owner, x: tr.x, z: tr.z, kills: 0 };
            this.damage(q, 20, owner, 'banana');
            this.sendPrivate(q);
          }
          this.broadcast({ t: 'itemUse', id: q.id, item: 'slip' });
          break;
        }
      }
    }
  }

  /** Spawnpunkt mit größtem Abstand zu lebenden Gegnern. */
  respawn(p) {
    const others = [...this.players.values()].filter((q) => q !== p && q.alive);
    let best = null, bestScore = -1;
    for (const s of this.world.playerSpawns) {
      const minD = others.length ? Math.min(...others.map((q) => Math.hypot(q.x - s.x, q.z - s.z))) : 100;
      const score = minD + this.rand() * 10;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    p.x = best.x; p.z = best.z; p.y = 0;
    p.yaw = Math.atan2(best.x, best.z);
    p.pitch = 0;
    p.maxHp = p.cheats.life ? MAX_HP * 10 : MAX_HP;
    p.hp = p.maxHp;
    p.alive = true;
    p.protectedUntil = this.time + SPAWN_PROTECTION;
    p.weapons = { knife: { mag: 0, reserve: 0 }, pistol: { mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve } };
    if (p.maceKit) p.weapons.mace = { mag: 0, reserve: 0 }; // /mace bleibt über den Tod hinaus
    p.peakY = 0;
    p.current = 'pistol';
    p.reloadUntil = 0;
    p.buffs = {};
    p.item = null;
    p.tid++;
    p.lastInputTime = this.time;
    this.broadcast({ t: 'spawn', id: p.id, x: round(p.x), y: 0, z: round(p.z), yaw: round(p.yaw), tid: p.tid });
    this.sendPrivate(p);
  }

  // ---------- Pickups ----------
  checkPickups(p) {
    for (const k of this.pickups) {
      if (!k.active || Math.hypot(k.x - p.x, k.z - p.z) > 1.5 || Math.abs(p.y - k.y) > 1.8) continue;
      if (k.kind === 'weapon') {
        const w = WEAPONS[k.type];
        const owned = p.weapons[k.type];
        if (owned) {
          if (owned.reserve >= w.reserve * 2) continue;
          owned.reserve = Math.min(w.reserve * 2, owned.reserve + w.mag * 2);
        } else {
          p.weapons[k.type] = { mag: w.mag, reserve: w.reserve };
          p.current = k.type;
          p.reloadUntil = 0;
        }
        k.respawnAt = this.time + WEAPON_RESPAWN;
      } else {
        if (!p.item) { p.item = this.rollItem(p); p.itemReadyAt = this.time + 1.2; }
        k.respawnAt = this.time + ITEMBOX_RESPAWN;
      }
      k.active = false;
      this.broadcast({ t: 'pick', p: this.pickupInfo(k), by: p.id });
      this.sendPrivate(p);
    }
  }

  // ---------- Bots ----------
  updateBot(p, dt) {
    const ai = p.ai;
    const diff = this.difficulty;
    if (this.has(p, 'stun')) { p.moving = false; return; }
    if (this.time >= ai.losAt) {
      ai.losAt = this.time + 0.3;
      let best = null, bestD = diff.view;
      for (const q of this.players.values()) {
        if (q === p || !q.alive) continue;
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < bestD && this.lineOfSight(p, q)) { best = q; bestD = d; }
      }
      const had = ai.target;
      ai.target = best ? best.id : null;
      if (best && had !== best.id) ai.reactAt = this.time + diff.reaction;
    }
    // beste Waffe mit Munition
    const wanted = BOT_WEAPON_PREF.find((id) => p.weapons[id] && (WEAPONS[id].melee || p.weapons[id].mag + p.weapons[id].reserve > 0));
    if (wanted && wanted !== p.current && p.reloadUntil <= this.time) p.current = wanted;
    const target = ai.target ? this.players.get(ai.target) : null;
    let moveX = 0, moveZ = 0;

    if (target && target.alive) {
      const dx = target.x - p.x, dz = target.z - p.z;
      const dist = Math.hypot(dx, dz);
      const wantYaw = Math.atan2(-dx, -dz);
      const wantPitch = Math.atan2(target.y + 1.2 - (p.y + EYE_HEIGHT), dist);
      const dyaw = ((wantYaw - p.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      p.yaw += Math.max(-5 * dt, Math.min(5 * dt, dyaw));
      p.pitch += (wantPitch - p.pitch) * Math.min(1, dt * 6);
      if (this.time > ai.strafeAt) { ai.strafe = this.rand() < 0.5 ? -1 : 1; ai.strafeAt = this.time + 0.8 + this.rand() * 1.5; }
      const fx = dx / dist, fz = dz / dist;
      const w = WEAPONS[p.current];
      const ideal = w.melee ? 1 : p.current === 'shotgun' ? 8 : p.current === 'sniper' ? 40 : 18;
      const fwd = dist > ideal + 4 ? 1 : dist < ideal - 6 ? -0.6 : 0;
      moveX = fx * fwd + -fz * ai.strafe * 0.8;
      moveZ = fz * fwd + fx * ai.strafe * 0.8;
      if (p.item && this.time >= p.itemReadyAt && this.rand() < 0.02) this.useItem(p, dirFromAngles(p.yaw, p.pitch));
      const ammo = p.weapons[p.current];
      if (this.time >= ai.reactAt && Math.abs(dyaw) < 0.25 && dist < w.range * 0.9 && this.rand() < diff.burst) {
        if (!w.melee && ammo.mag <= 0) this.startReload(p);
        else if (p.reloadUntil <= this.time && this.time - p.lastShot >= w.rate * 1.15) {
          const aim = dirFromAngles(p.yaw + (this.rand() - 0.5) * diff.aimError * 2, p.pitch + (this.rand() - 0.5) * diff.aimError);
          if (!w.melee) ammo.mag--;
          p.lastShot = this.time;
          this.fire(p, w, aim);
        }
      }
    } else {
      if (!ai.waypoint || Math.hypot(ai.waypoint.x - p.x, ai.waypoint.z - p.z) < 2) {
        const wants = this.pickups.filter((k) => k.active && k.y < 0.5 && (k.kind === 'itembox' ? !p.item : !p.weapons[k.type]));
        if (wants.length && this.rand() < 0.7) {
          wants.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
          ai.waypoint = { x: wants[0].x, z: wants[0].z };
        } else {
          ai.waypoint = { x: (this.rand() - 0.5) * 300, z: (this.rand() - 0.5) * 300 };
        }
      }
      const dx = ai.waypoint.x - p.x, dz = ai.waypoint.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      moveX = dx / d; moveZ = dz / d;
      const dyaw = ((Math.atan2(-dx, -dz) - p.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      p.yaw += Math.max(-4 * dt, Math.min(4 * dt, dyaw));
      p.pitch *= 0.9;
      const ammo = p.weapons[p.current];
      if (!WEAPONS[p.current].melee && ammo.mag < WEAPONS[p.current].mag * 0.5) this.startReload(p);
      if (p.item && this.time >= p.itemReadyAt && ['turbo', 'heart', 'shield', 'banana'].includes(p.item)) this.useItem(p);
    }

    if (this.time > ai.stuckCheck) {
      if (ai.stuckPos && Math.hypot(ai.stuckPos.x - p.x, ai.stuckPos.z - p.z) < 0.6) ai.waypoint = { x: p.x + (this.rand() - 0.5) * 40, z: p.z + (this.rand() - 0.5) * 40 };
      ai.stuckPos = { x: p.x, z: p.z };
      ai.stuckCheck = this.time + 1.2;
    }

    const len = Math.hypot(moveX, moveZ);
    p.moving = len > 0.1;
    p.sprinting = !target && len > 0.1;
    if (p.moving) {
      const speed = (p.sprinting ? SPRINT_SPEED * 0.85 : WALK_SPEED) * speedMultiplier(this.activeBuffs(p), p.cheats);
      p.x += (moveX / len) * speed * dt;
      p.z += (moveZ / len) * speed * dt;
      collide(this.world, p);
    }
    // Schwerkraft/Stufen für Bots
    const g = groundHeight(this.world, p.x, p.z, p.y);
    p.y = g < p.y ? Math.max(g, p.y - 12 * dt) : g;
  }

  lineOfSight(a, b) {
    const o = [a.x, a.y + EYE_HEIGHT, a.z];
    const t = [b.x, b.y + 1.3, b.z];
    const d = [t[0] - o[0], t[1] - o[1], t[2] - o[2]];
    const len = Math.hypot(...d);
    return raycastWorld(this.world, o, [d[0] / len, d[1] / len, d[2] / len], len) >= len - 0.5;
  }

  // ---------- Simulation ----------
  tick() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    this.time += dt;

    for (const p of this.players.values()) {
      if (!p.alive) {
        if (this.time >= p.respawnAt) this.respawn(p);
        continue;
      }
      if (p.reloadUntil && this.time >= p.reloadUntil) this.finishReload(p);
      for (const [type, until] of Object.entries(p.buffs)) {
        if (this.time >= until) { delete p.buffs[type]; this.sendPrivate(p); }
      }
      if (this.has(p, 'regen') && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + 8 * dt);
      if (p.bot) this.updateBot(p, dt);
      this.checkPickups(p);
    }
    // Superstern: Berührung schaltet Gegner aus
    for (const p of this.players.values()) {
      if (!p.alive || !this.has(p, 'star')) continue;
      for (const q of this.players.values()) {
        if (q !== p && q.alive && Math.hypot(q.x - p.x, q.z - p.z) < 1.4 && Math.abs(q.y - p.y) < 1.5) this.damage(q, 200, p, 'star');
      }
    }
    this.updateProjectiles(dt);

    for (const k of this.pickups) {
      if (!k.active && this.time >= k.respawnAt) {
        k.active = true;
        this.broadcast({ t: 'pick', p: this.pickupInfo(k) });
      }
    }

    // Snapshot an alle
    const snap = [];
    for (const p of this.players.values()) {
      const flags = (p.alive ? 1 : 0) | (p.moving ? 2 : 0) | (p.sprinting ? 4 : 0) | (p.reloadUntil > this.time ? 8 : 0) |
        (p.protectedUntil > this.time ? 16 : 0) | (this.has(p, 'star') ? 32 : 0) | (this.has(p, 'shrink') ? 64 : 0) | (p.ads ? 128 : 0) | (p.crouch ? 256 : 0);
      let bmask = 0;
      BUFF_ORDER.forEach((id, i) => { if (this.has(p, id)) bmask |= 1 << i; });
      snap.push([p.id, round(p.x), round(p.y), round(p.z), round(p.yaw, 1000), round(p.pitch, 1000), Math.ceil(p.hp), flags, WEAPON_ORDER.indexOf(p.current), bmask]);
    }
    const pr = this.projectiles.map((q) => [q.id, q.kind, round(q.x), round(q.y), round(q.z), round(q.vx), round(q.vy), round(q.vz)]);
    const tr = this.traps.map((q) => [q.id, round(q.x), round(q.y), round(q.z)]);
    this.broadcast({ t: 's', time: round(this.time, 1000), p: snap, pr, tr });
    this.scoreTimer -= dt;
    if (this.scoreTimer <= 0) { this.scoreTimer = 1; this.sendScores(); }
  }

  sendScores() {
    this.broadcast({ t: 'scores', s: [...this.players.values()].map((p) => [p.id, p.kills, p.deaths, p.bot ? 0 : p.ping]) });
  }

  /** Privater Zustand nur an den jeweiligen Spieler. */
  sendPrivate(p) {
    if (!p.ws) return;
    const buffs = {};
    for (const [k, until] of Object.entries(p.buffs)) if (until > this.time) buffs[k] = round(until - this.time, 10);
    this.send(p, {
      t: 'you', hp: Math.ceil(p.hp), maxHp: p.maxHp, cur: p.current, ammo: p.weapons, buffs,
      item: p.item, itemReady: p.item ? Math.max(0, round(p.itemReadyAt - this.time, 100)) : 0,
      reload: p.reloadUntil > this.time ? round(p.reloadUntil - this.time, 100) : 0,
      cheats: p.cheats, kit: !!p.maceKit,
    });
  }

  send(p, obj) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(obj));
  }

  broadcast(obj, except) {
    const data = JSON.stringify(obj);
    for (const p of this.players.values()) if (p !== except && p.ws && p.ws.readyState === 1) p.ws.send(data);
  }
}
