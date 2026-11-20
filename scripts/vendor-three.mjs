// Kopiert die benötigten three.js-Dateien in den Spielordner (games/arena-shooter/client/vendor).
// Spiele sind dadurch eigenständig und brauchen zur Laufzeit kein node_modules.
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'games', 'arena-shooter', 'client', 'vendor');
mkdirSync(target, { recursive: true });

const files = [
  ['node_modules/three/build/three.module.js', 'three.module.js'],
  ['node_modules/three/build/three.core.js', 'three.core.js'],
  ['node_modules/three/examples/jsm/utils/BufferGeometryUtils.js', 'BufferGeometryUtils.js'],
  ['node_modules/three/LICENSE', 'THREE_LICENSE.txt'],
];
// Zusätzlich zentral im Spiele-SDK (app://sdk/vendor/…) für alle weiteren 3D-Spiele
const sdkTarget = join(root, 'src', 'sdk', 'vendor');
mkdirSync(sdkTarget, { recursive: true });
for (const [src, dst] of files) {
  copyFileSync(join(root, src), join(target, dst));
  copyFileSync(join(root, src), join(sdkTarget, dst));
  console.log('kopiert:', dst);
}
