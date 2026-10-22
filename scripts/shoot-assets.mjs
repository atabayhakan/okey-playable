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
import { readdirSync, writeFileSync, mkdtempSync, copyFileSync, existsSync } from 'node:fs';
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
  join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1248', 'chrome-win64', 'chrome.exe'),
].filter(Boolean);

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chromePath) {
  console.error('No Chrome found. Set CHROME_PATH and run again.');
  process.exit(1);
}

const cssFile = readdirSync(distAssets).find((f) => f.endsWith('.css'));
if (!cssFile) {
  console.error('No built stylesheet. Run npm run build first.');
  process.exit(1);
}
// The page links to ./index.css, so the stylesheet has to sit next to it.
copyFileSync(join(distAssets, cssFile), join(storeDir, 'index.css'));

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

const SHOTS = [
  { view: 'icon', file: 'okey-icon-512.png', width: 512, height: 512 },
  { view: 'icon', file: 'okey-icon-1024.png', width: 1024, height: 1024 },
  { view: 'cover', file: 'okey-cover-1280x720.png', width: 1280, height: 720 },
  { view: 'portrait', file: 'okey-cover-1080x1920.png', width: 1080, height: 1920 },
];

const artFile = join(storeDir, 'art.html').replace(/\\/g, '/');
for (const shot of SHOTS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: shot.width,
    height: shot.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: `file:///${artFile}?view=${shot.view}` });
  await loaded;
  await sleep(600);
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(storeDir, shot.file), Buffer.from(image.data, 'base64'));
  console.log('saved', shot.file, `${shot.width}x${shot.height}`);
}

ws.close();
chrome.kill();
process.exit(0);
