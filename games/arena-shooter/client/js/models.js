/**
 * Low-Poly-Modelle (prozedural aus Grundkörpern, flache Schattierung, einheitliche Palette):
 * Waffen (mit beweglichen Teilen für Animationen), Hände, Spielerfiguren, Pickups, Item-Boxen, Projektile.
 */
import * as THREE from 'three';

export const PALETTE = {
  metal: '#3a4048', dark: '#23272d', light: '#9aa4b0', steel: '#c9d1da', wood: '#a0703f', woodDark: '#7a5230',
  olive: '#5d6a3f', sand: '#b89b6a', skin: '#f0c49a', glove: '#2f3540', sleeve: '#4a5568', pants: '#3b4656',
  boots: '#2b2f36', visor: '#1f2a36', fire: '#f08c32', flame: '#ffd25a', red: '#d8433a', brass: '#d9a441',
};

const matCache = new Map();
/** Gemeinsame flach schattierte Materialien (eine Instanz je Farbe/Option). shiny = glänzendes Metall. */
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) {
    const { shiny, ...rest } = opts;
    matCache.set(key, shiny
      ? new THREE.MeshPhongMaterial({ color, flatShading: true, shininess: 70, specular: '#555a60', ...rest })
      : new THREE.MeshLambertMaterial({ color, flatShading: true, ...rest }));
  }
  return matCache.get(key);
}

export function box(w, h, d, color, x = 0, y = 0, z = 0, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.set(x, y, z);
  return m;
}
export function cyl(rt, rb, h, seg, color, x = 0, y = 0, z = 0, alongZ = false, opts) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, opts));
  m.position.set(x, y, z);
  if (alongZ) m.rotation.x = Math.PI / 2;
  return m;
}
const SHINY = { shiny: true };

/**
 * Waffenmodell. Lauf zeigt nach -Z, Einheiten in Metern.
 * Rückgabe: { group, muzzle, mag, bolt, pump, tip, sight, gripR, gripL, eject, homes{} }
 *  - sight: Punkt, der beim Zielen (Rechtsklick) in die Bildmitte wandert
 *  - gripR/gripL: wo die rechte/linke Hand greift
 *  - eject: Auswurföffnung für Patronenhülsen
 */
export function createWeapon(id) {
  const g = new THREE.Group();
  const muzzle = new THREE.Object3D();
  const parts = { mag: null, bolt: null, pump: null, tip: null };
  let sight = new THREE.Vector3(0, 0.08, 0), gripR = new THREE.Vector3(0, -0.08, 0.08), gripL = new THREE.Vector3(0, -0.04, -0.2), eject = new THREE.Vector3(0.04, 0.05, 0);

  if (id === 'knife') {
    g.add(box(0.035, 0.045, 0.13, PALETTE.dark, 0, 0, 0.06));                // Griff
    for (let i = 0; i < 4; i++) g.add(box(0.038, 0.01, 0.012, PALETTE.metal, 0, 0.022, 0.015 + i * 0.03)); // Rillen
    g.add(box(0.05, 0.06, 0.015, PALETTE.steel, 0, 0.005, -0.012, SHINY));     // Parierstange
    g.add(box(0.008, 0.042, 0.17, PALETTE.steel, 0, 0.01, -0.105, SHINY));     // Klinge
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.021, 0.06, 4), mat(PALETTE.steel, SHINY));
    tip.rotation.x = -Math.PI / 2; tip.scale.set(0.38, 1, 1); tip.position.set(0, 0.01, -0.22);
    g.add(tip);
    g.add(box(0.003, 0.012, 0.15, PALETTE.light, 0.004, 0.027, -0.1, SHINY));  // Schneide-Glanz
    gripR.set(0, -0.01, 0.06); gripL.set(0, -0.06, -0.3);
    sight.set(0, 0.04, 0);
    muzzle.position.set(0, 0, -0.22);
  } else if (id === 'pistol') {
    g.add(box(0.06, 0.065, 0.26, PALETTE.light, 0, 0.035, -0.02, SHINY));   // Schlitten
    for (let i = 0; i < 5; i++) g.add(box(0.062, 0.05, 0.006, PALETTE.metal, 0, 0.035, 0.07 + i * 0.012)); // Griffrillen
    g.add(box(0.055, 0.045, 0.22, PALETTE.dark, 0, -0.01, -0.01));           // Rahmen
    g.add(box(0.012, 0.015, 0.01, PALETTE.dark, 0, 0.075, -0.13));           // Korn
    g.add(box(0.04, 0.012, 0.012, PALETTE.dark, 0, 0.074, 0.09));            // Kimme
    g.add(box(0.062, 0.012, 0.06, PALETTE.fire, 0, 0.07, 0.03));             // Akzent
    g.add(box(0.012, 0.035, 0.06, PALETTE.dark, 0, -0.045, 0.02));           // Abzugsbügel
    const grip = box(0.052, 0.15, 0.075, PALETTE.dark, 0, -0.09, 0.075); grip.rotation.x = -0.25; g.add(grip);
    parts.mag = box(0.04, 0.12, 0.055, PALETTE.metal, 0, -0.105, 0.08); parts.mag.rotation.x = -0.25; g.add(parts.mag);
    parts.bolt = box(0.061, 0.066, 0.1, PALETTE.light, 0, 0.035, 0.06, SHINY); g.add(parts.bolt); // Schlitten-Heck (zieht beim Schuss zurück)
    muzzle.position.set(0, 0.035, -0.16);
    sight.set(0, 0.08, 0.09); gripR.set(0, -0.1, 0.085); gripL.set(-0.01, -0.11, 0.06); eject.set(0.035, 0.06, 0);
  } else if (id === 'smg') {
    g.add(box(0.065, 0.09, 0.32, PALETTE.dark, 0, 0, 0));                    // Gehäuse
    g.add(box(0.03, 0.015, 0.24, PALETTE.metal, 0, 0.052, -0.01));           // Schiene
    g.add(cyl(0.022, 0.022, 0.16, 8, PALETTE.metal, 0, 0.0, -0.24, true));   // Schalldämpfer
    g.add(box(0.012, 0.03, 0.012, PALETTE.dark, 0, 0.07, -0.14));            // Korn
    g.add(box(0.03, 0.03, 0.02, PALETTE.dark, 0, 0.07, 0.11));               // Kimme
    g.add(box(0.066, 0.02, 0.07, PALETTE.fire, 0, 0.047, 0.08));
    const fg = box(0.035, 0.09, 0.035, PALETTE.dark, 0, -0.08, -0.12); g.add(fg);  // Vordergriff
    const grip = box(0.045, 0.12, 0.055, PALETTE.dark, 0, -0.09, 0.1); grip.rotation.x = -0.25; g.add(grip);
    parts.mag = box(0.035, 0.2, 0.05, PALETTE.metal, 0, -0.14, -0.02); g.add(parts.mag);
    g.add(box(0.01, 0.01, 0.2, PALETTE.metal, 0.025, 0.0, 0.25)); g.add(box(0.01, 0.01, 0.2, PALETTE.metal, -0.025, 0.0, 0.25)); // Drahtschaft
    g.add(box(0.06, 0.07, 0.02, PALETTE.dark, 0, -0.01, 0.35));
    parts.bolt = box(0.012, 0.02, 0.04, PALETTE.steel, 0.04, 0.02, 0.0, SHINY); g.add(parts.bolt); // Ladehebel
    muzzle.position.set(0, 0, -0.33);
    sight.set(0, 0.085, 0.11); gripR.set(0, -0.1, 0.11); gripL.set(0, -0.12, -0.12); eject.set(0.04, 0.03, -0.02);
  } else if (id === 'rifle') {
    g.add(box(0.07, 0.11, 0.42, PALETTE.olive, 0, 0, 0));                    // Gehäuse
    g.add(box(0.075, 0.08, 0.22, PALETTE.dark, 0, -0.005, -0.3));            // Handschutz
    for (let i = 0; i < 4; i++) g.add(box(0.077, 0.012, 0.03, PALETTE.metal, 0, 0.02, -0.38 + i * 0.05)); // Lüftungsschlitze
    g.add(cyl(0.017, 0.017, 0.28, 6, PALETTE.dark, 0, 0.01, -0.52, true));   // Lauf
    g.add(box(0.035, 0.035, 0.05, PALETTE.dark, 0, 0.01, -0.67));            // Mündungsbremse
    g.add(box(0.06, 0.1, 0.24, PALETTE.olive, 0, -0.02, 0.32));              // Schaft
    g.add(box(0.064, 0.11, 0.03, PALETTE.dark, 0, -0.02, 0.44));             // Schaftkappe
    g.add(box(0.03, 0.012, 0.3, PALETTE.metal, 0, 0.062, -0.05));            // Schiene
    // Rotpunkt-Visier
    g.add(box(0.04, 0.045, 0.07, PALETTE.dark, 0, 0.09, 0.0));
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.028, 0.028), mat('#ff3b30', { emissive: '#ff3b30', emissiveIntensity: 0.6, transparent: true, opacity: 0.35, side: THREE.DoubleSide })).translateY(0.095).translateZ(0.036));
    g.add(box(0.072, 0.02, 0.1, PALETTE.fire, 0, 0.065, 0.14));
    const grip = box(0.05, 0.13, 0.06, PALETTE.dark, 0, -0.11, 0.1); grip.rotation.x = -0.3; g.add(grip);
    parts.mag = box(0.05, 0.17, 0.08, PALETTE.metal, 0, -0.13, -0.07); parts.mag.rotation.x = 0.2; g.add(parts.mag);
    parts.bolt = box(0.03, 0.02, 0.05, PALETTE.steel, 0.045, 0.03, 0.08, SHINY); g.add(parts.bolt);
    muzzle.position.set(0, 0.01, -0.7);
    sight.set(0, 0.095, 0.03); gripR.set(0, -0.12, 0.11); gripL.set(0, -0.06, -0.3); eject.set(0.04, 0.03, 0.02);
  } else if (id === 'shotgun') {
    g.add(cyl(0.024, 0.024, 0.62, 7, PALETTE.metal, 0, 0.025, -0.36, true, SHINY)); // Lauf
    g.add(cyl(0.02, 0.02, 0.5, 6, PALETTE.dark, 0, -0.025, -0.32, true));    // Magazinrohr
    g.add(box(0.075, 0.1, 0.24, PALETTE.dark, 0, 0, 0.04));                   // Verschluss
    g.add(box(0.065, 0.11, 0.28, PALETTE.wood, 0, -0.03, 0.3));               // Schaft
    g.add(box(0.068, 0.12, 0.03, PALETTE.dark, 0, -0.03, 0.45));
    g.add(box(0.077, 0.02, 0.08, PALETTE.fire, 0, 0.055, 0.03));
    g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.007, 0), mat(PALETTE.flame)).translateY(0.052).translateZ(-0.66)); // Perlkorn
    for (let i = 0; i < 4; i++) g.add(cyl(0.011, 0.011, 0.045, 6, PALETTE.red, -0.042, 0.0, -0.02 + i * 0.03)); // Seitliche Patronen
    parts.pump = box(0.07, 0.065, 0.16, PALETTE.woodDark, 0, -0.025, -0.3); g.add(parts.pump);
    muzzle.position.set(0, 0.025, -0.69);
    sight.set(0, 0.06, 0.02); gripR.set(0, -0.08, 0.17); gripL.set(0, -0.06, -0.3); eject.set(0.04, 0.03, 0.03);
  } else if (id === 'sniper') {
    g.add(box(0.07, 0.09, 0.36, PALETTE.sand, 0, 0, 0.0));                   // Gehäuse
    g.add(box(0.065, 0.06, 0.3, PALETTE.sand, 0, -0.01, -0.3));              // Vorderschaft
    g.add(cyl(0.016, 0.019, 0.55, 7, PALETTE.dark, 0, 0.015, -0.6, true));   // langer Lauf
    g.add(box(0.04, 0.04, 0.08, PALETTE.dark, 0, 0.015, -0.9));              // Mündungsbremse
    g.add(box(0.06, 0.12, 0.3, PALETTE.sand, 0, -0.03, 0.33));               // Schaft
    g.add(box(0.05, 0.03, 0.14, PALETTE.dark, 0, 0.045, 0.3));               // Wangenauflage
    // Zielfernrohr
    g.add(cyl(0.024, 0.024, 0.26, 10, PALETTE.dark, 0, 0.1, -0.02, true, SHINY));
    g.add(cyl(0.032, 0.026, 0.06, 10, PALETTE.dark, 0, 0.1, -0.17, true, SHINY));
    g.add(cyl(0.03, 0.026, 0.05, 10, PALETTE.dark, 0, 0.1, 0.13, true, SHINY));
    g.add(new THREE.Mesh(new THREE.CircleGeometry(0.026, 10), mat('#7fd3ff', { emissive: '#2a6c96', emissiveIntensity: 0.8, shiny: true })).translateY(0.1).translateZ(-0.201).rotateY(Math.PI));
    g.add(box(0.03, 0.05, 0.02, PALETTE.dark, 0, 0.065, -0.08)); g.add(box(0.03, 0.05, 0.02, PALETTE.dark, 0, 0.065, 0.06)); // Montagen
    g.add(box(0.072, 0.02, 0.08, PALETTE.fire, 0, 0.045, -0.15));
    const grip = box(0.05, 0.12, 0.06, PALETTE.dark, 0, -0.1, 0.15); grip.rotation.x = -0.3; g.add(grip);
    parts.mag = box(0.05, 0.08, 0.09, PALETTE.metal, 0, -0.08, -0.03); g.add(parts.mag);
    // Kammerstängel (Bolt) – dreht und zieht beim Repetieren
    parts.bolt = new THREE.Group(); parts.bolt.position.set(0.035, 0.03, 0.1);
    parts.bolt.add(cyl(0.008, 0.008, 0.06, 6, PALETTE.steel, 0.03, 0, 0, false, SHINY).rotateZ(Math.PI / 2));
    parts.bolt.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.016, 0), mat(PALETTE.dark)).translateX(0.065));
    g.add(parts.bolt);
    // Zweibein (eingeklappt)
    g.add(box(0.008, 0.008, 0.18, PALETTE.dark, 0.02, -0.05, -0.38)); g.add(box(0.008, 0.008, 0.18, PALETTE.dark, -0.02, -0.05, -0.38));
    muzzle.position.set(0, 0.015, -0.95);
    sight.set(0, 0.1, 0.16); gripR.set(0, -0.11, 0.16); gripL.set(0, -0.05, -0.32); eject.set(0.04, 0.03, 0.06);
  } else if (id === 'mace') {
    // Streitkolben: umwickelter Griff, schwerer Kopf mit Stacheln, Knauf
    g.add(cyl(0.022, 0.026, 0.42, 8, PALETTE.woodDark, 0, 0, -0.02, true));          // Stiel
    for (let i = 0; i < 4; i++) g.add(cyl(0.028, 0.028, 0.025, 8, PALETTE.dark, 0, 0, 0.08 + i * 0.035, true)); // Wicklung
    g.add(new THREE.Mesh(new THREE.OctahedronGeometry(0.035, 0), mat(PALETTE.steel, SHINY)).translateZ(0.2)); // Knauf
    g.add(cyl(0.04, 0.03, 0.05, 8, PALETTE.metal, 0, 0, -0.24, true, SHINY));           // Hals
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 0), mat('#7d8794', SHINY));
    head.position.z = -0.32;
    g.add(head);
    g.add(cyl(0.082, 0.082, 0.04, 8, PALETTE.fire, 0, 0, -0.32, true));                  // Ring (Akzentfarbe)
    for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, -1], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0.7, -0.7, 0], [-0.7, -0.7, 0]]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.07, 5), mat(PALETTE.steel, SHINY));
      spike.position.set(x * 0.085, y * 0.085, -0.32 + z * 0.085);
      spike.lookAt(new THREE.Vector3(x * 2, y * 2, -0.32 + z * 2));
      spike.rotateX(Math.PI / 2);
      g.add(spike);
    }
    gripR.set(0, -0.01, 0.12); gripL.set(0, -0.06, 0.3);
    sight.set(0, 0.05, 0);
    muzzle.position.set(0, 0, -0.32);
  } else if (id === 'rocket') {
    g.add(cyl(0.065, 0.065, 0.95, 10, PALETTE.olive, 0, 0.02, -0.12, true));  // Rohr
    g.add(cyl(0.085, 0.07, 0.12, 10, PALETTE.dark, 0, 0.02, -0.62, true));    // Mündungstrichter
    g.add(cyl(0.07, 0.09, 0.14, 10, PALETTE.dark, 0, 0.02, 0.4, true));       // hinterer Trichter
    for (const z of [-0.35, 0.05, 0.25]) g.add(cyl(0.069, 0.069, 0.03, 10, PALETTE.dark, 0, 0.02, z, true)); // Ringe
    g.add(box(0.05, 0.05, 0.12, PALETTE.dark, -0.07, 0.09, -0.05));           // Visier links
    g.add(box(0.03, 0.03, 0.01, '#ff3b30', -0.07, 0.11, -0.11, { emissive: '#ff3b30', emissiveIntensity: 0.5 }));
    g.add(box(0.06, 0.02, 0.2, PALETTE.fire, 0, 0.09, 0.1));
    const grip = box(0.045, 0.12, 0.055, PALETTE.dark, 0, -0.1, 0.05); grip.rotation.x = -0.2; g.add(grip);
    g.add(box(0.04, 0.1, 0.05, PALETTE.dark, 0, -0.09, -0.25));               // Vordergriff
    // sichtbare Raketenspitze vorne im Rohr
    parts.tip = new THREE.Group();
    parts.tip.add(new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.16, 8), mat(PALETTE.red)).rotateX(-Math.PI / 2));
    parts.tip.add(cyl(0.055, 0.055, 0.08, 8, PALETTE.light, 0, 0, 0.1, true));
    parts.tip.position.set(0, 0.02, -0.74);
    g.add(parts.tip);
    muzzle.position.set(0, 0.02, -0.72);
    sight.set(-0.07, 0.12, -0.02); gripR.set(0, -0.12, 0.06); gripL.set(0, -0.12, -0.25); eject.set(0, 0.02, 0.48);
  }
  g.add(muzzle);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const homes = {};
  for (const [k, v] of Object.entries(parts)) if (v) homes[k] = { pos: v.position.clone(), rot: v.rotation.clone() };
  return { id, group: g, muzzle, ...parts, homes, sight, gripR, gripL, eject };
}

/** Low-Poly-Hand mit Fingern + Unterarm (Ärmel). side = 1 rechts, -1 links. */
export function createHand(side = 1) {
  const g = new THREE.Group();
  g.add(box(0.06, 0.065, 0.085, PALETTE.glove, 0, 0, 0));                         // Handrücken
  for (let i = 0; i < 4; i++) g.add(box(0.014, 0.018, 0.05, PALETTE.glove, -0.022 + i * 0.015, -0.025, -0.055)); // Finger
  g.add(box(0.018, 0.02, 0.045, PALETTE.glove, side * 0.035, -0.005, -0.03).rotateY(side * 0.5)); // Daumen
  g.add(box(0.07, 0.012, 0.03, PALETTE.fire, 0, 0.033, 0.03));                    // Handschuh-Akzent
  const arm = box(0.085, 0.085, 0.42, PALETTE.sleeve, 0, -0.01, 0.25);            // Unterarm
  g.add(arm);
  g.add(box(0.09, 0.09, 0.05, '#3b4556', 0, -0.01, 0.06));                        // Ärmelbund
  return g;
}

/** Spielerfigur (Third-Person). Animations-Gelenke werden als Eigenschaften zurückgegeben. */
export function createPlayerModel(color) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.14, 0.9, 0);
  legR.position.set(0.14, 0.9, 0);
  for (const leg of [legL, legR]) {
    leg.add(box(0.2, 0.75, 0.22, PALETTE.pants, 0, -0.38, 0));
    leg.add(box(0.21, 0.12, 0.23, '#2f3846', 0, -0.4, 0)); // Knieschoner
    leg.add(box(0.22, 0.14, 0.3, PALETTE.boots, 0, -0.83, -0.03));
    body.add(leg);
  }
  const upper = new THREE.Group();
  upper.position.y = 0.95;
  body.add(upper);
  upper.add(box(0.56, 0.62, 0.32, color, 0, 0.32, 0));       // Torso
  upper.add(box(0.5, 0.4, 0.06, '#3a4452', 0, 0.36, -0.17)); // Weste
  upper.add(box(0.14, 0.12, 0.05, '#4a5568', -0.14, 0.28, -0.21)); upper.add(box(0.14, 0.12, 0.05, '#4a5568', 0.14, 0.28, -0.21)); // Taschen
  upper.add(box(0.58, 0.1, 0.34, PALETTE.dark, 0, 0.02, 0));  // Gürtel
  upper.add(box(0.36, 0.42, 0.18, '#4a5568', 0, 0.36, 0.22)); // Rucksack
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), mat(PALETTE.skin));
  head.position.y = 0.78;
  upper.add(head);
  upper.add(box(0.36, 0.1, 0.2, PALETTE.visor, 0, 0.8, -0.14));
  upper.add(box(0.42, 0.1, 0.44, color, 0, 0.98, 0.01));
  upper.add(box(0.3, 0.04, 0.16, color, 0, 0.95, -0.26)); // Schirm

  const hands = new THREE.Group();
  hands.position.set(0.08, 0.45, -0.3);
  upper.add(hands);
  const armR = box(0.14, 0.14, 0.5, color, 0.12, -0.02, 0.12);
  const armL = box(0.14, 0.14, 0.55, color, -0.18, -0.02, 0.0);
  armL.rotation.y = -0.5;
  hands.add(armR, armL);
  hands.add(box(0.12, 0.12, 0.12, PALETTE.glove, 0.06, -0.05, -0.1));

  // Superstern-Aura (nur sichtbar, wenn aktiv)
  const aura = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), new THREE.MeshBasicMaterial({ color: '#ffd84d', wireframe: true, transparent: true, opacity: 0.6 }));
  aura.position.y = 1;
  aura.visible = false;
  root.add(aura);

  root.traverse((o) => { if (o.isMesh && o !== aura) o.castShadow = true; });
  return { root, body, legL, legR, upper, hands, head, aura, weapon: null, weaponId: null };
}

/** Waffe in der Hand des Third-Person-Modells tauschen. */
export function setPlayerWeapon(model, id) {
  if (model.weaponId === id) return;
  if (model.weapon) model.hands.remove(model.weapon.group);
  model.weapon = createWeapon(id);
  model.weapon.group.scale.setScalar(1.4);
  model.weapon.group.position.set(0.04, 0.02, -0.15);
  model.hands.add(model.weapon.group);
  model.weaponId = id;
}

/** Namensschild als Sprite. */
export function createNameTag(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px Segoe UI, sans-serif';
  const w = Math.min(244, ctx.measureText(name).width + 28);
  ctx.fillStyle = 'rgba(20,26,34,0.75)';
  ctx.fillRect((256 - w) / 2, 10, w, 44);
  ctx.fillStyle = color;
  ctx.fillRect((256 - w) / 2, 50, w, 4);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 32, 230);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(1.4, 0.35, 1);
  sprite.position.y = 2.3;
  return sprite;
}

function questionTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 54px Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#3a2a6a';
  ctx.strokeText('?', 32, 35);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('?', 32, 35);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let qTex = null;

/** Pickup-Modelle: Waffe auf Sockel bzw. regenbogenfarbene Item-Box. Rückgabe: { root, spin } */
export function createPickupModel(kind, type) {
  const root = new THREE.Group();
  const spin = new THREE.Group();
  spin.position.y = 1.0;
  root.add(spin);
  if (kind === 'weapon') {
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 0.12, 6), mat('#59636f'));
    pad.position.y = 0.06;
    pad.receiveShadow = true;
    root.add(pad);
    const color = type === 'rocket' || type === 'sniper' ? '#e2534a' : '#f08c32';
    root.add(cyl(0.75, 0.75, 0.14, 6, color, 0, 0.07, 0, false, { emissive: color, emissiveIntensity: 0.5 }));
    const w = createWeapon(type);
    w.group.scale.setScalar(type === 'knife' ? 3 : type === 'sniper' || type === 'rocket' ? 1.6 : 2.2);
    spin.add(w.group);
  } else {
    // Item-Box: Würfel mit Regenbogen-Flächen, durchscheinend, mit "?" in der Mitte
    const geo = new THREE.BoxGeometry(0.95, 0.95, 0.95).toNonIndexed();
    const cols = ['#ff5a5a', '#ffb347', '#ffe75a', '#6ee07a', '#5ab8ff', '#b07aff'];
    const colors = [];
    for (let f = 0; f < 6; f++) { const c = new THREE.Color(cols[f]); for (let v = 0; v < 6; v++) colors.push(c.r, c.g, c.b); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    const cube = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.55, emissive: '#5a4a90', emissiveIntensity: 0.4, depthWrite: false }));
    cube.rotation.set(0.6, 0, 0.6);
    spin.add(cube);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.97, 0.97, 0.97)), new THREE.LineBasicMaterial({ color: '#ffffff' }));
    edges.rotation.copy(cube.rotation);
    spin.add(edges);
    qTex ??= questionTexture();
    const q = new THREE.Sprite(new THREE.SpriteMaterial({ map: qTex, depthTest: false }));
    q.scale.setScalar(0.55);
    root.add(q);
    q.position.y = 1.0;
    root.userData.q = q;
  }
  spin.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { root, spin };
}

/** Projektil-Modelle: Rakete, Abprall-/Such-Kugel, Bananenschale. */
export function createProjectileModel(kind) {
  const g = new THREE.Group();
  if (kind === 'rocket') {
    const body = new THREE.Group();
    body.add(cyl(0.06, 0.06, 0.4, 8, PALETTE.light, 0, 0, 0, true));
    body.add(new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 8), mat(PALETTE.red)).rotateX(-Math.PI / 2).translateY(0.28));
    for (let i = 0; i < 4; i++) {
      const fin = box(0.005, 0.08, 0.1, PALETTE.dark, 0, 0, 0.17);
      fin.rotation.z = (i * Math.PI) / 2; fin.translateY(0.06);
      body.add(fin);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 6), new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.85 }));
    flame.rotation.x = Math.PI / 2;
    flame.position.z = 0.4;
    body.add(flame);
    g.add(body);
    g.userData.flame = flame;
  } else if (kind === 'greenShell' || kind === 'redShell') {
    const color = kind === 'greenShell' ? '#3fb35a' : '#d8433a';
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.34, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), mat(color));
    dome.position.y = -0.05;
    g.add(dome);
    g.add(cyl(0.36, 0.36, 0.1, 10, '#f4f1e6', 0, -0.08, 0));
    for (let i = 0; i < 6; i++) { // Panzer-Muster
      const a = (i / 6) * Math.PI * 2;
      g.add(new THREE.Mesh(new THREE.CircleGeometry(0.08, 6), mat('#f4f1e6')).translateX(Math.cos(a) * 0.2).translateZ(Math.sin(a) * 0.2).translateY(0.2).rotateX(-1.0));
    }
  } else if (kind === 'wind') {
    // Windladung: hellblauer Kern mit zwei rotierenden Wirbelringen
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), new THREE.MeshLambertMaterial({ color: '#dff6ff', emissive: '#8fd8ff', emissiveIntensity: 0.6, flatShading: true, transparent: true, opacity: 0.85 }));
    g.add(core);
    for (let i = 0; i < 2; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32 - i * 0.08, 0.035, 4, 12), new THREE.MeshBasicMaterial({ color: i ? '#ffffff' : '#8fd8ff', transparent: true, opacity: 0.8 }));
      ring.rotation.set(i ? 1.2 : 0.3, i ? 0.4 : 1.1, 0);
      g.add(ring);
    }
    g.userData.spin = true;
  } else if (kind === 'banana') {
    for (let i = 0; i < 3; i++) {
      const seg = box(0.12, 0.08, 0.22, '#f6d743', 0, 0.05, 0);
      seg.rotation.y = (i - 1) * 1.6;
      seg.translateZ(0.12);
      g.add(seg);
    }
    g.add(box(0.06, 0.12, 0.06, '#7a5a20', 0, 0.12, 0));
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}
