// Drives the web build in headless Chrome over the DevTools protocol, for the scripts that check it
// (layout-check.mjs, ui-smoke.mjs). It serves dist-web/ itself, so nothing else has to run.
//
// Needs Chrome or Edge (CHROME_PATH overrides the lookup).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  return [
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
}

/**
 * Starts the server and the browser. `command` names the npm script to suggest when dist-web/ is missing.
 * Returns what a check needs: `evaluate` (run code in the page), `navigate`, `send` (raw protocol),
 * `errors` (what the page reported as wrong: exceptions and console errors), `finish` (stop and exit).
 */
export async function launch(command) {
  const webDir = join(root, 'dist-web');
  if (!existsSync(join(webDir, 'index.html'))) {
    console.error(`dist-web/ is missing. Run npm run ${command}, or npm run build:web first.`);
    process.exit(1);
  }
  const chromePath = findChrome();
  if (!chromePath) {
    console.error('No Chrome found. Set CHROME_PATH and run again.');
    process.exit(1);
  }

  const server = createServer((req, res) => {
    // A page of the same origin that does not run the game: where the saved game is cleared, so that no
    // game that is still running can write its save back after it.
    if (req.url === '/blank') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>blank</title>');
      return;
    }
    // The game has no icon file; a browser asks for one anyway, and a 404 would be logged as an error.
    if (req.url === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
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
      // A headless page that has been navigated a lot is treated as a background one, and its timers (the
      // bots' waits among them) are slowed down: a check that is slow and flaky for no reason of the game's.
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      // The page left behind by a navigation would otherwise stay alive in the back/forward cache, and its
      // memory and nodes would be counted with the new page's (a check of the game's memory reads twice too much).
      '--disable-features=BackForwardCache',
      // Edge puts scripts of its own into some pages (its built-in extensions): they add a few megabytes of heap and
      // a dozen listeners to a reading, and report their own errors ("A listener indicated an asynchronous response
      // by returning true...") as if they were the game's. None of it is the game's.
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--no-default-browser-check',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${mkdtempSync(join(tmpdir(), 'okey-check-'))}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
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
  let crashed = false;
  /** What the page reported as wrong, with the page's own words. */
  const errors = [];
  /** The scripts of the page itself run in a default context; an extension's run in an isolated one of their own. */
  const foreign = new Set();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Inspector.targetCrashed') crashed = true;
    if (msg.method === 'Runtime.executionContextCreated' && msg.params.context.auxData?.isDefault === false) foreign.add(msg.params.context.id);
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      // Not the game's: a browser extension that put a script in the page.
      if (!foreign.has(d.executionContextId)) errors.push(`uncaught: ${d.exception?.description ?? d.text}`);
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error' && !foreign.has(msg.params.executionContextId)) {
      errors.push(`console.error: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push(`${msg.params.entry.source}: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`.trim());
    }
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

  /** Runs code in the page. A page that does not answer in a minute is hung: that is a failure, not a wait. */
  const evaluate = async (expression) => {
    const answer = send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    let timeout;
    const timer = new Promise((_, reject) => {
      timeout = setTimeout(async () => {
        // Stop the page where it is and say where that is: a hung page is a bug worth finding.
        let where = '';
        try {
          const paused = once('Debugger.paused');
          await send('Debugger.enable');
          await send('Debugger.pause');
          const stop = await Promise.race([paused, new Promise((r) => setTimeout(r, 5000, null))]);
          where = stop ? '\n  ' + stop.callFrames.slice(0, 8).map((f) => `${f.functionName || '(anonymous)'} ${f.url.split('/').pop()}:${f.location.lineNumber + 1}`).join('\n  ') : ' (it could not be paused)';
        } catch {
          where = ' (no stack)';
        }
        reject(new Error(`the page did not answer in 60 s; running ${expression.slice(0, 60).replace(/\s+/g, ' ')}...${where}`));
      }, 60_000);
    });
    const r = await Promise.race([answer, timer]).finally(() => clearTimeout(timeout));
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed');
    return r.result.value;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Inspector.enable');
  await send('Performance.enable');
  // A headless page that has been navigated a lot ends up "hidden": requestAnimationFrame stops (the game
  // waits for a frame to start) and the web build pauses itself, as it should for a hidden tab. Keep it visible.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Page.bringToFront');

  /** Loads `url` and waits for the page to be there. */
  const navigate = async (url) => {
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url });
    // A page that never finishes loading is a failure to report, not a reason to wait for ever (a check once
    // sat for two hours on one).
    let timeout;
    const late = new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`the page did not finish loading in 30 s: ${url}`)), 30_000);
    });
    await Promise.race([loaded, late]).finally(() => clearTimeout(timeout));
  };

  /**
   * The game, from a clean start: the saved game is cleared on a page that does not run the game (on the
   * game's own page, the game still running would write its save back after the clear), then the game loads
   * with `query` (`seed=7&lang=en`) and the page waits for the table.
   */
  const freshGame = async (query) => {
    await navigate(`${base}blank`);
    await evaluate('localStorage.clear()');
    await navigate(`${base}?${query}`);
    for (let t = 0; t < 60 && !(await evaluate(`Boolean(document.querySelector('.table'))`)); t++) await sleep(150);
  };

  return { base, send, once, evaluate, navigate, freshGame, errors, hasCrashed: () => crashed, finish, close: () => ws.close() };
}
