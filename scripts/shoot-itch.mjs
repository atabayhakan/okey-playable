// Takes the screenshots and the cover for the itch.io page from the real web build.
//
//   npm run build:web && node scripts/shoot-itch.mjs
//
// Serves dist-web/ itself (scripts/lib/browser.mjs), plays a few moves in headless Chrome so the table shows
// discards, and writes store/itch/*.png. Needs Chrome or Edge (CHROME_PATH overrides the lookup).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, root, sleep } from './lib/browser.mjs';

const outDir = join(root, 'store', 'itch');
mkdirSync(outDir, { recursive: true });

const { send, evaluate, freshGame, finish, close } = await launch('build:web');

// Pictures of a still table: with reduced motion the game draws no flights, fades or pulses, so no tile is
// caught half way across the felt and no status bar half faded in (the game honours the setting, DESIGN.md 2.5).
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

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

/** The player's rack put in order (Arrange > by sets), as a player would have it: groups with gaps between. */
const ARRANGE = `(async () => {
  document.querySelector('[data-action="sort-melds"]')?.click();
  await new Promise((r) => setTimeout(r, 400));
  document.querySelector('details.menu')?.removeAttribute('open');
  return document.querySelectorAll('.rack .tile.melded').length;
})()`;

/**
 * One more move of the player's, then the picture is taken while the next bot thinks: on a 390 px phone the
 * player's own prompts ("Draw from the pile, or take from your left") are longer than the status bar and end
 * in an ellipsis, a bot's turn ("Ali is thinking...") fits, and its seat wears the brass ring.
 */
const BOT_TURN = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (s) => document.querySelector(s)?.click();
  click('button.pile');
  await wait(500);
  (document.querySelector('.rack .tile.fresh') || document.querySelector('.rack [data-tile-id]'))?.click();
  await wait(200);
  click('button.discard[data-action="discard"]');
  await wait(450);
  const text = document.querySelector('.status-text');
  return { active: Boolean(document.querySelector('.seat.active')), clipped: text ? text.scrollHeight > text.clientHeight + 1 : false };
})()`;

const SHOTS = [
  // A fixed seed for each, so a run again gives the same deal; the two tables are different deals.
  { file: 'itch-1-table.png', width: 1280, height: 720, scale: 1, lang: 'en', seed: 9, arrange: true },
  { file: 'itch-2-table-tr.png', width: 1280, height: 720, scale: 1, lang: 'tr', seed: 4 },
  { file: 'itch-3-phone.png', width: 390, height: 844, scale: 2, lang: 'en', seed: 9, mobile: true, botTurn: true },
  { file: 'itch-cover-630x500.png', width: 630, height: 500, scale: 1, lang: 'en', seed: 9, arrange: true, botTurn: true },
];

for (const shot of SHOTS) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: shot.width,
    height: shot.height,
    deviceScaleFactor: shot.scale,
    mobile: Boolean(shot.mobile),
  });
  await freshGame(`lang=${shot.lang}&seed=${shot.seed}`);
  await sleep(500);
  const tiles = await evaluate(PLAY);
  if (shot.arrange) await evaluate(ARRANGE);
  if (shot.botTurn) {
    const state = await evaluate(BOT_TURN);
    if (!state.active || state.clipped) console.warn(`${shot.file}: not the moment wanted (${JSON.stringify(state)})`);
  }
  // No focus ring in a picture: the clicks above can leave a button focused.
  await evaluate('document.activeElement?.blur()');
  await sleep(150);
  const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(outDir, shot.file), Buffer.from(image.data, 'base64'));
  console.log('saved', shot.file, `${shot.width * shot.scale}x${shot.height * shot.scale}`, `(${tiles} tiles on the rack)`);
}

close();
finish(0);
