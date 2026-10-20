import { describe, expect, it } from 'vitest';
import { arrangePairs, arrangeRuns, RACK_SLOTS } from '../src/app/rack';
import { parseSave, serializeSave, emptySave } from '../src/app/save';
import { botPlanDiscard, botWantsDiscard } from '../src/core/bot';
import { TILE_COUNT } from '../src/core/deck';
import { dealRound, declareWin, discardTile, drawFromPile, takeDiscard, type RoundState } from '../src/core/game';
import { isWinningHand } from '../src/core/hand';

const allTiles = (r: RoundState) => [
  ...r.pile,
  ...r.hands.flat(),
  ...r.discards.flat(),
  r.indicator,
  ...(r.finishTile ? [r.finishTile] : []),
];

/** Plays a whole round with four bots. */
function playOut(r: RoundState): number {
  let steps = 0;
  while (r.phase !== 'roundOver') {
    if (++steps > 1000) throw new Error('round did not end');
    const seat = r.turn;
    if (r.phase === 'draw') {
      if (botWantsDiscard(r, seat)) takeDiscard(r, seat);
      else drawFromPile(r, seat);
    } else {
      const plan = botPlanDiscard(r, seat);
      if (!(plan.win && declareWin(r, seat, plan.tileId))) discardTile(r, seat, plan.tileId);
    }
  }
  return steps;
}

describe('dealRound', () => {
  it('deals 15 to the starter, 14 to the others, and leaves 48 in the pile', () => {
    const r = dealRound(42, 2);
    expect(r.hands.map((h) => h.length)).toEqual([14, 14, 15, 14]);
    expect(r.pile).toHaveLength(48);
    expect(r.indicator.kind).toBe('number');
    expect(r.turn).toBe(2);
    expect(r.phase).toBe('discard');
  });

  it('uses every tile exactly once', () => {
    const ids = allTiles(dealRound(7, 0)).map((t) => t.id);
    expect(new Set(ids).size).toBe(TILE_COUNT);
  });
});

describe('bot rounds', () => {
  it('always end, keep every tile, and only crown valid hands', () => {
    let wins = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = dealRound(seed, seed % 4);
      playOut(r);
      expect(new Set(allTiles(r).map((t) => t.id)).size).toBe(TILE_COUNT);
      if (r.winner !== null) {
        wins++;
        expect(isWinningHand(r.hands[r.winner], r.okey)).toBe(true);
      }
    }
    // Not a strength test, just a sanity check that bots can finish at all.
    expect(wins).toBeGreaterThan(0);
  });
});

describe('rack', () => {
  it('arranges a full hand within the slots', () => {
    const r = dealRound(3, 0);
    for (const rack of [arrangeRuns(r.hands[0], r.okey), arrangePairs(r.hands[0], r.okey)]) {
      expect(rack).toHaveLength(RACK_SLOTS);
      expect(rack.filter((id) => id !== null)).toHaveLength(15);
    }
  });
});

describe('save', () => {
  it('round-trips a game in progress', () => {
    const save = { ...emptySave(), stats: { played: 3, won: 1 }, round: dealRound(9, 1), rack: null };
    expect(parseSave(serializeSave(save))).toEqual(save);
  });

  it('keeps stats but drops a corrupted round', () => {
    const save = parseSave(JSON.stringify({ v: 1, stats: { played: 5, won: 2 }, round: { pile: [] } }));
    expect(save.stats).toEqual({ played: 5, won: 2 });
    expect(save.round).toBeNull();
  });

  it('starts fresh from empty or broken data', () => {
    expect(parseSave('')).toEqual(emptySave());
    expect(parseSave('{not json')).toEqual(emptySave());
  });

  it('stays far below the 64 KiB exit-save limit', () => {
    const save = { ...emptySave(), round: dealRound(1, 0), rack: new Array(RACK_SLOTS).fill(null) };
    expect(serializeSave(save).length * 2).toBeLessThan(64 * 1024);
  });
});
