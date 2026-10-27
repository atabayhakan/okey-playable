import { describe, expect, it } from 'vitest';
import { botPlanDiscard, botWantsDiscard, type Difficulty } from '../src/core/bot';
import { dealRound, declareWin, discardTile, drawFromPile, takeDiscard, MAX_HAND_TURNS, type RoundState } from '../src/core/game';

/**
 * How many hands a test plays on a level. The hard bot counts every tile that could still help with a
 * search per face, so a hand of four hard bots takes seconds: it gets a fifth of the hands. The
 * statistics are bench/bots.test.ts's job; these tests only guard that the bots behave.
 */
const handsFor = (level: Difficulty, n: number): number => (level === 'hard' ? Math.max(4, Math.round(n / 5)) : n);

/** Plays whole rounds with four bots and reports what they did. */
function play(difficulty: Difficulty, seeds: number): { takes: number; draws: number; rounds: number; wins: number } {
  let takes = 0;
  let draws = 0;
  let rounds = 0;
  let wins = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const r: RoundState = dealRound(seed, seed % 4);
    let steps = 0;
    while (r.phase !== 'roundOver') {
      if (++steps > 2000) throw new Error('round did not end');
      const seat = r.turn;
      if (r.phase === 'draw') {
        if (botWantsDiscard(r, seat, difficulty)) {
          takeDiscard(r, seat);
          takes++;
        } else {
          drawFromPile(r, seat);
          draws++;
        }
      } else {
        const plan = botPlanDiscard(r, seat, difficulty);
        if (!(plan.win && declareWin(r, seat, plan.tileId))) discardTile(r, seat, plan.tileId);
      }
    }
    rounds++;
    if (r.winner !== null) wins++;
  }
  return { takes, draws, rounds, wins };
}

describe('bot difficulty', () => {
  it('ends every round on every level', () => {
    for (const level of ['easy', 'normal', 'hard'] as Difficulty[]) {
      const hands = handsFor(level, 20);
      expect(play(level, hands).rounds).toBe(hands);
    }
  });

  it('never lets the tiles circulate forever', () => {
    // The bots used to take the tile in front of them over and over, so the
    // middle pile never emptied and the hand never ended. The safety net in
    // discardTile() ends such a hand, but it should never be needed: a hand
    // that runs into it is a bug.
    for (const level of ['easy', 'normal', 'hard'] as Difficulty[]) {
      let longest = 0;
      for (let seed = 1; seed <= handsFor(level, 30); seed++) {
        const r = dealRound(seed * 7919 + 1, seed % 4);
        let steps = 0;
        while (r.phase !== 'roundOver') {
          if (++steps > 1000) throw new Error(`hand did not end on ${level}`);
          const seat = r.turn;
          if (r.phase === 'draw') {
            if (botWantsDiscard(r, seat, level)) takeDiscard(r, seat);
            else drawFromPile(r, seat);
          } else {
            const plan = botPlanDiscard(r, seat, level);
            if (!(plan.win && declareWin(r, seat, plan.tileId))) discardTile(r, seat, plan.tileId);
          }
        }
        longest = Math.max(longest, steps);
      }
      // A healthy hand runs about a hundred turns. Reaching the safety net at
      // all means the pile stopped draining, which is the bug.
      expect(longest).toBeLessThan(MAX_HAND_TURNS);
    }
  });

  it('plays faster on normal and hard than on easy', () => {
    // How long a hand lasts, in thrown tiles. bench/bots.test.ts measures it on hundreds of hands:
    // about 30 on hard, 40 on normal, 65 or more on easy.
    const length = (level: Difficulty): number => {
      let total = 0;
      const hands = handsFor(level, 24);
      for (let seed = 1; seed <= hands; seed++) {
        const r = dealRound(seed * 104729 + 3, seed % 4);
        while (r.phase !== 'roundOver') {
          const seat = r.turn;
          if (r.phase === 'draw') {
            if (botWantsDiscard(r, seat, level)) takeDiscard(r, seat);
            else drawFromPile(r, seat);
          } else {
            const plan = botPlanDiscard(r, seat, level);
            total++;
            if (!(plan.win && declareWin(r, seat, plan.tileId))) discardTile(r, seat, plan.tileId);
          }
        }
      }
      return total / hands;
    };
    const easy = length('easy');
    expect(length('normal')).toBeLessThan(easy * 0.8);
    expect(length('hard')).toBeLessThan(easy * 0.8);
  });

  it('ends nearly every hand with a winner on hard, and most on the other levels', () => {
    // A hand that runs out of tiles without anybody finishing is dull. Hard brings a hand together
    // before the pile is gone almost every time (bench/bots.test.ts: about 98%), normal and easy
    // usually do (about 85% and 70% with all four seats on that level). So few hands are played that
    // the limits leave plenty of room: they catch a bot that has stopped finishing, not a few points.
    const limit: Record<Difficulty, number> = { easy: 0.55, normal: 0.32, hard: 0.3 };
    for (const level of ['easy', 'normal', 'hard'] as Difficulty[]) {
      let drawn = 0;
      const hands = handsFor(level, 40);
      for (let seed = 1; seed <= hands; seed++) {
        const r = dealRound(seed * 7919 + 1, seed % 4);
        let steps = 0;
        while (r.phase !== 'roundOver') {
          if (++steps > 1000) throw new Error('hand did not end');
          const seat = r.turn;
          if (r.phase === 'draw') {
            if (botWantsDiscard(r, seat, level)) takeDiscard(r, seat);
            else drawFromPile(r, seat);
          } else {
            const plan = botPlanDiscard(r, seat, level);
            if (!(plan.win && declareWin(r, seat, plan.tileId))) discardTile(r, seat, plan.tileId);
          }
        }
        if (r.winner === null) drawn++;
      }
      expect(drawn / hands, level).toBeLessThan(limit[level]);
    }
  });

  it('keeps the tiles of the hand', () => {
    for (const level of ['easy', 'normal', 'hard'] as Difficulty[]) {
      const r = dealRound(5, 0);
      let steps = 0;
      while (r.phase !== 'roundOver') {
        if (++steps > 2000) throw new Error('round did not end');
        const seat = r.turn;
        if (r.phase === 'draw') {
          if (botWantsDiscard(r, seat, level)) takeDiscard(r, seat);
          else drawFromPile(r, seat);
        } else {
          const plan = botPlanDiscard(r, seat, level);
          if (!(plan.win && declareWin(r, seat, plan.tileId))) discardTile(r, seat, plan.tileId);
        }
      }
      const all = [...r.pile, ...r.hands.flat(), ...r.discards.flat(), r.indicator, ...(r.finishTile ? [r.finishTile] : [])];
      expect(new Set(all.map((t) => t.id)).size).toBe(106);
    }
  });
});
