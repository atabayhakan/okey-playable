// Bot benchmark: bots play many hands and the strength of the levels is measured.
//
//   npm run bench:bots                      300 hands per setting
//   $env:BENCH_HANDS=1000; npm run bench:bots
//   $env:BENCH_ONLY="duel"; npm run bench:bots      only "same" (one level) or "duel" (levels against each other)
//
// It is a test file only so that vitest can run the TypeScript sources as they are; it
// asserts nothing, it prints tables, one per test, as each one finishes. The guards that run
// in CI are tests/bot.test.ts and tests/bot-decisions.test.ts.
//
// The hard bot is slow to play against (a search per face, about 25-45 ms a decision): hundreds of
// hands with hard seats take a long time in one process. bench/run-tune.ps1 splits the same hands over
// many processes, and tries other values of the bots' `tuning` as well. See docs/BOTS.md.
import { it } from 'vitest';
import { botPlanDiscard, botWantsDiscard, type Difficulty } from '../src/core/bot';
import { canShowIndicator, dealRound, declareWin, discardTile, drawFromPile, showIndicator, takeDiscard, type RoundState } from '../src/core/game';

// Node's `process`, without pulling in all of @types/node for one variable.
declare const process: { env: Record<string, string | undefined> };

const HANDS = Number(process.env.BENCH_HANDS ?? 300);
const ONLY = process.env.BENCH_ONLY;
const LEVELS: Difficulty[] = ['easy', 'normal', 'hard'];

interface Played {
  r: RoundState;
  /** Discards of all players: the length of the hand. */
  discards: number;
  decisions: number;
  ms: number;
}

/** One hand with a difficulty per seat, played the way the controller plays it. */
function play(seed: number, levels: Difficulty[], starter: number): Played {
  const r = dealRound(seed, starter);
  let discards = 0;
  let decisions = 0;
  const t0 = performance.now();
  while (r.phase !== 'roundOver') {
    const seat = r.turn;
    const level = levels[seat];
    if (canShowIndicator(r, seat)) showIndicator(r, seat);
    decisions++;
    if (r.phase === 'draw') {
      if (botWantsDiscard(r, seat, level)) takeDiscard(r, seat);
      else drawFromPile(r, seat);
    } else {
      const plan = botPlanDiscard(r, seat, level);
      if (!(plan.win && declareWin(r, seat, plan.tileId))) discardTile(r, seat, plan.tileId);
      discards++;
    }
  }
  return { r, discards, decisions, ms: performance.now() - t0 };
}

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
/** 95% confidence half-width of a share, in points. */
const ci = (p: number, n: number): string => `±${(196 * Math.sqrt((p * (1 - p)) / Math.max(1, n))).toFixed(0)}`;

if (ONLY !== 'duel') {
  for (const level of LEVELS) {
    it(`all four seats on ${level}`, () => {
      let finished = 0;
      let pairs = 0;
      let decisions = 0;
      let ms = 0;
      const lengths: number[] = [];
      for (let i = 0; i < HANDS; i++) {
        const p = play(10_000 + i, [level, level, level, level], i % 4);
        lengths.push(p.discards);
        decisions += p.decisions;
        ms += p.ms;
        if (p.r.winner !== null) {
          finished++;
          if (p.r.winKind === 'pairs') pairs++;
        }
      }
      lengths.sort((a, b) => a - b);
      console.log(
        `\nSAME   ${level.padEnd(7)} hands=${HANDS} finished=${pct(finished / HANDS)} drawn=${pct(1 - finished / HANDS)} ` +
          `median=${lengths[lengths.length >> 1]} p90=${lengths[Math.floor(HANDS * 0.9)]} pairs=${pairs} ms/decision=${(ms / decisions).toFixed(2)}`,
      );
    });
  }
}

if (ONLY !== 'same') {
  // One seat on a level against three on another; the seat rotates, so the fair share is 25%.
  const duels: [Difficulty, Difficulty][] = [
    ['normal', 'easy'],
    ['hard', 'easy'],
    ['hard', 'normal'],
    ['easy', 'hard'],
  ];
  for (const [solo, rest] of duels) {
    it(`one ${solo} against three ${rest}`, () => {
      let soloWins = 0;
      let finished = 0;
      for (let i = 0; i < HANDS; i++) {
        const seat = i % 4;
        const levels: Difficulty[] = [rest, rest, rest, rest];
        levels[seat] = solo;
        const { r } = play(20_000 + i, levels, (i >> 2) % 4);
        if (r.winner !== null) {
          finished++;
          if (r.winner === seat) soloWins++;
        }
      }
      const share = soloWins / Math.max(1, finished);
      console.log(`\nDUEL   ${solo} vs 3x${rest}: wins ${pct(share)} ${ci(share, finished)} of ${finished} finished hands (fair 25%)`);
    });
  }
}
