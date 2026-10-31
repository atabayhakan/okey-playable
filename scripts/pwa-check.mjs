// Checks that the web build is an app: Chrome finds nothing wrong with installing it, its manifest and icons are
// good, its service worker keeps exactly the files of the build, and with the network switched off the game still
// opens, in the language asked for, and plays.
//
//   npm run check:pwa        builds the web build, then checks it
//
// Also checks the Playables build (dist/), when it is there: none of this may be in it.
// Needs Chrome or Edge (CHROME_PATH overrides the lookup). Exits 1 when a check fails.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { launch, root, sleep } from './lib/browser.mjs';

const failures = [];
const fail = (where, problem) => failures.push(`${where}: ${problem}`);
const log = (line) => console.log(line);

/** The files of a folder, relative with forward slashes. */
function filesOf(dir) {
  const found = [];
  (function walk(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else found.push(relative(dir, path).replaceAll('\\', '/'));
    }
  })(dir);
  return found.sort();
}

// ---- The Playables build has none of it -------------------------------------------------------------

const playables = join(root, 'dist');
if (existsSync(join(playables, 'index.html'))) {
  const files = filesOf(playables);
  const code = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(playables, f), 'utf8')).join('\n');
  const html = readFileSync(join(playables, 'index.html'), 'utf8');
  const app = files.filter((f) => f === 'sw.js' || f.endsWith('.webmanifest') || f.startsWith('icons/'));
  if (app.length) fail('Playables build', `has app files: ${app.join(', ')}`);
  if (code.includes('serviceWorker')) fail('Playables build', 'its code registers a service worker');
  if (html.includes('manifest')) fail('Playables build', 'its page links a manifest');
  log(`Playables build   ${app.length || code.includes('serviceWorker') || html.includes('manifest') ? 'FAIL' : 'has none of it'}`);
} else {
  log('Playables build   (dist/ is not built: skipped)');
}

// ---- The web build, in a browser ---------------------------------------------------------------------

const web = join(root, 'dist-web');
const { send, evaluate, navigate, once, errors, hasCrashed, finish, close, base } = await launch('check:pwa');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });

await navigate(`${base}blank`);
await evaluate('localStorage.clear()');
await navigate(`${base}?lang=en`);
for (let t = 0; t < 60 && !(await evaluate(`Boolean(document.querySelector('.table'))`)); t++) await sleep(150);

// The worker registers after the page loads, installs, and takes the page over.
let controlled = false;
for (let t = 0; t < 100 && !controlled; t++) {
  controlled = await evaluate(`Boolean(navigator.serviceWorker && navigator.serviceWorker.controller)`);
  if (!controlled) await sleep(150);
}
if (!controlled) fail('service worker', 'it did not take control of the page');
else log('service worker   installed and in control of the page');

// Chrome's own opinion: is this an app it would let a person install?
const installability = await send('Page.getInstallabilityErrors');
if (installability.installabilityErrors.length) fail('installable', installability.installabilityErrors.map((e) => `${e.errorId} ${JSON.stringify(e.arguments)}`).join('; '));
else log('installable       Chrome finds no reason it could not be installed');

const app = await send('Page.getAppManifest');
if (app.errors.length) fail('manifest', app.errors.map((e) => e.message).join('; '));
const manifest = app.data ? JSON.parse(app.data) : null;
if (!manifest) fail('manifest', 'the page has no manifest');
else {
  log(`manifest          "${manifest.name}", ${manifest.display}, ${manifest.icons.length} icons`);
  // Every icon has to load, and be as big as it says.
  for (const icon of manifest.icons) {
    const url = new URL(icon.src, app.url).href;
    const size = await evaluate(`(async () => { const r = await fetch(${JSON.stringify(url)}); if (!r.ok) return 'status ' + r.status; const b = await createImageBitmap(await r.blob()); return b.width + 'x' + b.height; })()`);
    if (size !== icon.sizes) fail('icons', `${icon.src} is ${size}, the manifest says ${icon.sizes}`);
  }
}
if (!(await evaluate(`document.querySelector('meta[name="theme-color"]')?.content`))) fail('page', 'no theme-color');

// What the worker keeps is the build, no more and no less.
const kept = await evaluate(`(async () => {
  const names = (await caches.keys()).filter((n) => n.startsWith('okey-'));
  const cache = names.length === 1 ? await caches.open(names[0]) : null;
  return { names, urls: cache ? (await cache.keys()).map((r) => new URL(r.url).pathname) : [] };
})()`);
if (kept.names.length !== 1) fail('cache', `${kept.names.length} caches of the game: ${kept.names.join(', ')} (one expected)`);
const expected = new Set(filesOf(web).filter((f) => f !== 'sw.js').map((f) => `/${f}`));
expected.add('/');
const got = new Set(kept.urls);
const missing = [...expected].filter((u) => !got.has(u));
const extra = [...got].filter((u) => !expected.has(u));
if (missing.length) fail('cache', `files of the build that were not kept: ${missing.join(', ')}`);
if (extra.length) fail('cache', `files kept that are not in the build: ${extra.join(', ')}`);
if (!missing.length && !extra.length && kept.names.length === 1) log(`cache             ${kept.urls.length} files kept, the whole build`);

// ---- Offline ------------------------------------------------------------------------------------------

await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
const beforeErrors = errors.length;
// A language is asked for in the address: the worker has to answer to the address with its question.
await navigate(`${base}?lang=de`);
let up = false;
for (let t = 0; t < 60 && !up; t++) {
  up = await evaluate(`Boolean(document.querySelector('.table'))`);
  if (!up) await sleep(150);
}
if (!up) {
  fail('offline', 'the game did not open with the network off');
} else {
  const lang = await evaluate('document.documentElement.lang');
  if (lang !== 'de') fail('offline', `the page opened in "${lang}", not German`);
  // And it plays: the rules card closes, a tile is thrown, the bots answer.
  await evaluate(`document.querySelector('[data-action="close-coach"]')?.click()`);
  await sleep(400);
  await evaluate(`document.querySelector('.rack [data-tile-id]')?.click()`);
  await sleep(200);
  await evaluate(`document.querySelector('button.discard[data-action="discard"]')?.click()`);
  let answered = false;
  for (let t = 0; t < 120 && !answered; t++) {
    await sleep(250);
    answered = await evaluate(`Boolean(document.querySelector('button.pile') && !document.querySelector('button.pile').disabled)`);
  }
  if (!answered) fail('offline', 'after a throw the bots did not give the turn back');
  else log('offline           opened in German with the network off, and played a turn');
}
for (const e of errors.slice(beforeErrors)) fail('offline', `the page reported: ${e}`);
if (hasCrashed()) fail('page', 'the page crashed');
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

close();
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  ${f}`);
  finish(1);
}
console.log('\nPWA ok: installable, kept whole, plays offline.');
finish(0);
