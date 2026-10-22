import { describe, expect, it } from 'vitest';
import { botPlanDiscard, botWantsDiscard, type Difficulty } from '../src/core/bot';
import { dealRound, declareWin, discardTile, drawFromPile, takeDiscard, type RoundState } from '../src/core/game';

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
      const result = play(level, 20);
      expect(result.rounds).toBe(20);
    }
  });

  it('plays harder on hard than on easy', () => {
    const easy = play('easy', 30);
    const hard = play('hard', 30);
    const easyRate = easy.takes / (easy.takes + easy.draws);
    const hardRate = hard.takes / (hard.takes + hard.draws);
    // A sharp opponent grabs the tile in front of it; a clumsy one waits.
    expect(hardRate).toBeGreaterThan(easyRate);
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
