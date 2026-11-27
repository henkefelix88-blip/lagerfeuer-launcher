/**
 * Ego-Perspektive: Waffe + Hände in eigener Szene (wird über die Welt gezeichnet, clippt nie in Wände).
 *
 * Animationen je Waffe:
 *  - Laufen (Bobbing), Atmen, Maus-Schwanken, Sprinten (Waffe gesenkt), Ziehen beim Wechsel
 *  - Zielen mit Rechtsklick (Visier wandert in die Bildmitte, beim Sniper → Zielfernrohr)
 *  - Schuss: Rückstoß, Mündungsfeuer, Schlitten/Ladehebel, Patronenhülsen-Auswurf,
 *    Sniper repetiert (Kammerstängel hoch-zurück-vor-runter), Schrotflinte pumpt
 *  - Nachladen: Magazin raus (fällt herunter), linke Hand holt ein neues, Magazin rein, durchladen;
 *    Schrotflinte: Patrone für Patrone + Pumpen; Raketenwerfer: neue Rakete von vorne einsetzen
 *  - Messer: abwechselnder Hieb von rechts oben nach links unten und zurück
 */
import * as THREE from 'three';
import { createWeapon, createHand, PALETTE, mat } from './models.js';

const VM_SCALE = 0.62;
const HOME = {
  knife: new THREE.Vector3(0.17, -0.16, -0.42), pistol: new THREE.Vector3(0.15, -0.15, -0.5), smg: new THREE.Vector3(0.16, -0.16, -0.52),
  rifle: new THREE.Vector3(0.16, -0.16, -0.6), shotgun: new THREE.Vector3(0.16, -0.16, -0.6), sniper: new THREE.Vector3(0.17, -0.17, -0.62),
  rocket: new THREE.Vector3(0.22, -0.17, -0.72), mace: new THREE.Vector3(0.2, -0.2, -0.46),
};
const RELOAD_KIND = { pistol: 'mag', smg: 'mag', rifle: 'mag', sniper: 'mag', shotgun: 'shells', rocket: 'rocket' };
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (k) => k * k * (3 - 2 * k);
const seg = (k, a, b) => Math.max(0, Math.min(1, (k - a) / (b - a)));

export class ViewModel {
  constructor(aspect) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.01, 10);
    this.scene.add(new THREE.HemisphereLight('#e6f4ff', '#6b8a4a', 2.2));
    const sun = new THREE.DirectionalLight('#fff0d2', 1.8);
    sun.position.set(1, 2, 1);
    this.scene.add(sun);
    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.rigs = {};
    for (const id of Object.keys(HOME)) {
      const w = createWeapon(id);
      w.group.visible = false;
      w.group.scale.setScalar(VM_SCALE);
      const handR = createHand(1);
      handR.position.copy(w.gripR);
      handR.rotation.x = id === 'knife' || id === 'mace' ? 0 : -0.25;
      w.group.add(handR);
      const handL = createHand(-1);
      handL.position.copy(w.gripL);
      handL.rotation.set(-0.2, 0.3, 0.6);
      if (id === 'knife' || id === 'mace') { handL.position.set(-0.25, -0.25, 0.1); handL.visible = false; }
      (w.pump || w.group).add(handL);
      if (w.pump) handL.position.sub(w.pump.position);
      const handLHome = handL.position.clone();
      // Ersatzteil, das die linke Hand beim Nachladen trägt (neues Magazin / Rakete)
      let spare = null;
      if (w.mag) { spare = w.mag.clone(); spare.visible = false; handL.add(spare); spare.position.set(0, -0.02, -0.02); spare.rotation.set(0, 0, 0); }
      if (w.tip) { spare = w.tip.clone(); spare.visible = false; handL.add(spare); spare.position.set(0, 0.06, -0.08); }
      this.root.add(w.group);
      this.rigs[id] = { w, handR, handL, handLHome, spare, loaded: true, slashDir: 1 };
    }

    // Mündungsfeuer (zwei gekreuzte Sterne, additiv)
    const flashMat = new THREE.MeshBasicMaterial({ map: makeFlashTexture(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.flash = new THREE.Group();
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.32), flashMat);
    const p2 = p1.clone(); p2.rotation.y = Math.PI / 2;
    this.flash.add(p1, p2);
    this.flash.visible = false;

    this.debris = []; // ausgeworfene Hülsen / fallende Magazine
    this.current = null;
    this.t = 0;
    this.recoil = 0;
    this.roll = 0;
    this.shotT = 99;
    this.flashTime = 0;
    this.reload = null;
    this.switchAnim = 0;
    this.sprintBlend = 0;
    this.adsBlend = 0;
    this.slash = null;
    this.slam = null;
    this.bob = 0;
    this.sway = new THREE.Vector2();
  }

  get rig() { return this.rigs[this.current]; }
  /** Sniper voll angelegt → Zielfernrohr-Overlay statt Waffe. */
  get scoped() { return this.current === 'sniper' && this.adsBlend > 0.85; }

  setWeapon(id) {
    if (this.current === id || !this.rigs[id]) return;
    if (this.current) this.rig.w.group.visible = false;
    this.current = id;
    const r = this.rig;
    r.w.group.visible = true;
    r.w.muzzle.add(this.flash);
    this.switchAnim = 1;
    this.reload = null;
    this.slash = null;
    this.shotT = 99;
    this.resetParts(r);
  }

  resetParts(r) {
    for (const k of ['mag', 'bolt', 'pump', 'tip']) {
      const part = r.w[k];
      if (!part) continue;
      part.position.copy(r.w.homes[k].pos);
      part.rotation.copy(r.w.homes[k].rot);
      part.visible = k !== 'tip' || r.loaded;
    }
    r.handL.position.copy(r.handLHome);
    if (r.spare) r.spare.visible = false;
  }

  /** Für den Raketenwerfer: ist eine Rakete geladen (Spitze sichtbar)? */
  setLoaded(loaded) {
    const r = this.rigs.rocket;
    if (r.loaded === loaded) return;
    r.loaded = loaded;
    if (!this.reload || this.current !== 'rocket') r.w.tip.visible = loaded;
  }

  shoot() {
    const id = this.current;
    this.shotT = 0;
    if (id === 'mace') { this.slam = { t: 0 }; return; }
    if (id === 'knife') {
      this.rig.slashDir *= -1;
      this.slash = { t: 0, dir: this.rig.slashDir };
      return;
    }
    this.recoil = 1;
    this.roll = (Math.random() - 0.5) * 0.12;
    this.flashTime = 0.05;
    this.flash.rotation.z = Math.random() * Math.PI;
    this.flash.scale.setScalar({ shotgun: 1.6, rocket: 2.2, sniper: 1.4, pistol: 0.8, smg: 0.7 }[id] || 1);
    if (id === 'rocket') this.setLoaded(false);
    if (id === 'pistol' || id === 'smg' || id === 'rifle') this.ejectShell(PALETTE.brass, 0);
  }

  startReload(duration) {
    if (!RELOAD_KIND[this.current]) return;
    this.reload = { start: this.t, duration, kind: RELOAD_KIND[this.current], dropped: false };
  }
  cancelReload() {
    if (!this.reload) return;
    this.reload = null;
    this.resetParts(this.rig);
  }

  addSway(dx, dy) {
    const k = 1 - this.adsBlend * 0.8;
    this.sway.x = Math.max(-0.05, Math.min(0.05, this.sway.x - dx * 0.0004 * k));
    this.sway.y = Math.max(-0.05, Math.min(0.05, this.sway.y + dy * 0.0004 * k));
  }

  /** Hülse/Magazin in Kamerakoordinaten auswerfen. */
  ejectShell(color, delay, from = null, isMag = false) {
    const r = this.rig;
    const mesh = isMag ? from.clone() : new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.028, 6), mat(color, { shiny: true }));
    if (this.current === 'shotgun' && !isMag) mesh.scale.set(1.8, 1.6, 1.8);
    const pos = new THREE.Vector3();
    (from || r.w.group).localToWorld(pos.copy(isMag ? new THREE.Vector3() : r.w.eject));
    mesh.position.copy(pos);
    if (isMag) { from.getWorldQuaternion(mesh.quaternion); mesh.scale.setScalar(VM_SCALE); }
    mesh.visible = delay <= 0;
    this.scene.add(mesh);
    this.debris.push({
      mesh, delay, life: isMag ? 0.7 : 0.6,
      vel: isMag ? new THREE.Vector3(0, -0.4, 0) : new THREE.Vector3(0.9 + Math.random() * 0.4, 0.8 + Math.random() * 0.4, 0.2),
      spin: new THREE.Vector3(Math.random() * 20, Math.random() * 20, Math.random() * 20),
    });
  }

  /**
   * @param {{speed:number, sprinting:boolean, onGround:boolean, ads:boolean}} s
   */
  update(dt, s) {
    this.t += dt;
    this.shotT += dt;
    this.updateDebris(dt);
    if (!this.current) return;
    const id = this.current;
    const r = this.rig;
    const w = r.w;
    const home = HOME[id];

    // Zielen
    const canAds = s.ads && id !== 'knife' && id !== 'mace' && !this.reload;
    this.adsBlend += ((canAds ? 1 : 0) - this.adsBlend) * Math.min(1, dt * 12);
    const ads = this.adsBlend;
    // Visierpunkt in die Bildmitte
    const adsPos = new THREE.Vector3(-w.sight.x * VM_SCALE, -w.sight.y * VM_SCALE, -0.28 - w.sight.z * VM_SCALE);

    // Laufen / Atmen
    const moving = s.speed > 0.5 && s.onGround;
    this.bob += dt * (s.sprinting ? 13 : 9) * (moving ? 1 : 0);
    const amp = (moving ? (s.sprinting ? 0.028 : 0.014) : 0.003) * (1 - ads * 0.85);
    const bobX = Math.sin(this.bob) * amp;
    const bobY = -Math.abs(Math.cos(this.bob)) * amp + Math.sin(this.t * 1.6) * 0.003 * (1 - ads);
    this.sprintBlend += ((s.sprinting && moving && !this.reload && !this.slash && ads < 0.1 ? 1 : 0) - this.sprintBlend) * Math.min(1, dt * 10);
    this.sway.multiplyScalar(Math.max(0, 1 - dt * 8));
    this.recoil = Math.max(0, this.recoil - dt * ({ shotgun: 4, sniper: 3, rocket: 3 }[id] || 10));
    this.switchAnim = Math.max(0, this.switchAnim - dt * 3);
    const rec = this.recoil * this.recoil;

    let px = lerp(home.x, adsPos.x, ads) + bobX + this.sway.x;
    let py = lerp(home.y, adsPos.y, ads) + bobY + this.sway.y;
    let pz = lerp(home.z, adsPos.z, ads);
    let rx = 0, ry = 0, rz = 0;
    const kickZ = { shotgun: 0.12, sniper: 0.1, rocket: 0.14, pistol: 0.05, smg: 0.025, rifle: 0.04 }[id] || 0.05;
    const kickR = { shotgun: 0.35, sniper: 0.3, rocket: 0.25, pistol: 0.2, smg: 0.06, rifle: 0.1 }[id] || 0.1;
    pz += rec * kickZ * (1 - ads * 0.5);
    rx += rec * kickR * (1 - ads * 0.6);
    rz += rec * this.roll;
    rx -= this.sprintBlend * 0.5; ry += this.sprintBlend * 0.6; px -= this.sprintBlend * 0.05; py -= this.sprintBlend * 0.05;
    const sw = ease(this.switchAnim);
    py -= sw * 0.3; rx -= sw * 0.9;

    // --- bewegliche Teile nach dem Schuss ---
    if (w.bolt && id !== 'sniper') { // Schlitten/Ladehebel springt zurück
      const k = this.shotT < 0.09 ? Math.sin((this.shotT / 0.09) * Math.PI) : 0;
      w.bolt.position.z = w.homes.bolt.pos.z + k * (id === 'pistol' ? 0.05 : 0.03);
    }
    if (id === 'sniper' && !this.reload) this.animBolt(w, this.shotT, 0.25, 0.9);
    if (id === 'sniper' && this.shotT > 0.55 && this.shotT - dt <= 0.55) this.ejectShell(PALETTE.brass, 0);
    if (id === 'shotgun' && !this.reload) {
      const k = seg(this.shotT, 0.25, 0.6);
      w.pump.position.z = w.homes.pump.pos.z + Math.sin(k * Math.PI) * 0.12;
      if (this.shotT > 0.42 && this.shotT - dt <= 0.42) this.ejectShell(PALETTE.red, 0);
      ry -= Math.sin(k * Math.PI) * 0.08;
    }

    // --- Messer-Hieb ---
    if (this.slash) {
      this.slash.t += dt;
      const k = this.slash.t / 0.32;
      if (k >= 1) this.slash = null;
      else {
        const e = Math.sin(k * Math.PI);
        const d = this.slash.dir;
        const sweep = lerp(-1, 1, ease(Math.min(1, k * 1.4))) * d;
        px += -sweep * 0.12 * e; py += 0.03 * e - Math.abs(sweep) * 0.02;
        pz -= 0.12 * e;
        rz += sweep * 0.9 * e; ry += 0.5 * e * d; rx += 0.3 * e;
      }
    }

    // --- Streitkolben-Schlag: weit ausholen, dann kraftvoll nach unten schlagen ---
    if (this.slam) {
      this.slam.t += dt;
      const k = this.slam.t / 0.45;
      if (k >= 1) this.slam = null;
      else {
        const up = k < 0.35 ? ease(k / 0.35) : 1 - ease(Math.min(1, (k - 0.35) / 0.25));
        const down = k < 0.35 ? 0 : k < 0.6 ? ease((k - 0.35) / 0.25) : 1 - ease((k - 0.6) / 0.4);
        rx += up * 1.3 - down * 1.1; py += up * 0.12 - down * 0.08; pz += up * 0.08 - down * 0.15; px -= down * 0.06; rz += up * 0.3;
      }
    }
    // Im freien Fall mit dem Streitkolben: Waffe zum Schlag erhoben (zeigt "Smash bereit")
    if (id === 'mace' && s.smashReady && !this.slam) { rx += 0.7; py += 0.05; }

    // --- Nachladen ---
    if (this.reload) {
      const k = (this.t - this.reload.start) / this.reload.duration;
      if (k >= 1) { this.reload = null; this.resetParts(r); if (id === 'rocket') this.setLoaded(true); }
      else {
        const res = this.reload.kind === 'mag' ? this.animMagReload(r, k) : this.reload.kind === 'shells' ? this.animShellReload(r, k) : this.animRocketReload(r, k);
        rx += res.rx; ry += res.ry; rz += res.rz; py += res.py; px += res.px || 0;
      }
    }

    w.group.position.set(px, py, pz);
    w.group.rotation.set(rx, ry, rz);
    w.group.visible = !this.scoped;
    this.flashTime -= dt;
    this.flash.visible = this.flashTime > 0 && !this.scoped;
  }

  animBolt(w, t, a, b) {
    const k = seg(t, a, b);
    const up = k < 0.25 ? k / 0.25 : k > 0.75 ? (1 - k) / 0.25 : 1;
    const back = k < 0.25 ? 0 : k < 0.5 ? (k - 0.25) / 0.25 : k < 0.75 ? 1 - (k - 0.5) / 0.25 : 0;
    w.bolt.rotation.z = w.homes.bolt.rot.z - ease(up) * 1.1;
    w.bolt.position.z = w.homes.bolt.pos.z + ease(back) * 0.09;
  }

  /** Magazin-Wechsel: Waffe kippen, altes Magazin fällt, Hand bringt neues, Durchladen. */
  animMagReload(r, k) {
    const w = r.w;
    const tilt = ease(k < 0.12 ? k / 0.12 : k > 0.9 ? (1 - k) / 0.1 : 1);
    const magHome = w.homes.mag.pos;
    const handAtMag = magHome.clone().add(new THREE.Vector3(-0.01, -0.05, 0.01));
    const offscreen = magHome.clone().add(new THREE.Vector3(-0.15, -0.45, 0.1));
    const hand = r.handL.position;
    let magDown = 0;
    if (k < 0.15) hand.copy(r.handLHome);
    else if (k < 0.3) hand.lerpVectors(r.handLHome, handAtMag, ease(seg(k, 0.15, 0.3)));
    else if (k < 0.42) { hand.copy(handAtMag); magDown = ease(seg(k, 0.3, 0.42)); }
    else if (k < 0.55) hand.lerpVectors(handAtMag, offscreen, ease(seg(k, 0.42, 0.55)));
    else if (k < 0.7) hand.lerpVectors(offscreen, handAtMag.clone().add(new THREE.Vector3(0, -0.12, 0)), ease(seg(k, 0.55, 0.7)));
    else if (k < 0.78) hand.lerpVectors(handAtMag.clone().add(new THREE.Vector3(0, -0.12, 0)), handAtMag, ease(seg(k, 0.7, 0.78)));
    else hand.lerpVectors(handAtMag, r.handLHome, ease(seg(k, 0.78, 0.92)));
    // Magazin-Zustand
    if (k < 0.42) { w.mag.visible = true; w.mag.position.copy(magHome).add(new THREE.Vector3(0, -magDown * 0.12, 0)); }
    else if (k < 0.78) {
      if (!this.reload.dropped) { this.reload.dropped = true; this.ejectShell(null, 0, w.mag, true); }
      w.mag.visible = false;
    } else { w.mag.visible = true; w.mag.position.copy(magHome); }
    r.spare.visible = k >= 0.55 && k < 0.78;
    if (k > 0.55 && k < 0.78) r.spare.position.set(0, 0.04, -0.02);
    // Durchladen am Ende
    if (w.bolt) {
      if (this.current === 'sniper') this.animBolt(w, k, 0.8, 0.98);
      else w.bolt.position.z = w.homes.bolt.pos.z + Math.sin(seg(k, 0.82, 0.92) * Math.PI) * 0.06;
    }
    return { rx: tilt * 0.25, ry: tilt * 0.15, rz: tilt * 0.55, py: -tilt * 0.06 + (k > 0.7 && k < 0.78 ? 0.01 : 0) };
  }

  /** Schrotflinte: Patrone für Patrone einschieben, am Ende pumpen. */
  animShellReload(r, k) {
    const w = r.w;
    const tilt = ease(k < 0.1 ? k / 0.1 : k > 0.88 ? (1 - k) / 0.12 : 1);
    const loops = 4;
    const lk = seg(k, 0.1, 0.8) * loops;
    const phase = lk % 1;
    const port = new THREE.Vector3(0.0, -0.09, 0.02).sub(w.pump.position);
    const below = port.clone().add(new THREE.Vector3(-0.08, -0.22, 0.05));
    if (k > 0.1 && k < 0.8) {
      r.handL.position.lerpVectors(below, port, Math.sin(phase * Math.PI));
      r.spare = r.spare || null;
    } else if (k >= 0.8) {
      r.handL.position.lerpVectors(port, r.handLHome, ease(seg(k, 0.8, 0.86)));
    } else r.handL.position.lerpVectors(r.handLHome, below, ease(seg(k, 0, 0.1)));
    const pumpK = seg(k, 0.86, 0.98);
    w.pump.position.z = w.homes.pump.pos.z + Math.sin(pumpK * Math.PI) * 0.12;
    return { rx: tilt * 0.1, ry: -tilt * 0.2, rz: -tilt * 0.45, py: -tilt * 0.04 + (k > 0.1 && k < 0.8 ? Math.sin(phase * Math.PI) * 0.006 : 0) };
  }

  /** Raketenwerfer: Rohr anheben, neue Rakete von vorne einschieben. */
  animRocketReload(r, k) {
    const w = r.w;
    const tilt = ease(k < 0.2 ? k / 0.2 : k > 0.85 ? (1 - k) / 0.15 : 1);
    const front = w.homes.tip.pos.clone().add(new THREE.Vector3(-0.05, -0.05, -0.25));
    const below = front.clone().add(new THREE.Vector3(-0.1, -0.4, 0.2));
    if (k < 0.2) r.handL.position.lerpVectors(r.handLHome, below, ease(seg(k, 0, 0.2)));
    else if (k < 0.5) r.handL.position.lerpVectors(below, front, ease(seg(k, 0.2, 0.5)));
    else if (k < 0.7) r.handL.position.lerpVectors(front, w.homes.tip.pos.clone().add(new THREE.Vector3(-0.05, -0.05, 0.02)), ease(seg(k, 0.5, 0.7)));
    else r.handL.position.lerpVectors(w.homes.tip.pos, r.handLHome, ease(seg(k, 0.7, 0.85)));
    r.spare.visible = k > 0.2 && k < 0.68;
    w.tip.visible = k >= 0.68;
    return { rx: tilt * 0.35, ry: -tilt * 0.3, rz: tilt * 0.2, py: -tilt * 0.08, px: -tilt * 0.05 };
  }

  updateDebris(dt) {
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const d = this.debris[i];
      if (d.delay > 0) { d.delay -= dt; if (d.delay <= 0) d.mesh.visible = true; continue; }
      d.life -= dt;
      d.vel.y -= 4 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.y += d.spin.y * dt;
      if (d.life <= 0) { this.scene.remove(d.mesh); this.debris.splice(i, 1); }
    }
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }
}

function makeFlashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.translate(32, 32);
  ctx.fillStyle = '#ffd25a';
  ctx.beginPath();
  for (let i = 0; i < 12; i++) {
    const r = i % 2 ? 9 : 30;
    const a = (i / 12) * Math.PI * 2;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.fill();
  ctx.fillStyle = '#fff6d0';
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
