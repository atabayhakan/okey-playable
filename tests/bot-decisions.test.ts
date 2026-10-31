import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { botPlanDiscard, botWantsDiscard, tuning, type Difficulty } from '../src/core/bot';
import { dealRound, previousSeat, type RoundState } from '../src/core/game';
import type { Color, Face, Tile } from '../src/core/tile';

let nextId = 9000;
const n = (color: Color, value: number): Tile => ({ id: nextId++, kind: 'number', color, value });
const run = (color: Color, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => n(color, from + i));

/** Red 5 is the okey. */
const okey: Face = { color: 'red', value: 5 };

/** Eleven tiles in three finished melds: blue 7-10, the 4s of three colors, black 11-12-13-1. */
const melds = (): Tile[] => [...run('blue', 7, 10), n('yellow', 4), n('black', 4), n('blue', 4), ...run('black', 11, 13), n('black', 1)];

/** A table where `seat` holds `hand`, whatever the deal was. */
function table(hand: Tile[], seat = 1, offer?: Tile): RoundState {
  const r = dealRound(77, 0);
  r.okey = okey;
  r.indicator = { id: 1, kind: 'number', color: 'red', value: 4 };
  r.hands = r.hands.map(() => []);
  r.hands[seat] = hand;
  r.discards = r.discards.map(() => []);
  if (offer) r.discards[previousSeat(seat)] = [offer];
  r.turn = seat;
  r.phase = hand.length === 15 ? 'discard' : 'draw';
  r.turnsTaken = [1, 1, 1, 1];
  return r;
}

const SHARP: Difficulty[] = ['normal', 'hard'];

// The slips of the easy and normal levels are what these situations are not about: switch them off so
// the decisions are the ones the bots mean to make.
const slips = { easy: tuning.easyMistake, normal: tuning.normalMistake };
beforeEach(() => {
  tuning.easyMistake = 0;
  tuning.normalMistake = 0;
});
afterEach(() => {
  tuning.easyMistake = slips.easy;
  tuning.normalMistake = slips.normal;
});

describe('what the sharp bots throw', () => {
  it('finishes by throwing the spare tile', () => {
    const spare = n('yellow', 9);
    const hand = [...melds(), ...run('red', 1, 3), spare];
    for (const level of ['easy', ...SHARP] as Difficulty[]) {
      expect(botPlanDiscard(table(hand), 1, level)).toEqual({ tileId: spare.id, win: true });
    }
  });

  it('keeps the finished melds and the pair that wants a third tile, and throws a loose tile', () => {
    const junkA = n('yellow', 9);
    const junkB = n('black', 6);
    const hand = [...melds(), n('red', 1), n('red', 2), junkA, junkB];
    expect(hand).toHaveLength(15);
    for (const level of SHARP) {
      const plan = botPlanDiscard(table(hand), 1, level);
      expect(plan.win).toBe(false);
      expect([junkA.id, junkB.id], `${level} threw a tile that belongs to the hand`).toContain(plan.tileId);
    }
  });

  it('never throws the okey away', () => {
    const wild = n('red', 5);
    const hand = [...melds(), n('red', 1), n('red', 2), n('yellow', 9), wild];
    for (const level of ['easy', ...SHARP] as Difficulty[]) {
      for (let seed = 1; seed <= 8; seed++) {
        const r = table(hand);
        r.seed = seed * 101;
        expect(botPlanDiscard(r, 1, level).tileId, level).not.toBe(wild.id);
      }
    }
  });
});

describe('what the sharp bots take', () => {
  const loose = (): Tile[] => [...melds(), n('red', 1), n('red', 2), n('yellow', 9)];

  it('takes the tile that completes a run', () => {
    for (const level of SHARP) {
      expect(botWantsDiscard(table(loose(), 1, n('red', 3)), 1, level), level).toBe(true);
    }
  });

  it('leaves a tile that does not help, even one that looks friendly', () => {
    for (const level of SHARP) {
      // Red 13 is far from everything the hand is building.
      expect(botWantsDiscard(table(loose(), 1, n('red', 13)), 1, level), level).toBe(false);
    }
  });

  it('always takes the okey', () => {
    for (const level of ['easy', ...SHARP] as Difficulty[]) {
      expect(botWantsDiscard(table(loose(), 1, n('red', 5)), 1, level), level).toBe(true);
    }
  });

  it('takes a tile that finishes the hand, as long as it is not the easy bot', () => {
    // Six pairs, a single waiting for its twin and one loose tile: the offered tile is that twin.
    const pairs = [n('red', 1), n('red', 1), n('blue', 3), n('blue', 3), n('black', 9), n('black', 9), n('yellow', 9), n('yellow', 9), n('red', 12), n('red', 12), n('blue', 13), n('blue', 13), n('yellow', 2), n('black', 6)];
    expect(pairs).toHaveLength(14);
    for (const level of SHARP) {
      expect(botWantsDiscard(table(pairs, 1, n('yellow', 2)), 1, level), level).toBe(true);
    }
  });
});

describe('the hard bot counts the tiles that are gone', () => {
  it('keeps the hole that can still be filled and lets the dead one go', () => {
    // Two loose pairs of runs, each one tile short: red 6-7 (needs red 5-or-8: red 5 is the okey, so 8)
    // and blue 1-2 (needs blue 3). Both copies of blue 3 are in the discard piles: that hole is dead.
    const base = [...run('black', 9, 12), n('yellow', 4), n('black', 4), n('blue', 4), ...run('yellow', 9, 11)];
    const hand = [...base, n('red', 7), n('red', 8), n('blue', 1), n('blue', 2), n('black', 2)];
    expect(hand).toHaveLength(15);
    const r = table(hand);
    r.discards[0] = [n('blue', 3), n('blue', 3)];
    const plan = botPlanDiscard(r, 1, 'hard');
    const thrown = hand.find((t) => t.id === plan.tileId)!;
    // It must give up the dead hole (blue 1 or 2) or a loose tile, never the live one (red 7 or 8).
    expect(thrown.kind === 'number' && thrown.color === 'red' && (thrown.value === 7 || thrown.value === 8)).toBe(false);
  });
});
