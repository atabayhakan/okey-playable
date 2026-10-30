// Plays the web build through its own screen, in headless Chrome, the way a person would: three hands of the
// match and the daily deal, by clicking. It fails on anything that goes wrong on the way.
//
//   npm run check:ui        builds the web build, then checks it
//
// It makes two passes over a fresh game, and looks at:
//   - the page reports no uncaught error and writes nothing to console.error
//   - every hand reaches its result, the result's scores agree with the table of the next hand, and the
//     next hand has the right tiles
//   - the daily deal runs and hands the match back
//   - accessibility (pass 1): an axe-core scan and a contrast check of the rules card, the table, the menu,
//     the statistics, and the results of a match hand and of the daily deal
//   - the save the game writes, and that a reload picks the game up again (pass 2)
//   - memory (pass 2): the JS heap and the number of DOM nodes at the start of each hand, for a phone with
//     little of it. A leak shows as growth from hand to hand
// Needs Chrome or Edge (CHROME_PATH overrides the lookup). Exits 1 when a check fails.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, root, sleep } from './lib/browser.mjs';

/** A phone: the size most players have. The layout check covers the other sizes. */
const WIDTH = 390;
const HEIGHT = 844;
/** Hands of the match to play. SMOKE_HANDS=12 for a long run when looking for a leak. */
const HANDS = Number(process.env.SMOKE_HANDS ?? 3);
/** A hand the bots play out takes seconds with the quick pace; this is the limit before it counts as stuck. */
const HAND_TIMEOUT_MS = 180_000;
/**
 * Memory, for a phone with little of it. The page is about 1.4 MB of heap and 220 nodes at the start of a hand
 * (flat over 10 runs of three hands, once the animations are ended before the reading: see `memory`). The limits
 * are far above that, so only a real leak, which is growth that stays, or a bloated page fails.
 */
const MAX_HEAP_MB = 40;
const MAX_HEAP_GROWTH_MB = 8;
const MAX_NODES = 2000;
const MAX_NODE_GROWTH = 400;

const { send, evaluate, navigate, freshGame, errors, hasCrashed, finish, close } = await launch('check:ui');

const failures = [];
const fail = (where, problem) => failures.push(`${where}: ${problem}`);
const log = (line) => console.log(line);

await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

// ---- Helpers in the page ------------------------------------------------------------------------

const AXE_SOURCE = readFileSync(join(root, 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const injectAxe = () => evaluate(AXE_SOURCE);

/** Accessibility violations on the screen as it is now: rule, impact and the first few elements. */
const scan = async (where) => {
  const found = await evaluate(`(async () => {
    const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } });
    return {
      violations: r.violations.map((v) => ({
        id: v.id, impact: v.impact, help: v.help,
        nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ') + ' :: ' + n.html.slice(0, 110) + ' :: ' + (n.any[0]?.message ?? n.all[0]?.message ?? n.none[0]?.message ?? '')),
        count: v.nodes.length,
      })),
      // What axe could not decide (text on a gradient or a translucent bar): these need a person's eyes.
      undecided: r.incomplete.map((v) => v.id + ' x' + v.nodes.length),
    };
  })()`);
  for (const v of found.violations) fail(`accessibility, ${where}`, `${v.id} (${v.impact}, ${v.count}x): ${v.help}\n      ${v.nodes.join('\n      ')}`);
  const undecided = found.undecided.length ? `, undecided: ${found.undecided.join(', ')}` : '';
  log(`  a11y ${where.padEnd(22)} ${found.violations.length ? `${found.violations.length} rule(s) broken` : 'ok'}${undecided}`);
  await contrast(where);
};

/**
 * Text contrast, worked out here because axe cannot: it gives up on text over a gradient or a translucent bar,
 * which is all of the table. Each piece of text is composited over the layers behind it; where the ground is a
 * gradient (the felt, a tile's face) the worst of its colours is used. The suit marks on the tiles repeat what
 * the shape says, so they need 3:1 like any graphic; text needs 4.5:1 (3:1 when large).
 */
const CONTRAST = `(() => {
  const root = getComputedStyle(document.documentElement);
  const parse = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const named = (v) => { const el = document.createElement('i'); el.style.color = v.startsWith('--') ? root.getPropertyValue(v) : v; document.body.appendChild(el); const c = parse(getComputedStyle(el).color); el.remove(); return c; };
  const felt = ['--felt-hi', '--felt-mid', '--felt-lo'].map(named);
  const face = ['--tile-face-hi', '--tile-face', '#efe5d0'].map(named);
  const bad = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!el.isConnected || el.closest('.sr-only') || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[disabled]')) continue;
    const fg0 = parse(cs.color);
    const fg = { ...fg0, a: fg0.a * Number(cs.opacity) };
    // A tile's face is a gradient that sits in front of whatever is behind the tile (even a solid dialog).
    const onTile = Boolean(el.closest('.tile'));
    const layers = [];
    for (let e = el; !onTile && e && e !== document.documentElement; e = e.parentElement) {
      const bg = parse(getComputedStyle(e).backgroundColor);
      if (bg && bg.a > 0) { layers.push(bg); if (bg.a >= 1) break; }
    }
    const solid = layers.length > 0 && layers.at(-1).a >= 1;
    const bases = onTile ? face : solid ? [layers.pop()] : felt;
    const worst = Math.min(...bases.map((base) => { let bg = base; for (const l of [...layers].reverse()) bg = over(l, bg); return ratio(over(fg, bg), bg); }));
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const need = el.classList.contains('mark') ? 3 : large ? 3 : 4.5;
    const key = (el.className || el.tagName) + '|' + el.textContent.trim().slice(0, 20);
    if (worst < need && !seen.has(key)) { seen.add(key); bad.push(worst.toFixed(2) + ' < ' + need + ' (' + Math.round(size) + 'px) ' + key); }
  }
  return bad;
})()`;
const contrast = async (where) => {
  for (const line of await evaluate(CONTRAST)) fail(`contrast, ${where}`, line);
};

const click = (selector) => evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.disabled) return false; e.click(); return true; })()`);
const exists = (selector) => evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);

/** One move of a player who draws from the pile and throws the tile just drawn (or the first one). */
const STEP = `(() => {
  const q = (s) => document.querySelector(s);
  if (q('.modal #result-title')) return 'result';
  const pile = q('button.pile');
  if (pile && !pile.disabled) { pile.click(); return 'drew'; }
  const target = q('button.discard[data-action="discard"]');
  if (target && !target.disabled) {
    if (!q('.rack .tile.selected')) {
      const tile = q('.rack .tile.fresh') || q('.rack [data-tile-id]');
      if (!tile) return 'no tile on the rack';
      tile.click();
      return 'picked';
    }
    target.click();
    return 'threw';
  }
  return 'waiting';
})()`;

/** Plays until the result dialog is up. Returns the number of moves, or null when the hand got stuck. */
async function playHand(label) {
  const started = Date.now();
  let moves = 0;
  while (Date.now() - started < HAND_TIMEOUT_MS) {
    const state = await evaluate(STEP);
    if (state === 'result') return moves;
    if (state === 'no tile on the rack') {
      fail(label, 'it is the player’s turn to throw and the rack has no tile');
      return null;
    }
    if (state !== 'waiting') moves++;
    if (hasCrashed()) {
      fail(label, 'the page crashed');
      return null;
    }
    await sleep(state === 'waiting' ? 120 : 160);
  }
  fail(label, `the hand did not end in ${HAND_TIMEOUT_MS / 1000} s (${moves} moves made)`);
  return null;
}

/** The scores in the result dialog, and the points the table shows after the next hand starts. */
const RESULT_POINTS = `[...document.querySelectorAll('.modal .scores tbody tr')].map((tr) => ({ name: tr.querySelector('th').textContent, lost: tr.children[1].textContent, points: Number(tr.children[2].textContent) }))`;
const TABLE_POINTS = `[...[...document.querySelectorAll('.seat .points')].map((e) => e.textContent), document.querySelector('.score').textContent.split('·')[0]].map((s) => Number(s.replace(/[^0-9-]/g, '')))`;

/** Memory after a collection: what the hand left behind, not what is waiting to be freed. */
async function memory() {
  // An animation that has not finished holds its element, and the element holds the whole table it was redrawn
  // out of (through its parent): a flight still going when the sample is taken reads as a few hundred nodes of
  // leak. Ending them first leaves only what the game keeps by mistake.
  await evaluate('document.getAnimations().forEach((a) => a.cancel())');
  await send('HeapProfiler.collectGarbage');
  await sleep(300);
  await send('HeapProfiler.collectGarbage');
  const { metrics } = await send('Performance.getMetrics');
  const get = (name) => metrics.find((m) => m.name === name)?.value ?? 0;
  const documents = (await send('Memory.getDOMCounters')).documents;
  // What the page is made of, for when the node count grows: the most common classes in the DOM.
  const census = await evaluate(`(() => {
    const count = {};
    for (const e of document.querySelectorAll('body *')) { const k = e.tagName.toLowerCase() + '.' + String(e.className?.baseVal ?? e.className).split(' ')[0]; count[k] = (count[k] ?? 0) + 1; }
    return Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => k + ' x' + n).join(', ');
  })()`);
  return { heapMB: get('JSHeapUsedSize') / 1048576, nodes: get('Nodes'), listeners: get('JSEventListeners'), documents, census };
}

// ---- The two passes ---------------------------------------------------------------------------------
//
// The accessibility scan and the memory readings are kept apart: axe-core keeps a copy of what it scanned (its
// virtual tree) and so adds a couple of megabytes of heap and, from time to time, hundreds of nodes that have
// nothing to do with the game. Memory is read on a page that never had it.

/** The rules card: closed. Quick opponents, so the check does not wait for slow ones; hard ones, so the search runs. */
async function setUp(scanScreens) {
  if (!(await exists('.table'))) fail('start', 'the table did not appear');
  if (await evaluate('document.hidden')) fail('start', 'the browser page is hidden (the check cannot run)');
  // The rules card is the first thing a new player sees.
  if (!(await exists('[data-action="close-coach"]'))) fail('start', 'a new player does not get the rules card');
  if (scanScreens) await scan('rules card');
  await click('[data-action="close-coach"]');
  await sleep(400);
  if (scanScreens) await scan('table');

  await click('[data-action="open-menu"]');
  await sleep(200);
  if (scanScreens) await scan('menu');
  await click('[data-action="bot-pace"][data-pace="quick"]');
  await click('[data-action="difficulty"][data-level="hard"]');
  await click('[data-action="open-stats"]');
  await sleep(200);
  if (scanScreens) await scan('statistics');
  await click('[data-action="close-stats"]');
  await click('[data-action="close-menu"]');
  await sleep(200);
  if (await exists('.modal')) fail('menu', 'the menu did not close');
}

/**
 * Plays a hand of the match to its result, checks the result, and deals the next hand.
 * Returns the state of the next hand once it has settled, or null when something stopped the check.
 */
async function matchHand(label, { scanResult }) {
  const tilesAtStart = await evaluate(`document.querySelectorAll('.rack [data-tile-id]').length`);
  if (![14, 15].includes(tilesAtStart)) fail(label, `the rack starts with ${tilesAtStart} tiles, not 14 or 15`);

  const moves = await playHand(label);
  if (moves === null) return null;
  await sleep(400);
  const title = await evaluate(`document.querySelector('.modal #result-title')?.textContent ?? ''`);
  const rows = await evaluate(RESULT_POINTS);
  log(`  ${label.padEnd(22)} ${moves} moves, "${title}"`);
  if (!title) fail(label, 'the result has no title');
  if (rows.length !== 4) fail(label, `the score table has ${rows.length} rows, not 4`);
  if (scanResult) await scan('match result');

  const matchOver = await exists('.modal .match-over');
  await click('[data-action="next-hand"]');
  // An ad may be asked for between hands: the web build has none, so the next hand is dealt at once.
  let ready = false;
  for (let t = 0; t < 60 && !ready; t++) {
    await sleep(150);
    ready = !(await exists('.modal')) && (await exists('.rack [data-tile-id]'));
  }
  if (!ready) {
    fail(label, 'the next hand did not appear after "Next hand"');
    return null;
  }
  await sleep(1000);
  // What the result table said is what the table of the next hand shows.
  if (!matchOver) {
    const shown = await evaluate(TABLE_POINTS);
    // The two lists name the seats in a different order: compare the numbers.
    const a = rows.map((r) => r.points).sort((x, y) => x - y).join(',');
    const b = [...shown].sort((x, y) => x - y).join(',');
    if (a !== b) fail(label, `the result said the points are ${a}, the next hand's table shows ${b}`);
  }
  return { matchOver };
}

/** The daily deal from the menu to "Back to the match", and the match is where it was. */
async function dailyDeal({ scanResult }) {
  await click('[data-action="open-menu"]');
  await sleep(200);
  if (!(await click('[data-action="daily"]'))) {
    fail('daily deal', 'the Daily deal button is missing or off in the menu');
    return;
  }
  await sleep(1200);
  const badge = await evaluate(`document.querySelector('.score')?.textContent ?? ''`);
  if (badge !== 'Daily deal') fail('daily deal', `the table does not say it is the daily deal (it says "${badge}")`);
  const moves = await playHand('daily deal');
  if (moves === null) return;
  await sleep(400);
  log(`  ${'daily deal'.padEnd(22)} ${moves} moves, "${await evaluate(`document.querySelector('.modal #result-title')?.textContent ?? ''`)}"`);
  if (scanResult) await scan('daily result');
  await click('[data-action="next-hand"]');
  await sleep(800);
  if (await exists('.modal')) fail('daily deal', 'the result did not close with "Back to the match"');
  if ((await evaluate(`document.querySelector('.score')?.textContent ?? ''`)) === 'Daily deal') fail('daily deal', 'the match did not come back');
  await click('[data-action="open-menu"]');
  await sleep(200);
  if (!(await evaluate(`document.querySelector('[data-action="daily"]')?.disabled === true`))) fail('daily deal', 'the Daily deal button is still on after the deal was played');
  await click('[data-action="close-menu"]');
}

log(`${WIDTH}x${HEIGHT}`);

// Pass 1: what a person using a screen reader or a magnifier meets, screen by screen.
log('accessibility pass');
await freshGame('lang=en');
await injectAxe();
await setUp(true);
await matchHand('match hand', { scanResult: true });
await dailyDeal({ scanResult: true });

// Pass 2: three hands and the daily deal, the save, a reload and the memory, on a page without axe.
log('play pass');
await freshGame('lang=en');
await setUp(false);
const heap = [];
for (let hand = 1; hand <= HANDS; hand++) {
  const next = await matchHand(`match hand ${hand}`, { scanResult: false });
  if (!next) break;
  // Memory is read at the start of the next hand, when nothing is in flight: a result screen still has tiles
  // and animations in motion, whose nodes come and go.
  heap.push(await memory());
}
await dailyDeal({ scanResult: false });

// What the game wrote down.
const saved = JSON.parse((await evaluate(`localStorage.getItem('okey-save') || 'null'`)) ?? 'null');
if (!saved) {
  fail('save', 'nothing was saved');
} else {
  if (saved.v !== 9) fail('save', `the save is version ${saved.v}, not 9`);
  if (saved.stats.played !== HANDS) fail('save', `the save counts ${saved.stats.played} hands played, not ${HANDS}`);
  if (saved.daily.played !== 1) fail('save', `the save counts ${saved.daily.played} daily deals played, not 1`);
  if (saved.dailyDate !== null) fail('save', 'the save still has the daily deal on the table');
  if (saved.tutorial !== 3) fail('save', 'the first-hand guide did not end after a whole hand');
  if (saved.botPace !== 'quick' || saved.difficulty !== 'hard') fail('save', 'the settings chosen in the menu were not saved');
}

// A reload picks the game up where it was.
const tilesOnRack = `[...document.querySelectorAll('.rack [data-tile-id]')].map((e) => e.dataset.tileId).sort().join(',')`;
const before = await evaluate(tilesOnRack);
await navigate(`${await evaluate('location.origin')}/?lang=en`);
for (let t = 0; t < 60 && !(await exists('.table')); t++) await sleep(150);
await sleep(600);
if (before !== (await evaluate(tilesOnRack))) fail('reload', 'the hand after a reload is not the hand that was on the table');
else log(`  ${'reload'.padEnd(22)} the same hand is back`);

// ---- Memory and errors ----------------------------------------------------------------------------

if (heap.length) {
  log(`  memory at the start of each next hand: ${heap.map((m) => `${m.heapMB.toFixed(1)} MB, ${m.nodes} nodes, ${m.listeners} listeners, ${m.documents} document(s)`).join(' | ')}`);
  const worst = Math.max(...heap.map((m) => m.heapMB));
  if (worst > MAX_HEAP_MB) fail('memory', `the heap reached ${worst.toFixed(1)} MB (limit ${MAX_HEAP_MB})`);
  const mostNodes = Math.max(...heap.map((m) => m.nodes));
  if (mostNodes > MAX_NODES) fail('memory', `the page reached ${mostNodes} DOM nodes (limit ${MAX_NODES})`);
  // The first hand is compared with the lowest of the later ones, not with the last: a swing in one sample is
  // not growth, growth is what the lowest later sample still shows.
  const later = heap.slice(1);
  if (later.length) {
    const lowestHeap = Math.min(...later.map((m) => m.heapMB));
    if (lowestHeap - heap[0].heapMB > MAX_HEAP_GROWTH_MB) fail('memory', `the heap grew from ${heap[0].heapMB.toFixed(1)} to at least ${lowestHeap.toFixed(1)} MB over ${heap.length} hands (limit ${MAX_HEAP_GROWTH_MB} MB of growth)`);
    const lowestNodes = Math.min(...later.map((m) => m.nodes));
    if (lowestNodes - heap[0].nodes > MAX_NODE_GROWTH) {
      fail('memory', `the page went from ${heap[0].nodes} to at least ${lowestNodes} DOM nodes over ${heap.length} hands (limit ${MAX_NODE_GROWTH} of growth)\n      first: ${heap[0].census}\n      later: ${later.map((m) => m.census).join('\n             ')}`);
    }
  }
}
for (const e of errors) fail('page', e);
if (hasCrashed()) fail('page', 'the page crashed');

close();
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  ${f}`);
  finish(1);
}
console.log(`\nUI ok: ${HANDS} hands and the daily deal played, no errors, accessibility clean.`);
finish(0);
