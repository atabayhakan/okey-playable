// Checks the layout of the web build at many screen sizes, in headless Chrome: nothing may
// overlap, run off the screen or make the page scroll sideways.
//
//   npm run check:layout        builds the web build, then checks it
//
// It serves dist-web/ itself, deals fixed hands (`?seed=`, which only the web build and the dev
// server accept) and probes these states at every size:
//   - the opening hand with the Show button for the indicator (the tallest state of the
//     middle row),
//   - the same hand with the hint showing (the longest text in the status bar), and
//   - the player's turn to draw, with a tile waiting in front of them, after a few moves.
// Needs Chrome or Edge (CHROME_PATH overrides the lookup). Exits 1 when a probe fails.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webDir = join(root, 'dist-web');
if (!existsSync(join(webDir, 'index.html'))) {
  console.error('dist-web/ is missing. Run npm run check:layout, or npm run build:web first.');
  process.exit(1);
}

const chromePath = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
  .filter(Boolean)
  .find((p) => existsSync(p));
if (!chromePath) {
  console.error('No Chrome found. Set CHROME_PATH and run again.');
  process.exit(1);
}

/** Seed 9 deals the first hand with the twin of the indicator in the player's hand. */
const SEED_WITH_TWIN = 9;

/** Portrait and landscape, from a tiny pane to a desktop window. */
const SIZES = [
  [240, 300], [280, 320], [300, 400], [320, 568], [340, 420], [360, 640], [375, 812], [390, 844], [768, 1024],
  [420, 247], [500, 250], [568, 320], [667, 375], [740, 360], [844, 390], [932, 430], [1024, 600], [1280, 720],
];
/** The draw state needs the bots to play a few moves, which takes seconds: only these sizes. */
const DRAW_STATE_SIZES = new Set(['280x320', '360x640', '390x844', '420x247', '568x320', '667x375', '844x390', '1280x720']);

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

const port = 9400 + Math.floor(Math.random() * 300);
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--no-first-run',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), 'okey-layout-'))}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const finish = (code) => {
  chrome.kill();
  server.close();
  process.exit(code);
};

let target;
for (let i = 0; i < 100 && !target; i++) {
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page');
  } catch {
    /* still starting */
  }
  if (!target) await sleep(150);
}
if (!target) {
  console.error('Chrome did not start.');
  finish(1);
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

/**
 * In the page: which parts of the table overlap, run off the screen, or make the page wider than
 * the window. A pile counter or an indicator that spills into the toolbar is what this is for.
 */
const PROBE = `(() => {
  const selectors = ['.seat.top', '.seat.left', '.seat.right', '.center', '.pile-count', '.pile', '.indicator',
    '.discard.tl', '.discard.tr', '.discard.bl', '.discard.br', '.discard.br .hint', '.status', '.toolbar', '.rack'];
  const rects = selectors.flatMap((s) => [...document.querySelectorAll(s)].map((e) => [s, e.getBoundingClientRect()]));
  // Parts that sit inside each other on purpose.
  const nested = new Set(['.center|.pile-count', '.center|.pile', '.center|.indicator', '.pile-count|.pile', '.discard.br|.discard.br .hint']);
  const overlaps = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      if (nested.has(rects[i][0] + '|' + rects[j][0])) continue;
      const a = rects[i][1], b = rects[j][1];
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 1 && h > 1) overlaps.push(rects[i][0] + ' x ' + rects[j][0] + ' (' + Math.round(w) + 'x' + Math.round(h) + ')');
    }
  }
  const off = rects
    .filter(([, r]) => r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1)
    .map(([s]) => s);
  const tile = parseFloat(getComputedStyle(document.getElementById('app')).getPropertyValue('--tile-w'));
  return {
    overlaps, off,
    sideways: document.documentElement.scrollWidth > innerWidth + 1,
    tile,
    ready: Boolean(document.querySelector('.table')),
    show: Boolean(document.querySelector('.indicator.has-action')),
  };
})()`;

/** A tile thrown and the bots' answers, until it is the player's turn to draw again. */
const PLAY_TO_DRAW = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (s) => document.querySelector(s)?.click();
  const tile = document.querySelector('.rack .tile.fresh') || document.querySelector('.rack [data-tile-id]');
  tile?.click();
  await wait(150);
  click('button.discard[data-action="discard"]');
  for (let t = 0; t < 120; t++) {
    await wait(250);
    if (document.querySelector('button.pile') && !document.querySelector('button.pile').disabled) return true;
  }
  return false;
})()`;

const failures = [];
const note = (size, state, problem) => failures.push(`${size} ${state}: ${problem}`);

for (const [width, height] of SIZES) {
  const size = `${width}x${height}`;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'about:blank' });
  let loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: `${base}?lang=en&seed=${SEED_WITH_TWIN}` });
  await loaded;
  // A clean save, so the seeded deal is the one that appears.
  await evaluate('localStorage.clear()');
  loaded = once('Page.loadEventFired');
  await send('Page.reload');
  await loaded;
  for (let t = 0; t < 40 && !(await evaluate(`Boolean(document.querySelector('.table'))`)); t++) await sleep(150);
  await evaluate(`document.querySelector('[data-action="close-coach"]')?.click()`);
  await sleep(500);

  const check = (state, probe) => {
    if (!probe.ready) return note(size, state, 'the table did not appear');
    if (probe.overlaps.length) note(size, state, `overlaps: ${probe.overlaps.join(', ')}`);
    if (probe.off.length) note(size, state, `off the screen: ${probe.off.join(', ')}`);
    if (probe.sideways) note(size, state, 'the page scrolls sideways');
    if (probe.tile < 20) note(size, state, `tiles are ${probe.tile}px, below the 20px floor`);
  };

  const opening = await evaluate(PROBE);
  check('opening', opening);
  if (!opening.show) note(size, 'opening', 'the Show button is missing: the seeded deal is not the one expected');

  // The hint puts a longer text in the status bar ("Throw this one: 2 tiles from winning").
  if (await evaluate(`Boolean(document.querySelector('[data-action="hint"]'))`)) {
    await evaluate(`document.querySelector('[data-action="hint"]').click()`);
    await sleep(300);
    check('hint', await evaluate(PROBE));
  } else {
    note(size, 'hint', 'the hint button is missing in the opening hand');
  }

  if (DRAW_STATE_SIZES.has(size)) {
    const reached = await evaluate(PLAY_TO_DRAW);
    if (!reached) note(size, 'draw', 'the bots never gave the turn back');
    else check('draw', await evaluate(PROBE));
  }
  console.log(`${size.padEnd(9)} ${failures.some((f) => f.startsWith(size + ' ')) ? 'FAIL' : 'ok'}`);
}

ws.close();
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  ${f}`);
  finish(1);
}
console.log(`\nLayout ok at ${SIZES.length} sizes.`);
finish(0);
