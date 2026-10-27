// Takes the screenshots and the cover for the itch.io page from the real web build.
//
//   npm run build:web && node scripts/shoot-itch.mjs
//
// Serves dist-web/ itself, plays a few moves in headless Chrome so the table shows
// discards, and writes store/itch/*.png. Needs Chrome (CHROME_PATH overrides the lookup).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webDir = join(root, 'dist-web');
const outDir = join(root, 'store', 'itch');
if (!existsSync(join(webDir, 'index.html'))) {
  console.error('dist-web/ is missing. Run npm run build:web first.');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const chromePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  join(process.env.LOCALAPPDATA ?? '', 'ms-playwright', 'chromium-1248', 'chrome-win64', 'chrome.exe'),
]
  .filter(Boolean)
  .find((p) => existsSync(p));
if (!chromePath) {
  console.error('No Chrome found. Set CHROME_PATH and run again.');
  process.exit(1);
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = join(webDir, req.url === '/' || req.url?.startsWith('/?') ? 'index.html' : (req.url ?? '').split('?')[0]);
  if (!path.startsWith(webDir) || !existsSync(path)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const port = 9700 + Math.floor(Math.random() * 200);
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'okey-itch-'))}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 80 && !target; i++) {
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
  } catch {
    /* still starting */
  }
  if (!target) await sleep(150);
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
const waiting = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject, method } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : resolve(msg.result);
  } else if (msg.method && waiting.has(msg.method)) {
    waiting.get(msg.method).splice(0).forEach((fn) => fn(msg.params));
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject, method });
    ws.send(JSON.stringify({ id, method, params }));
  });
const once = (method) => new Promise((resolve) => waiting.set(method, [...(waiting.get(method) ?? []), resolve]));
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');

/** Close the rules card, take a tile from the pile, throw one, and let the bots answer. */
const PLAY = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (s) => document.querySelector(s)?.click();
  click('[data-action="close-coach"]');
  await wait(300);
  const rounds = 2;
  for (let i = 0; i < rounds; i++) {
    for (let t = 0; t < 40 && document.querySelector('button.pile')?.disabled !== false; t++) await wait(250);
    click('button.pile');
    await wait(500);
    const tile = document.querySelector('.rack .tile.fresh') || document.querySelector('.rack [data-tile-id]');
    tile?.click();
    await wait(200);
    click('button.discard[data-action="discard"]');
    await wait(500);
  }
  for (let t = 0; t < 40 && document.querySelector('button.pile')?.disabled !== false; t++) await wait(250);
  await wait(800);
  return document.querySelectorAll('.rack [data-tile-id]').length;
})()`;

const SHOTS = [
  { file: 'itch-1-table.png', width: 1280, height: 720, scale: 1, lang: 'en' },
  { file: 'itch-2-table-tr.png', width: 1280, height: 720, scale: 1, lang: 'tr' },
  { file: 'itch-3-phone.png', width: 390, height: 844, scale: 2, lang: 'en', mobile: true },
  { file: 'itch-cover-630x500.png', width: 630, height: 500, scale: 1, lang: 'en' },
];

for (const shot of SHOTS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: shot.width,
    height: shot.height,
    deviceScaleFactor: shot.scale,
    mobile: Boolean(shot.mobile),
  });
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(100);
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: `${base}?lang=${shot.lang}` });
  await loaded;
  await evaluate('localStorage.clear()');
  const reloaded = once('Page.loadEventFired');
  await send('Page.reload');
  await reloaded;
  await sleep(800);
  const tiles = await evaluate(PLAY);
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(outDir, shot.file), Buffer.from(image.data, 'base64'));
  console.log('saved', shot.file, `${shot.width}x${shot.height}@${shot.scale}x`, `(${tiles} tiles on the rack)`);
}

ws.close();
chrome.kill();
server.close();
process.exit(0);
