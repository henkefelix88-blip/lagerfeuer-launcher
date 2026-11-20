/**
 * HUD: Leben, Ausdauer, Munition, Waffen-Slots, Buffs (mit Restzeit), Item-Slot mit Roulette,
 * Fadenkreuz, Zielfernrohr, Hitmarker, Schadensrichtung, Kill-Feed, Chat, Meldungen,
 * Scoreboard (Tab), Todesbildschirm, Tinten-Kleckse, Blitz-Effekt.
 */
import { WEAPONS, WEAPON_ORDER, BUFFS, ITEMS, ITEM_ORDER } from '../../shared/world.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hex = (fill, inner) => `<svg viewBox="0 0 30 30"><polygon points="15,1 28,8 28,22 15,29 2,22 2,8" fill="${fill}"/>${inner}</svg>`;

/** Icons im selben flachen Stil wie die 3D-Modelle. */
export const ICONS = {
  turbo: hex('#3b2416', '<ellipse cx="15" cy="12" rx="10" ry="6" fill="#ff8a2a"/><circle cx="11" cy="11" r="2" fill="#fff"/><circle cx="19" cy="10" r="1.6" fill="#fff"/><rect x="11" y="16" width="8" height="8" fill="#f4e3c8"/>'),
  star: hex('#3b3416', '<polygon points="15,4 18,12 26,12 20,17 22,25 15,20 8,25 10,17 4,12 12,12" fill="#ffd84d"/><circle cx="13" cy="14" r="1.2" fill="#3b3416"/><circle cx="17" cy="14" r="1.2" fill="#3b3416"/>'),
  lightning: hex('#2c2a16', '<polygon points="17,3 8,17 14,17 12,27 22,12 16,12" fill="#ffe14d"/>'),
  greenShell: hex('#1b3322', '<ellipse cx="15" cy="17" rx="10" ry="7" fill="#f4f1e6"/><ellipse cx="15" cy="14" rx="9" ry="7" fill="#3fb35a"/><circle cx="15" cy="13" r="2.5" fill="#f4f1e6"/>'),
  redShell: hex('#3a1b1b', '<ellipse cx="15" cy="17" rx="10" ry="7" fill="#f4f1e6"/><ellipse cx="15" cy="14" rx="9" ry="7" fill="#d8433a"/><circle cx="15" cy="13" r="2.5" fill="#f4f1e6"/>'),
  banana: hex('#33301a', '<path d="M8 8 Q10 24 24 22 Q14 20 11 7 Z" fill="#f6d743"/><rect x="7" y="5" width="3" height="4" fill="#7a5a20"/>'),
  ink: hex('#1e1b2e', '<circle cx="15" cy="15" r="8" fill="#6a5acd"/><circle cx="8" cy="9" r="3" fill="#6a5acd"/><circle cx="23" cy="20" r="3.5" fill="#6a5acd"/><circle cx="21" cy="8" r="2" fill="#6a5acd"/>'),
  heart: hex('#3a1b24', '<path d="M15 25 L5 14 A5 5 0 0 1 15 9 A5 5 0 0 1 25 14 Z" fill="#ff5a7a"/>'),
  shield: hex('#1d2840', '<polygon points="15,5 24,10 24,20 15,25 6,20 6,10" fill="#5b8def"/><polygon points="15,9 20,12 20,18 15,21 10,18 10,12" fill="#dfe8ff"/>'),
  damage: hex('#3b1f1b', '<polygon points="15,4 21,15 15,26 9,15" fill="#f0503a"/><polygon points="15,4 21,15 15,15" fill="#ffd25a"/>'),
  regen: hex('#3a2427', '<polygon points="12,7 18,7 18,12 23,12 23,18 18,18 18,23 12,23 12,18 7,18 7,12 12,12" fill="#e2534a"/>'),
  shrink: hex('#2a2340', '<polygon points="15,6 22,13 18,13 18,24 12,24 12,13 8,13" fill="#a77bff" transform="rotate(180 15 15)"/>'),
  stun: hex('#33301a', '<circle cx="15" cy="15" r="8" fill="none" stroke="#f2d24e" stroke-width="3" stroke-dasharray="6 4"/>'),
};

export class Hud {
  constructor(keyName) {
    this.keyName = keyName;
    this.buffState = {};
    this.hitTimer = null;
    this.item = null;
    this.rouletteT = 0;
    this.rouletteIdx = 0;
    this.chatOpen = false;
  }

  setHealth(hp, maxHp, shield, star) {
    const v = Math.max(0, Math.ceil(hp));
    $('hp-value').textContent = v;
    const bar = $('hp-bar');
    bar.style.width = `${Math.min(100, (v / maxHp) * 100)}%`;
    bar.className = star ? 'star' : shield ? 'shield' : v <= maxHp * 0.3 ? 'low' : '';
    $('hp-max').textContent = maxHp > 100 ? `/ ${maxHp}` : '';
  }

  setStamina(s, max, exhausted) {
    const bar = $('stamina-bar');
    bar.style.width = `${(s / max) * 100}%`;
    bar.classList.toggle('tired', exhausted);
  }

  setWeapon(current, ammo, reloading, infinite) {
    const w = WEAPONS[current];
    const a = ammo[current] || { mag: 0, reserve: 0 };
    $('weapon-name').textContent = w.name;
    $('ammo-mag').textContent = w.melee ? '' : infinite ? '∞' : a.mag;
    $('ammo-mag').classList.toggle('empty', !w.melee && !infinite && a.mag === 0);
    $('ammo-res').textContent = w.melee ? 'Nahkampf' : infinite ? '' : `/ ${a.reserve}`;
    const hint = $('reload-hint');
    hint.classList.toggle('hidden', w.melee || infinite || !(reloading || (a.mag <= Math.ceil(w.mag * 0.25) && a.reserve > 0)));
    hint.textContent = reloading ? 'LÄDT NACH …' : `NACHLADEN [${this.keyName('reload')}]`;
    $('slots').innerHTML = WEAPON_ORDER.map((id, i) => ammo[id]
      ? `<span class="slot owned ${id === current ? 'active' : ''}">${i + 1} ${WEAPONS[id].name}</span>` : '').join('');
  }

  /** @param {Record<string, number>} buffs Restsekunden je Buff */
  setBuffs(buffs) {
    for (const [type, rem] of Object.entries(buffs)) {
      const prev = this.buffState[type];
      this.buffState[type] = { remaining: rem, duration: prev && prev.remaining >= rem ? prev.duration : Math.max(rem, BUFFS[type].duration) };
    }
    for (const type of Object.keys(this.buffState)) if (!(type in buffs)) delete this.buffState[type];
    this.renderBuffs();
  }

  tick(dt) {
    let changed = false;
    for (const s of Object.values(this.buffState)) { s.remaining = Math.max(0, s.remaining - dt); changed = true; }
    if (changed) this.renderBuffs();
    // Item-Roulette
    if (this.item && this.rouletteT > 0) {
      this.rouletteT -= dt;
      this.rouletteAcc = (this.rouletteAcc || 0) + dt;
      if (this.rouletteAcc > 0.07) {
        this.rouletteAcc = 0;
        this.rouletteIdx = (this.rouletteIdx + 1) % ITEM_ORDER.length;
        $('item-icon').innerHTML = ICONS[ITEM_ORDER[this.rouletteIdx]];
        return 'tick';
      }
      if (this.rouletteT <= 0) { this.renderItem(); return 'done'; }
    }
    return null;
  }

  renderBuffs() {
    $('buffs').innerHTML = Object.entries(this.buffState).map(([type, s]) => {
      const def = BUFFS[type];
      return `<div class="pu ${def.debuff ? 'debuff' : ''}">${ICONS[type] || ''}<div><div class="name">${def.name}</div><div class="bar"><div style="width:${(s.remaining / s.duration) * 100}%;background:${def.color}"></div></div></div><div class="sec">${Math.ceil(s.remaining)}s</div></div>`;
    }).join('');
  }

  /** Item im Slot setzen; neue Items laufen zuerst als Roulette durch. */
  setItem(item, readyIn) {
    if (item === this.item) return;
    const isNew = item && !this.item;
    this.item = item;
    $('item-box').classList.toggle('empty', !item);
    if (isNew && readyIn > 0) { this.rouletteT = readyIn; $('item-name').textContent = '…'; }
    else { this.rouletteT = 0; this.renderItem(); }
  }

  renderItem() {
    $('item-icon').innerHTML = this.item ? ICONS[this.item] : '';
    $('item-name').textContent = this.item ? `${ITEMS[this.item].name} [${this.keyName('item')}]` : '';
  }

  setCrosshairSpread(px, hidden) {
    $('crosshair').style.setProperty('--gap', `${Math.round(px)}px`);
    $('crosshair').classList.toggle('hidden', hidden);
  }

  setScope(on) { $('scope').classList.toggle('hidden', !on); }

  hitmarker(kill) {
    const el = $('hitmarker');
    el.className = `show${kill ? ' kill' : ''}`;
    clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => (el.className = kill ? 'kill' : ''), kill ? 220 : 90);
  }

  damage(angle) {
    const v = $('damage-vignette');
    v.style.transition = 'none';
    v.style.opacity = 0.7;
    requestAnimationFrame(() => { v.style.transition = 'opacity .5s'; v.style.opacity = 0; });
    const d = $('damage-dir');
    d.style.transform = `rotate(${-angle}rad)`;
    d.style.transition = 'none';
    d.style.opacity = 1;
    requestAnimationFrame(() => { d.style.transition = 'opacity .9s'; d.style.opacity = 0; });
  }

  flash(color) {
    const f = $('screen-flash');
    f.style.background = color;
    f.style.transition = 'none';
    f.style.opacity = 0.75;
    requestAnimationFrame(() => { f.style.transition = 'opacity .6s'; f.style.opacity = 0; });
  }

  setInk(on) {
    const el = $('ink');
    if (on && !el.childElementCount) {
      for (let i = 0; i < 9; i++) {
        const s = document.createElement('div');
        const size = 140 + Math.random() * 260;
        Object.assign(s.style, { width: `${size}px`, height: `${size * (0.7 + Math.random() * 0.5)}px`, left: `${Math.random() * 85}%`, top: `${Math.random() * 80}%`, transform: `rotate(${Math.random() * 360}deg)` });
        el.append(s);
      }
    }
    if (!on) el.innerHTML = '';
  }

  killfeed(killerName, killerColor, victimName, victimColor, weapon, head, involvesMe) {
    const names = { star: 'Superstern', banana: 'Bananenschale', greenShell: 'Abprall-Kugel', redShell: 'Such-Kugel', lightning: 'Blitz' };
    const el = document.createElement('div');
    el.className = `kf${involvesMe ? ' me' : ''}`;
    el.innerHTML = killerName === victimName
      ? `<span style="color:${victimColor}">${esc(victimName)}</span><span class="w">hat sich selbst erwischt</span>`
      : `<span style="color:${killerColor}">${esc(killerName)}</span><span class="w">[${WEAPONS[weapon]?.name || names[weapon] || weapon}]</span>${head ? '<span class="hs">KOPFTREFFER</span>' : ''}<span style="color:${victimColor}">${esc(victimName)}</span>`;
    $('killfeed').prepend(el);
    while ($('killfeed').children.length > 6) $('killfeed').lastChild.remove();
    setTimeout(() => el.remove(), 6000);
  }

  message(text, cls = '') {
    const el = document.createElement('div');
    el.textContent = text;
    if (cls) el.className = cls;
    $('messages').append(el);
    while ($('messages').children.length > 5) $('messages').firstChild.remove();
    setTimeout(() => el.remove(), 5000);
  }

  // ---------- Chat ----------
  chat(name, color, text) {
    const el = document.createElement('div');
    el.className = 'line';
    el.innerHTML = `<b style="color:${color}">${esc(name)}:</b> ${esc(text)}`;
    $('chat-log').append(el);
    while ($('chat-log').children.length > 40) $('chat-log').firstChild.remove();
    el.dataset.until = performance.now() + 10000;
    $('chat-log').scrollTop = 1e9;
    this.refreshChat();
  }
  openChat() {
    this.chatOpen = true;
    $('chat').classList.add('open');
    const input = $('chat-input');
    input.value = '';
    input.focus();
    this.refreshChat();
  }
  closeChat() {
    this.chatOpen = false;
    $('chat').classList.remove('open');
    $('chat-input').blur();
    this.refreshChat();
  }
  refreshChat() {
    const now = performance.now();
    for (const l of $('chat-log').children) l.classList.toggle('faded', !this.chatOpen && Number(l.dataset.until) < now);
  }

  setScoreboard(visible, rows, myId) {
    $('scoreboard').classList.toggle('hidden', !visible);
    if (!visible) return;
    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    $('score-rows').innerHTML = rows.map((r) => `<tr class="${r.id === myId ? 'me' : ''}">
      <td><span class="dot" style="background:${r.color}"></span></td><td>${esc(r.name)}</td><td>${r.kills}</td><td>${r.deaths}</td>
      <td>${(r.kills / Math.max(1, r.deaths)).toFixed(2)}</td><td>${r.bot ? 'BOT' : `${r.ping} ms`}</td></tr>`).join('');
  }

  setDeath(visible, killerName, seconds) {
    $('death').classList.toggle('hidden', !visible);
    if (visible) {
      $('death-by').textContent = killerName ? `von ${killerName}` : '';
      $('death-timer').textContent = seconds > 0 ? `Respawn in ${Math.ceil(seconds)} …` : 'Respawn …';
    }
  }

  setSpawnProtection(on) { $('spawn-protect').classList.toggle('hidden', !on); }
  setCheats(cheats) {
    const list = [cheats.god && 'GOD', cheats.trigger && 'TRIGGER', cheats.life && '10× LEBEN'].filter(Boolean);
    $('cheat-badge').textContent = list.join(' · ');
    $('cheat-badge').classList.toggle('hidden', !list.length);
  }

  setInfo(ping, fps) {
    $('ping').textContent = `${ping} ms`;
    $('fps').textContent = `${fps} FPS`;
  }
}
