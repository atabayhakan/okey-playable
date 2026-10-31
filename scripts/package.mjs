// Zips a build into release/ (index.html at the root of the archive). No dependencies: a
// minimal ZIP writer on top of node:zlib. Entries get a fixed timestamp so builds are
// reproducible.
//
//   node scripts/package.mjs            dist/      -> release/okey-playable-v<version>.zip  (Playables portal)
//   node scripts/package.mjs web        dist-web/  -> release/okey-web-v<version>.zip       (itch.io and the like)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
const web = process.argv[2] === 'web';
const dist = join(root, web ? 'dist-web' : 'dist');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const out = join(root, 'release', `${web ? 'okey-web' : 'okey-playable'}-v${version}.zip`);

if (!existsSync(join(dist, 'index.html'))) {
  console.error(`${relative(root, dist)}/index.html is missing: build first.`);
  process.exit(1);
}

// The two builds must not be mixed up: the web one has no YouTube SDK, the Playables one no localStorage.
{
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const code = readdirSync(join(dist, 'assets'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => readFileSync(join(dist, 'assets', f), 'utf8'))
    .join('\n');
  const problems = [];
  if (web && html.includes('youtube.com')) problems.push('the web build still loads the YouTube SDK');
  if (web && !code.includes('okey-save')) problems.push('the web build does not save to the browser');
  if (!web && code.includes('okey-save')) problems.push('the Playables build contains the browser save');
  // The web build is an installable app that works offline; the Playables bundle must not be (and the web one must).
  const app = ['sw.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'].filter((f) => existsSync(join(dist, f)));
  if (web && app.length !== 4) problems.push(`the web build is missing app files (it has ${app.join(', ') || 'none'})`);
  if (web && !html.includes('manifest.webmanifest')) problems.push('the web build does not link its manifest');
  if (!web && (app.length || code.includes('serviceWorker') || html.includes('manifest'))) problems.push('the Playables bundle contains the web build’s app files');
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exit(1);
  }
}

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else files.push(path);
  }
})(dist);
files.sort();

const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const UTF8 = 0x0800;
const DEFLATE = 8;

const locals = [];
const centrals = [];
let offset = 0;
for (const path of files) {
  const name = Buffer.from(relative(dist, path).replaceAll('\\', '/'), 'utf8');
  const data = readFileSync(path);
  const packed = deflateRawSync(data, { level: 9 });
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(UTF8, 6);
  local.writeUInt16LE(DEFLATE, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, name, packed);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(UTF8, 8);
  central.writeUInt16LE(DEFLATE, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, name);

  offset += local.length + name.length + packed.length;
}

const centralSize = centrals.reduce((n, b) => n + b.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(centralSize, 12);
end.writeUInt32LE(offset, 16);

const zip = Buffer.concat([...locals, ...centrals, end]);
mkdirSync(join(root, 'release'), { recursive: true });
writeFileSync(out, zip);
console.log(`Playables bundle: ${relative(root, out)} (${files.length} files, ${(zip.length / 1024).toFixed(1)} KiB)`);
