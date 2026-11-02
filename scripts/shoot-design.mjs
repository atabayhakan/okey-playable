// Screenshots of the web build for the design review, into docs/design-shots/ (see docs/DESIGN.md).
//
//   npm run build:web && node scripts/shoot-design.mjs [name ...]
//
// With no name it takes them all; with names (table-390x844-en, menu-390x844, ...) only those. The pictures
// are at 1x density, so the folder stays small; the scenes are the ones docs/DESIGN.md asks to check by eye
// (phone, small phone, phone on its side, desktop; tr, az, de; menu, rules card, statistics, result,
// colour-blind palette, splash). Needs Chrome or Edge (CHROME_PATH overrides the lookup).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, root, sleep } from './lib/browser.mjs';

const out = join(root, 'docs', 'design-shots');
mkdirSync(out, { recursive: true });
const only = new Set(process.argv.slice(2));
const want = (name) => only.size === 0 || only.has(name);

const { base, send, evaluate, freshGame, finish, close } = await launch('build:web');

const size = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
const shot = async (name) => {
  await sleep(450);
  // No focus ring in a picture: the scripted clicks leave the last button focused.
  await evaluate('document.activeElement?.blur()');
  await sleep(50);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(out, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`wrote ${name}.png`);
};
const click = (s) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(s)}); if (!e || e.disabled) return false; e.click(); return true; })()`);
const table = async (query) => {
  await freshGame(query);
  await sleep(300);
  await click('[data-action="close-coach"]');
  await sleep(900);
};

if (want('table-390x844-en')) {
  await size(390, 844);
  await table('lang=en&seed=9');
  await shot('table-390x844-en');
}
if (want('table-selected-390x844-en')) {
  await size(390, 844);
  await table('lang=en&seed=9');
  await click('.rack [data-tile-id]');
  await sleep(200);
  await click('[data-action="hint"]');
  await shot('table-selected-390x844-en');
}
if (want('table-360x640-az')) {
  await size(360, 640);
  await table('lang=az&seed=9');
  await shot('table-360x640-az');
}
if (want('table-568x320-tr')) {
  await size(568, 320);
  await table('lang=tr&seed=9');
  await shot('table-568x320-tr');
}
if (want('table-1280x720-de')) {
  await size(1280, 720);
  await table('lang=de&seed=9');
  await shot('table-1280x720-de');
}
if (want('rules-390x844')) {
  await size(390, 844);
  await freshGame('lang=en&seed=9');
  await shot('rules-390x844');
}
if (want('menu-390x844') || want('stats-390x844')) {
  await size(390, 844);
  await table('lang=en&seed=9');
  await click('[data-action="open-menu"]');
  await shot('menu-390x844');
  await click('[data-action="open-stats"]');
  await shot('stats-390x844');
}
if (want('colorblind-390x844')) {
  await size(390, 844);
  await table('lang=en&seed=9');
  await click('[data-action="open-menu"]');
  await sleep(200);
  await click('[data-action="palette"][data-palette="colorblind"]');
  await click('[data-action="close-menu"]');
  await shot('colorblind-390x844');
}
if (want('splash-390x844')) {
  // The splash is gone as soon as the game starts: put the one from index.html back in its place, so the
  // picture shows what the page really ships.
  await size(390, 844);
  await freshGame('lang=en&seed=9');
  const placed = await evaluate(`(async () => {
    const page = new DOMParser().parseFromString(await (await fetch(${JSON.stringify(base)})).text(), 'text/html');
    const splash = page.querySelector('.splash');
    if (!splash) return false;
    document.getElementById('app').innerHTML = splash.outerHTML;
    return true;
  })()`);
  if (!placed) console.warn('index.html has no .splash: splash-390x844 shows the table');
  await shot('splash-390x844');
}
if (want('result-390x844')) {
  await size(390, 844);
  await table('lang=en&seed=9');
  await click('[data-action="open-menu"]');
  await sleep(200);
  await click('[data-action="bot-pace"][data-pace="quick"]');
  await click('[data-action="close-menu"]');
  const STEP = `(() => {
    const q = (s) => document.querySelector(s);
    if (q('.modal #result-title')) return 'result';
    const pile = q('button.pile');
    if (pile && !pile.disabled) { pile.click(); return 'drew'; }
    const target = q('button.discard[data-action="discard"]');
    if (target && !target.disabled) {
      if (!q('.rack .tile.selected')) { (q('.rack .tile.fresh') || q('.rack [data-tile-id]')).click(); return 'picked'; }
      target.click(); return 'threw';
    }
    return 'waiting';
  })()`;
  const started = Date.now();
  while (Date.now() - started < 240_000 && (await evaluate(STEP)) !== 'result') await sleep(140);
  await sleep(900);
  await shot('result-390x844');
}

close();
finish(0);
