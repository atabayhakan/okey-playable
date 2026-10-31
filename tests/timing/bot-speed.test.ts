import { describe, expect, it } from 'vitest';
import { botPlanDiscard, type Difficulty } from '../../src/core/bot';
import { dealRound } from '../../src/core/game';

/**
 * How long a bot takes to decide. These are the only tests that depend on how fast the machine is, so they do
 * not run with the rest: `npm test` runs them afterwards, alone, one file at a time (vitest.timing.config.ts).
 * Next to the other test files, on a machine that is busy with them, the same decision took twice as long or
 * more, and the test failed for reasons that were not the bot's.
 */

/** Only what the timing needs; the project does not pull in the Node typings. */
declare const process: { cpuUsage(previous?: { user: number; system: number }): { user: number; system: number } };

describe('the bots are cheap enough to run on a phone', () => {
  // A decision is a few dozen searches. A phone is several times slower than the machine this runs on, and
  // a bot waits a third of a second or more before it moves, so these limits keep the pause short.
  const limitMs: Partial<Record<Difficulty, number>> = { normal: 12, hard: 60 };

  for (const level of ['normal', 'hard'] as Difficulty[]) {
    it(`${level} decides quickly`, () => {
      // CPU time of this process: it does not count the time the machine spent on something else. The best of
      // three runs still drops a stray hiccup.
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const start = process.cpuUsage();
        let decisions = 0;
        for (let seed = 1; seed <= 25; seed++) {
          const r = dealRound(seed, 0);
          botPlanDiscard(r, 0, level);
          decisions++;
        }
        const used = process.cpuUsage(start);
        best = Math.min(best, (used.user + used.system) / 1000 / decisions);
      }
      expect(best).toBeLessThan(limitMs[level]!);
    });
  }
});
