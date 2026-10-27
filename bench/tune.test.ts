// Tries other values of the numbers the bots play by (`tuning` in src/core/bot.ts) and prints how
// the hard bot does with each. Each configuration plays the same deals, so the differences between
// them are not luck of the draw.
//
//   $env:BENCH_TUNE='[{},{"hardTakeMargin":99},{"pairBias":0}]'; npm run bench:bots -- bench/tune.test.ts
//
// BENCH_HANDS sets the hands per configuration (default 200); BENCH_ROLE is "hard" (default: one
// hard seat against three normal ones) or "easy" (all four seats easy, to see how many hands end).
import { it } from 'vitest';
import { botPlanDiscard, botWantsDiscard, tuning, type Difficulty } from '../src/core/bot';
import { canShowIndicator, dealRound, declareWin, discardTile, drawFromPile, showIndicator, takeDiscard } from '../src/core/game';

declare const process: { env: Record<string, string | undefined> };

const HANDS = Number(process.env.BENCH_HANDS ?? 200);
/** First hand index: processes with different values play different hands, and their counts add up. */
const FROM = Number(process.env.BENCH_FROM ?? 0);
const ROLE = process.env.BENCH_ROLE ?? 'hard';
const CONFIGS: Partial<typeof tuning>[] = JSON.parse(process.env.BENCH_TUNE ?? '[{}]');
const DEFAULTS = { ...tuning };

/** Time and count of the hard bot's decisions, to see what a setting costs. */
const hardCost = { ms: 0, calls: 0 };

function hand(seed: number, levels: Difficulty[], starter: number) {
  const r = dealRound(seed, starter);
  let discards = 0;
  while (r.phase !== 'roundOver') {
    const seat = r.turn;
    if (canShowIndicator(r, seat)) showIndicator(r, seat);
    const timed = levels[seat] === 'hard';
    const t0 = timed ? performance.now() : 0;
    if (r.phase === 'draw') {
      if (botWantsDiscard(r, seat, levels[seat])) takeDiscard(r, seat);
      else drawFromPile(r, seat);
    } else {
      const plan = botPlanDiscard(r, seat, levels[seat]);
      if (!(plan.win && declareWin(r, seat, plan.tileId))) discardTile(r, seat, plan.tileId);
      discards++;
    }
    if (timed) {
      hardCost.ms += performance.now() - t0;
      hardCost.calls++;
    }
  }
  return { r, discards };
}

for (const patch of CONFIGS) {
  it(`${ROLE} with ${JSON.stringify(patch)}`, () => {
    Object.assign(tuning, DEFAULTS, patch);
    hardCost.ms = 0;
    hardCost.calls = 0;
    let wins = 0;
    let finished = 0;
    let lengths = 0;
    for (let i = FROM; i < FROM + HANDS; i++) {
      const seat = i % 4;
      // "easy", "all-normal", "all-hard": every seat on that level; "hard": one hard seat against three
      // normal; "duel-easy-hard": one easy seat against three hard ones (solo level first).
      const same = ROLE === 'easy' ? 'easy' : ROLE.startsWith('all-') ? (ROLE.slice(4) as Difficulty) : null;
      const [, soloLevel, restLevel] = ROLE.startsWith('duel-') ? ROLE.split('-') : [null, 'hard', 'normal'];
      const levels: Difficulty[] = same ? [same, same, same, same] : Array(4).fill(restLevel);
      if (!same) levels[seat] = soloLevel as Difficulty;
      const { r, discards } = hand(30_000 + i, levels, (i >> 2) % 4);
      lengths += discards;
      if (r.winner !== null) {
        finished++;
        if (r.winner === seat) wins++;
      }
    }
    Object.assign(tuning, DEFAULTS);
    const share = wins / Math.max(1, finished);
    const err = 196 * Math.sqrt((share * (1 - share)) / Math.max(1, finished));
    console.log(
      `\nTUNE ${ROLE} ${JSON.stringify(patch)}: ` +
        (ROLE === 'easy' || ROLE.startsWith('all-') ? '' : `soloWins=${(share * 100).toFixed(1)}% ±${err.toFixed(1)} `) +
        `finished=${((finished / HANDS) * 100).toFixed(0)}% avgDiscards=${(lengths / HANDS).toFixed(1)} (${HANDS} hands)` +
        (hardCost.calls ? ` hardMs/decision=${(hardCost.ms / hardCost.calls).toFixed(1)}` : '') +
        ` RAW wins=${wins} finished=${finished} hands=${HANDS} discards=${lengths} hardMs=${Math.round(hardCost.ms)} hardCalls=${hardCost.calls}`,
    );
  });
}
