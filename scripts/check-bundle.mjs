// Checks dist/ against the YouTube Playables certification limits and a few code rules
// that are easy to break by accident. Runs as the last step of `npm run build`.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const KiB = 1024;
const MiB = 1024 * KiB;
const dist = fileURLToPath(new URL('../dist/', import.meta.url));

const errors = [];
const warnings = [];
const files = [];

(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else files.push({ path, name: relative(dist, path).replaceAll('\\', '/'), size: statSync(path).size });
  }
})(dist);

const total = files.reduce((sum, f) => sum + f.size, 0);
const fmt = (bytes) => (bytes >= MiB ? `${(bytes / MiB).toFixed(2)} MiB` : `${(bytes / KiB).toFixed(1)} KiB`);

// Stability and performance requirements.
if (files.length > 8000) errors.push(`${files.length} files (max 8000)`);
if (total > 250 * MiB) errors.push(`total bundle ${fmt(total)} (max 250 MiB)`);
// Everything in this build loads before gameReady, so all of it counts as the initial bundle.
if (total > 30 * MiB) errors.push(`initial bundle ${fmt(total)} (max 30 MiB)`);
else if (total > 15 * MiB) warnings.push(`initial bundle ${fmt(total)} (recommended under 15 MiB)`);
for (const f of files) {
  if (f.size > 30 * MiB) errors.push(`${f.name} is ${fmt(f.size)} (max 30 MiB per file)`);
  else if (f.size > 512 * KiB) warnings.push(`${f.name} is ${fmt(f.size)} (recommended under 512 KiB)`);
}

// The web build's app files (manifest, icons, service worker) have no place in the Playables bundle.
for (const f of files) {
  if (f.name === 'sw.js' || f.name.endsWith('.webmanifest') || f.name.startsWith('icons/')) errors.push(`${f.name} is a file of the web build (an installable app), not of the Playables bundle`);
}

// The SDK must load before any game code.
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const firstScript = html.match(/<script\b[^>]*>/)?.[0] ?? '';
if (!firstScript.includes('https://www.youtube.com/game_api/v1')) errors.push('the Playables SDK is not the first <script> in index.html');

// Code rules: things certification forbids or may reject.
const banned = [
  ['localStorage', 'save progress only with ytgame.game.saveData'],
  ['sessionStorage', 'save progress only with ytgame.game.saveData'],
  ['indexedDB', 'save progress only with ytgame.game.saveData'],
  ['navigator.language', 'use ytgame.system.getLanguage'],
  ['visibilitychange', 'use ytgame.system.onPause / onResume'],
  ['serviceWorker', 'only the web build is installable and offline: the PWA code must not be in the Playables build'],
  ['new Worker', 'Web Workers may block review'],
  ['WebAssembly', 'WebAssembly may block review'],
  ['eval(', 'eval may block review'],
];
for (const f of files.filter((f) => ['.js', '.html'].includes(extname(f.path)))) {
  const code = readFileSync(f.path, 'utf8');
  for (const [needle, why] of banned) if (code.includes(needle)) errors.push(`${f.name} contains "${needle}": ${why}`);
}

console.log(`\nPlayables bundle check: ${files.length} files, ${fmt(total)} total`);
for (const f of files) console.log(`  ${fmt(f.size).padStart(11)}  ${f.name}`);
for (const w of warnings) console.warn(`  warning: ${w}`);
for (const e of errors) console.error(`  error: ${e}`);
if (errors.length) process.exit(1);
console.log('  ok\n');
