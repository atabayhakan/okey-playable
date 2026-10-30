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
import { launch, sleep } from './lib/browser.mjs';

/** Seed 9 deals the first hand with the twin of the indicator in the player's hand. */
const SEED_WITH_TWIN = 9;

/** Portrait and landscape, from a tiny pane to a desktop window. */
const SIZES = [
  [240, 300], [280, 320], [300, 400], [320, 568], [340, 420], [360, 640], [375, 812], [390, 844], [768, 1024],
  [420, 247], [500, 250], [568, 320], [667, 375], [740, 360], [844, 390], [932, 430], [1024, 600], [1280, 720],
];
/** The draw state needs the bots to play a few moves, which takes seconds: only these sizes. */
const DRAW_STATE_SIZES = new Set(['280x320', '360x640', '390x844', '420x247', '568x320', '667x375', '844x390', '1280x720']);

const { send, evaluate, freshGame, hasCrashed, finish, close } = await launch('check:layout');

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
      const box = (r) => '[' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(',') + ']';
      if (w > 1 && h > 1) overlaps.push(rects[i][0] + box(a) + ' x ' + rects[j][0] + box(b) + ' (' + Math.round(w) + 'x' + Math.round(h) + ')');
    }
  }
  const off = rects
    .filter(([, r]) => r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1)
    .map(([s]) => s);
  const tile = parseFloat(getComputedStyle(document.getElementById('app')).getPropertyValue('--tile-w'));
  // For a failure: where the board and what is in it are, to see which part is taller than its room.
  const board = overlaps.length || off.length
    ? [...document.querySelectorAll('.table, .board, .board > *, .seat.top > *, .center > *, .toolbar, .rack')].map((e) => {
        const r = e.getBoundingClientRect();
        return (e.className || e.tagName) + '[' + [r.left, r.top, r.right, r.bottom].map(Math.round).join(',') + ']';
      }).concat(['--tile-w=' + getComputedStyle(document.getElementById('app')).getPropertyValue('--tile-w'), '--btw=' + getComputedStyle(document.getElementById('app')).getPropertyValue('--btw'), 'compact=' + document.getElementById('app').hasAttribute('data-compact'), 'rack tiles=' + document.querySelectorAll('.rack [data-tile-id]').length, '--cols=' + getComputedStyle(document.getElementById('app')).getPropertyValue('--cols'), 'rack rows=' + getComputedStyle(document.querySelector('.rack')).gridTemplateRows.split(' ').length, 'rack items=' + [...document.querySelectorAll('.rack > *')].map((e) => e.className.includes('gap') ? 'g' : e.className.includes('empty') ? 'e' : 't').join('')])
    : [];
  // The status bar's words, and whether the bar had to cut them (a guide step has to be read in full).
  const words = document.querySelector('.status-text');
  return {
    overlaps, off, board,
    status: words ? words.textContent : '',
    statusCut: Boolean(words) && (words.scrollWidth > words.clientWidth + 1 || words.scrollHeight > words.clientHeight + 1),
    sideways: document.documentElement.scrollWidth > innerWidth + 1,
    tile,
    ready: Boolean(document.querySelector('.table')),
    show: Boolean(document.querySelector('.indicator.has-action')),
  };
})()`;

/**
 * In the page: whether the dialog that is open keeps its contents inside itself and the screen, and whether a
 * button or a label had to cut its words. Long words in another language are what this is for.
 */
const MODAL_PROBE = `(() => {
  const modal = document.querySelector('.modal');
  if (!modal) return ['no dialog is open'];
  const box = modal.getBoundingClientRect();
  const problems = [];
  if (box.right > innerWidth + 1 || box.left < -1 || box.bottom > innerHeight + 1 || box.top < -1) problems.push('the dialog itself is off the screen');
  const name = (e) => (e.className && String(e.className).split(' ')[0] || e.tagName.toLowerCase()) + ' "' + e.textContent.trim().slice(0, 28) + '"';
  for (const e of modal.querySelectorAll('button, .chip, .label, dt, dd, th, td, p, h2, li, span')) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.right > box.right + 1 || r.left < box.left - 1) problems.push('sticks out of the dialog: ' + name(e));
    if ((e.matches('button, .chip, .label, dt, dd, th, td, h2')) && e.scrollWidth > e.clientWidth + 1) problems.push('cuts its words: ' + name(e));
  }
  const body = modal.querySelector('.modal-body');
  if (body && body.scrollWidth > body.clientWidth + 1) problems.push('the dialog body scrolls sideways');
  return problems;
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

/**
 * A wider font, to stand in for the fonts of other systems: the same layout has to hold when the text
 * is a few percent wider than on the machine it was made on (the Linux runner of the CI has wider ones
 * than Windows: the first run there found overlaps this machine did not show).
 */
const WIDE_FONT_CSS = `* { letter-spacing: ${process.env.LAYOUT_SPACING ?? '0.07'}em !important; }`;

/**
 * The other languages, at the sizes where a long word hurts most: a phone narrower than usual, a normal one, a
 * phone on its side and a desktop window. German and Dutch have the longest words.
 */
const LANGUAGE_SIZES = new Set(['280x320', '320x568', '360x640', '390x844', '568x320', '844x390', '1280x720']);

const PASSES = [
  { id: 'plain', name: '', lang: 'en', css: null, sizes: SIZES },
  { id: 'wide', name: 'wide font ', lang: 'en', css: WIDE_FONT_CSS, sizes: SIZES.filter(([w, h]) => DRAW_STATE_SIZES.has(`${w}x${h}`) || w === 320 || w === 340) },
  ...['tr', 'de', 'nl', 'az'].map((lang) => ({ id: lang, name: `${lang} `, lang, css: null, sizes: SIZES.filter(([w, h]) => LANGUAGE_SIZES.has(`${w}x${h}`)) })),
]
  // --no-stress leaves the wide-font pass out. The CI runs without it: its Linux fonts are already wider than
  // the ones the game was made with, so adding more makes a test of a world nobody plays in (it fails at
  // sizes where the plain pass on the same fonts is fine, and nothing like it shows on this machine).
  .filter((pass) => !(pass.css && process.argv.includes('--no-stress')))
  // --no-languages checks English only.
  .filter((pass) => !(pass.lang !== 'en' && process.argv.includes('--no-languages')))
  // LAYOUT_SPACING_ALL=0.07 puts the wide font on every pass, other languages too: the CI's Linux fonts are wider
  // than this machine's, and that is how a failure that only shows there can be made to show here.
  .map((pass) => ({ ...pass, css: pass.css ?? (process.env.LAYOUT_SPACING_ALL ? `* { letter-spacing: ${process.env.LAYOUT_SPACING_ALL}em !important; }` : null) }))
  // LAYOUT_FONT=Verdana sets every pass in that font. Verdana is about as wide as DejaVu Sans, the font the CI's
  // Linux runner falls back to, and it is on Windows: the closest thing here to the CI's text.
  .map((pass) => ({ ...pass, css: process.env.LAYOUT_FONT ? `${pass.css ?? ''} * { font-family: ${process.env.LAYOUT_FONT}, sans-serif !important; }` : pass.css }))
  // LAYOUT_ONLY="568x320" checks one size, and LAYOUT_PASS ("plain", "wide", "de"...) one pass, to look into a failure.
  .map((pass) => ({ ...pass, sizes: pass.sizes.filter(([w, h]) => !process.env.LAYOUT_ONLY || `${w}x${h}` === process.env.LAYOUT_ONLY) }))
  .filter((pass) => !process.env.LAYOUT_PASS || process.env.LAYOUT_PASS === pass.id);

for (const pass of PASSES) {
  for (const [width, height] of SIZES.filter((s) => pass.sizes.includes(s))) {
    const size = `${pass.name}${width}x${height}`;
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.bringToFront');
    // From a clean start: the saved game is cleared on a page that does not run the game (see freshGame).
    await freshGame(`lang=${pass.lang}&seed=${SEED_WITH_TWIN}`);
    // Say so if the page is hidden anyway: that explains a table that never appears, or bots that never move.
    if (await evaluate('document.hidden')) note(size, 'page', 'the browser page is hidden (the check cannot run)');
    if (pass.css) await evaluate(`document.head.appendChild(Object.assign(document.createElement('style'), { textContent: ${JSON.stringify(pass.css)} }))`);
    // The first thing a new player meets is the rules card.
    const dialog = async (state) => {
      for (const problem of await evaluate(MODAL_PROBE)) note(size, state, problem);
    };
    await dialog('rules card');
    await evaluate(`document.querySelector('[data-action="close-coach"]')?.click()`);
    await sleep(500);

    const check = (state, probe) => {
      if (!probe.ready) return note(size, state, 'the table did not appear');
      if (probe.overlaps.length) note(size, state, `overlaps: ${probe.overlaps.join(', ')}\n    board: ${probe.board.join(' ')}`);
      if (probe.off.length) note(size, state, `off the screen: ${probe.off.join(', ')}\n    board: ${probe.board.join(' ')}`);
      if (probe.sideways) note(size, state, 'the page scrolls sideways');
      if (probe.tile < 20) note(size, state, `tiles are ${probe.tile}px, below the 20px floor`);
    };

    const opening = await evaluate(PROBE);
    check('opening', opening);
    if (!opening.show) note(size, 'opening', 'the Show button is missing: the seeded deal is not the one expected');
    // The first-hand guide's first step is on the status bar here, and has to be read in full (from 320 px: the
    // two narrowest sizes are there to see that the table holds, not the words).
    if (width >= 320 && opening.statusCut) note(size, 'opening', `the guide step is cut: "${opening.status}"`);

    // The menu and the statistics: dialogs with rows of buttons, where a long word has nowhere to go.
    const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
    await click('[data-action="open-menu"]');
    await sleep(200);
    await dialog('menu');
    await click('[data-action="open-stats"]');
    await sleep(200);
    await dialog('statistics');
    await click('[data-action="close-stats"]');
    await click('[data-action="close-menu"]');
    await sleep(200);

    // The hint puts a longer text in the status bar ("Throw this one: 2 tiles from winning").
    if (await evaluate(`Boolean(document.querySelector('[data-action="hint"]'))`)) {
      await evaluate(`document.querySelector('[data-action="hint"]').click()`);
      await sleep(300);
      check('hint', await evaluate(PROBE));
    } else {
      note(size, 'hint', 'the hint button is missing in the opening hand');
    }

    if (DRAW_STATE_SIZES.has(`${width}x${height}`)) {
      const reached = await evaluate(PLAY_TO_DRAW);
      // A bot may finish the hand before it is the player's turn again: the result dialog is up, nothing to probe.
      const handOver = await evaluate(`Boolean(document.querySelector('.modal'))`);
      if (reached) check('draw', await evaluate(PROBE));
      else if (!handOver) note(size, 'draw', 'the bots never gave the turn back');
    }
    if (hasCrashed()) {
      note(size, 'crash', 'the page crashed');
      break;
    }
    console.log(`${size.padEnd(19)} ${failures.some((f) => f.startsWith(size + ' ')) ? 'FAIL' : 'ok'}`);
  }
}

close();
if (failures.length) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  ${f}`);
  finish(1);
}
const languages = [...new Set(PASSES.map((p) => p.lang))];
console.log(`\nLayout ok at ${SIZES.length} sizes${PASSES.some((p) => p.css) ? ', with a wider font' : ''}, in ${languages.join(', ')}.`);
finish(0);
