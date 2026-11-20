// Baut die Windows-.exe (Ordner dist/Lagerfeuer Launcher-win32-x64) und auf Wunsch das Liefer-ZIP.
//   npm run build            → nur die App
//   npm run build -- --zip   → App + release/Lagerfeuer-Launcher-v<version>.zip (App + Quellcode + README)
import { packager } from '@electron/packager';
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

// Spiele liegen NICHT im asar-Archiv, sondern als normaler Ordner in resources/games
// → neue Spiele können ohne Neubau ergänzt werden.
const IGNORE = [/^\/games($|\/)/, /^\/dist($|\/)/, /^\/release($|\/)/, /^\/tests($|\/)/, /^\/scripts($|\/)/, /^\/\.claude($|\/)/, /^\/README\.md$/];

console.log('Baue App …');
const [appDir] = await packager({
  dir: root,
  out: join(root, 'dist'),
  overwrite: true,
  platform: 'win32',
  arch: 'x64',
  asar: true,
  prune: true,
  icon: join(root, 'build', 'icon.ico'),
  name: pkg.productName,
  executableName: 'Lagerfeuer Launcher',
  appVersion: pkg.version,
  appCopyright: `© ${new Date().getFullYear()} Lagerfeuer`,
  extraResource: [join(root, 'games')],
  ignore: IGNORE,
  win32metadata: { CompanyName: 'Lagerfeuer', ProductName: pkg.productName, FileDescription: pkg.productName, OriginalFilename: 'Lagerfeuer Launcher.exe' },
});
console.log('Fertig:', appDir);

if (process.argv.includes('--zip')) {
  const stage = join(root, 'release', 'stage');
  rmSync(join(root, 'release'), { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  cpSync(appDir, join(stage, 'Lagerfeuer Launcher'), { recursive: true });
  const src = join(stage, 'Quellcode');
  for (const item of ['package.json', 'package-lock.json', 'README.md', '.gitignore', 'src', 'games', 'build', 'scripts', 'tests']) {
    if (existsSync(join(root, item))) cpSync(join(root, item), join(src, item), { recursive: true });
  }
  cpSync(join(root, 'README.md'), join(stage, 'README.md'));
  const zip = join(root, 'release', `Lagerfeuer-Launcher-v${pkg.version}.zip`);
  execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -CompressionLevel Optimal -Force`], { stdio: 'inherit' });
  rmSync(stage, { recursive: true, force: true });
  console.log('ZIP erstellt:', zip);
}
