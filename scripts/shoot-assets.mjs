// Renders the store art for the Playables portal to PNG.
//
// The portal asks for thumbnails in a few sizes and only lists them inside the
// portal, so the set below covers what it asks for most often. The art is the
// game's own look with no logo and no text, which the portal requires.
//
//   npm run assets
//
// Needs Chrome. It reuses the built stylesheet, so the art always matches the
// game. Edit store/art.html to change the composition and run it again.
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const storeDir = join(root, 'store');
const distAssets = join(root, 'dist', 'assets');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1248', 'chrome-win64', 'chrome.exe'),
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('No Chrome found. Set CHROME_PATH and run again.');
  process.exit(1);
}

const cssFile = existsSync(distAssets) && readdirSync(distAssets).find((f) => f.endsWith('.css'));
if (!cssFile) {
  console.error('No built stylesheet. Run npm run build first.');
  process.exit(1);
}
// The page links to ./index.css, so the stylesheet has to sit next to it. The stylesheet loads the bundled
// font from files next to itself (url(./plus-jakarta-sans-...woff2)); those are put inside it as data URLs, so
// the copy works on its own and a page opened from file:// is not refused the font.
const css = readFileSync(join(distAssets, cssFile), 'utf8').replace(/url\((['"]?)\.\/([^)'"]+\.woff2)\1\)/g, (whole, _q, name) => {
  const font = join(distAssets, name);
  if (!existsSync(font)) {
    console.error(`The stylesheet names ${name}, which is not in dist/assets. Run npm run build again.`);
    process.exit(1);
  }
  return `url(data:font/woff2;base64,${readFileSync(font).toString('base64')})`;
});
writeFileSync(join(storeDir, 'index.css'), css);

const port = 9300 + Math.floor(Math.random() * 400);
const profile = mkdtempSync(join(tmpdir(), 'okey-art-'));
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
    if (target) break;
  } catch {
    /* still starting */
  }
  await sleep(150);
}
if (!target) {
  console.error('Chrome did not start.');
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

let nextId = 0;
const pending = new Map();
const events = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject, method } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : resolve(msg.result);
  } else if (msg.method && events.has(msg.method)) {
    for (const fn of events.get(msg.method)) fn(msg.params);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
const once = (method) =>
  new Promise((resolve) => {
    const list = events.get(method) ?? [];
    const fn = (p) => {
      events.set(method, list.filter((f) => f !== fn));
      resolve(p);
    };
    list.push(fn);
    events.set(method, list);
  });

await send('Page.enable');
await send('Runtime.enable');

// `width` and `height` are CSS pixels (what art.html lays out), `scale` the density: the 1024 icon is the
// 512 one drawn at twice the density, so the two are the same picture.
const SHOTS = [
  { view: 'icon', file: 'okey-icon-512.png', width: 512, height: 512, scale: 1 },
  { view: 'icon', file: 'okey-icon-1024.png', width: 512, height: 512, scale: 2 },
  { view: 'cover', file: 'okey-cover-1280x720.png', width: 1280, height: 720, scale: 1 },
  { view: 'portrait', file: 'okey-cover-1080x1920.png', width: 1080, height: 1920, scale: 1 },
];

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result.value;
};

const artFile = join(storeDir, 'art.html').replace(/\\/g, '/');
for (const shot of SHOTS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: shot.width,
    height: shot.height,
    deviceScaleFactor: shot.scale,
    mobile: false,
  });
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: `file:///${artFile}?view=${shot.view}` });
  await loaded;
  // The page names itself ready-<view> once it is laid out and the font is in.
  let ready = false;
  for (let t = 0; t < 50 && !ready; t++) {
    ready = (await evaluate('document.title')) === `ready-${shot.view}`;
    if (!ready) await sleep(100);
  }
  const font = await evaluate(`[...document.fonts].some((f) => f.family.includes('Plus Jakarta Sans') && f.status === 'loaded')`);
  if (!ready || !font) {
    console.error(`${shot.file}: the page was not ready${font ? '' : ' (the bundled font did not load)'}.`);
    chrome.kill();
    process.exit(1);
  }
  await sleep(200);
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(storeDir, shot.file), Buffer.from(image.data, 'base64'));
  console.log('saved', shot.file, `${shot.width * shot.scale}x${shot.height * shot.scale}`);
}

ws.close();
chrome.kill();
process.exit(0);
