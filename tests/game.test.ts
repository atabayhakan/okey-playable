import { describe, expect, it } from 'vitest';
import { arrangePairs, arrangeRuns, GROUP_BREAK, RACK_SLOTS } from '../src/app/rack';
import { emptySave, emptyStats, parseSave, SAVE_VERSION, serializeSave } from '../src/app/save';
import { newMatch } from '../src/core/scoring';
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
      // Only real tiles count; the gaps between groups are markers, not tiles.
      expect(rack.filter((id) => id !== null && id > 0)).toHaveLength(15);
    }
  });

  it('separates the groups with a visible gap', () => {
    const r = dealRound(3, 0);
    const rack = arrangeRuns(r.hands[0], r.okey);
    const tiles = rack.filter((id) => id !== null && id > 0);
    const gaps = rack.filter((id) => id === GROUP_BREAK);
    expect(gaps.length).toBeGreaterThan(0);
    expect(tiles.length).toBe(15);
    // A gap never sits at the very end: it always separates two groups.
    expect(rack.at(-1)).not.toBe(GROUP_BREAK);
  });

  it('keeps every tile of the hand', () => {
    const r = dealRound(11, 2);
    for (const rack of [arrangeRuns(r.hands[0], r.okey), arrangePairs(r.hands[0], r.okey)]) {
      const ids = rack.filter((id): id is number => id !== null && id > 0);
      expect(new Set(ids).size).toBe(r.hands[0].length);
    }
  });
});

describe('save', () => {
  it('round-trips a game in progress', () => {
    const save = {
      ...emptySave(),
      stats: { ...emptyStats(), played: 3, won: 1, matchesPlayed: 1, streak: 1, bestStreak: 1, fastestWin: 9 },
      match: { points: [18, 14, 20, 16], hands: 3, start: 20 },
      round: dealRound(9, 1),
      rack: null,
    };
    expect(parseSave(serializeSave(save))).toEqual(save);
  });

  it('keeps stats but drops a corrupted round', () => {
    const save = parseSave(JSON.stringify({ v: 2, stats: { played: 5, won: 2 }, match: { points: [1, 2], hands: 0 }, round: { pile: [] } }));
    expect(save.stats).toEqual({ ...emptyStats(), played: 5, won: 2 });
    expect(save.match).toEqual(newMatch());
    expect(save.round).toBeNull();
  });

  it('upgrades a v1 save, keeping its hand in progress', () => {
    const { turnsTaken: _t, indicatorShownBy: _i, ...v1Round } = dealRound(9, 1);
    const save = parseSave(JSON.stringify({ v: 1, stats: { played: 5, won: 2 }, round: v1Round, rack: [] }));
    expect(save.v).toBe(SAVE_VERSION);
    expect(save.stats).toEqual({ ...emptyStats(), played: 5, won: 2 });
    expect(save.match).toEqual(newMatch());
    expect(save.round?.hands).toEqual(v1Round.hands);
    // Turns played before the upgrade are unknown, so nobody may show the indicator in that hand.
    expect(save.round?.turnsTaken).toEqual([1, 1, 1, 1]);
    expect(save.round?.indicatorShownBy).toBeNull();
  });

  it('upgrades a v5 save with its hand and settings, and gives it the relaxed pace', () => {
    const { botPace: _p, ...v5 } = { ...emptySave(), v: 5, difficulty: 'hard' as const, matchStart: 40, round: dealRound(9, 1), rack: null };
    const save = parseSave(JSON.stringify(v5));
    expect(save.v).toBe(SAVE_VERSION);
    expect(save.botPace).toBe('relaxed');
    expect(save.difficulty).toBe('hard');
    expect(save.matchStart).toBe(40);
    expect(save.round?.seed).toBe(9);
  });

  it('upgrades a v6 save: the old counters stay, the new ones start from zero', () => {
    const { botPace, ...rest } = emptySave();
    const v6 = { ...rest, botPace, v: 6, stats: { played: 8, won: 5, matchesPlayed: 2, matchesWon: 1 }, round: dealRound(3, 1), rack: null };
    const save = parseSave(JSON.stringify(v6));
    expect(save.v).toBe(SAVE_VERSION);
    expect(save.stats).toEqual({ ...emptyStats(), played: 8, won: 5, matchesPlayed: 2, matchesWon: 1 });
    expect(save.round?.seed).toBe(3);
  });

  it('does not trust counters that contradict each other', () => {
    const stats = { played: 4, won: 2, matchesPlayed: 0, matchesWon: 0, streak: 9, bestStreak: 1, pairsWon: 7, okeyWon: 1, fastestWin: 12, drawn: 9 };
    const save = parseSave(JSON.stringify({ ...emptySave(), stats }));
    expect(save.stats.streak).toBe(2);
    expect(save.stats.bestStreak).toBeGreaterThanOrEqual(save.stats.streak);
    expect(save.stats.pairsWon).toBe(2);
    // A hand that was won was not drawn.
    expect(save.stats.drawn).toBeLessThanOrEqual(2);
  });

  it('gives an old save no guide when its player had read the rules, a new one the first step', () => {
    for (const [coachSeen, tutorial] of [[true, 3], [false, 0]] as const) {
      const { tutorial: _t, ...rest } = { ...emptySave(), v: 8, coachSeen };
      expect(parseSave(JSON.stringify(rest)).tutorial).toBe(tutorial);
    }
    // A save from before the rules card existed is from a player who knows the game.
    expect(parseSave(JSON.stringify({ v: 1, stats: { played: 5, won: 2 } })).tutorial).toBe(3);
  });

  it('keeps the guide step, and counts a current save with a broken step as done', () => {
    expect(parseSave(serializeSave({ ...emptySave(), tutorial: 2 })).tutorial).toBe(2);
    expect(parseSave(JSON.stringify({ ...emptySave(), tutorial: 'later' })).tutorial).toBe(3);
    expect(parseSave(JSON.stringify({ ...emptySave(), tutorial: 7 })).tutorial).toBe(3);
  });

  it('keeps a quick pace, and falls back to relaxed for a broken one', () => {
    expect(parseSave(serializeSave({ ...emptySave(), botPace: 'quick' })).botPace).toBe('quick');
    expect(parseSave(JSON.stringify({ ...emptySave(), botPace: 'warp' })).botPace).toBe('relaxed');
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
