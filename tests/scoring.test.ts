import { describe, expect, it } from 'vitest';
import { botPlanDiscard, botWantsDiscard } from '../src/core/bot';
import {
  canShowIndicator,
  dealRound,
  declareWin,
  discardTile,
  drawFromPile,
  showIndicator,
  takeDiscard,
  type RoundState,
} from '../src/core/game';
import { finishPenalty, isColoredOkey, isMatchOver, isSingleColorHand, matchLeaders, newMatch, PENALTY, roundPenalties, scoreRound, START_POINTS } from '../src/core/scoring';
import { isSingleColorFinish } from '../src/core/hand';
import type { Color, Face, Tile } from '../src/core/tile';

/** A round that ended with `winner` finishing by throwing `finish`. */
function finished(winner: number | null, kind: 'sets' | 'pairs' | null, finish: 'okey' | 'plain' | null, shownBy: number | null = null): RoundState {
  const r = dealRound(5, 0);
  const okeyTile: Tile = { id: 900, kind: 'number', color: r.okey.color, value: r.okey.value };
  const plainTile: Tile = { id: 901, kind: 'fake' };
  return {
    ...r,
    phase: 'roundOver',
    winner,
    winKind: kind,
    finishTile: finish === 'okey' ? okeyTile : finish === 'plain' ? plainTile : null,
    indicatorShownBy: shownBy,
  };
}

describe('roundPenalties', () => {
  it('takes 2 from everyone but the winner on a normal finish', () => {
    expect(roundPenalties(finished(1, 'sets', 'plain'))).toEqual([2, 0, 2, 2]);
  });

  it('takes 4 when the finishing discard is the okey', () => {
    expect(roundPenalties(finished(0, 'sets', 'okey'))).toEqual([0, 4, 4, 4]);
  });

  it('does not count a fake okey discard as finishing with the okey', () => {
    expect(roundPenalties(finished(0, 'sets', 'plain'))).toEqual([0, 2, 2, 2]);
  });

  it('takes 4 for pairs and 8 for pairs with the okey', () => {
    expect(roundPenalties(finished(2, 'pairs', 'plain'))).toEqual([4, 4, 0, 4]);
    expect(roundPenalties(finished(2, 'pairs', 'okey'))).toEqual([8, 8, 0, 8]);
  });

  it('adds the gösterge point on top, for everyone but the shower', () => {
    expect(roundPenalties(finished(0, 'sets', 'plain', 2))).toEqual([1, 3, 2, 3]);
  });

  it('only charges the gösterge on a drawn hand', () => {
    expect(roundPenalties(finished(null, null, null))).toEqual([0, 0, 0, 0]);
    expect(roundPenalties(finished(null, null, null, 3))).toEqual([1, 1, 1, 0]);
  });
});

describe('match', () => {
  it('starts everyone on the same points', () => {
    expect(newMatch()).toEqual({ points: [START_POINTS, START_POINTS, START_POINTS, START_POINTS], hands: 0, start: START_POINTS });
  });

  it('applies a hand and ends when someone reaches zero', () => {
    const match = { points: [20, 3, 9, 4], hands: 7 };
    expect(scoreRound(match, finished(0, 'sets', 'okey'))).toEqual([0, 4, 4, 4]);
    expect(match).toEqual({ points: [20, -1, 5, 0], hands: 8 });
    expect(isMatchOver(match)).toBe(true);
    expect(matchLeaders(match)).toEqual([0]);
  });

  it('shares the win on a tie', () => {
    expect(matchLeaders({ points: [6, 0, 6, 2], hands: 9 })).toEqual([0, 2]);
  });

  it('bot matches always end, and points only go down', () => {
    for (let m = 0; m < 5; m++) {
      const match = newMatch();
      let starter = m % 4;
      while (!isMatchOver(match)) {
        if (match.hands > 300) throw new Error('match did not end');
        const r = dealRound(1000 * m + match.hands, starter);
        while (r.phase !== 'roundOver') {
          const seat = r.turn;
          if (canShowIndicator(r, seat)) showIndicator(r, seat);
          if (r.phase === 'draw') {
            if (botWantsDiscard(r, seat)) takeDiscard(r, seat);
            else drawFromPile(r, seat);
          } else {
            const plan = botPlanDiscard(r, seat);
            if (!(plan.win && declareWin(r, seat, plan.tileId))) discardTile(r, seat, plan.tileId);
          }
        }
        const before = [...match.points];
        scoreRound(match, r);
        match.points.forEach((p, seat) => expect(p).toBeLessThanOrEqual(before[seat]));
        starter = (starter + 1) % 4;
      }
    }
  });
});

describe('gösterge', () => {
  /** Seat 0 starts and holds the twin of the indicator. */
  function withTwin(): RoundState {
    const r = dealRound(11, 0);
    for (const hand of r.hands) {
      const i = hand.findIndex((t) => t.kind === 'number' && t.color === r.indicator.color && t.value === r.indicator.value);
      if (i !== -1) hand.splice(i, 1, { id: 950 + i, kind: 'fake' });
    }
    r.hands[0][0] = { id: 999, kind: 'number', color: r.indicator.color, value: r.indicator.value };
    return r;
  }

  it('can be shown once, on the holder’s first turn', () => {
    const r = withTwin();
    expect(canShowIndicator(r, 1)).toBe(false);
    expect(canShowIndicator(r, 0)).toBe(true);
    showIndicator(r, 0);
    expect(r.indicatorShownBy).toBe(0);
    expect(canShowIndicator(r, 0)).toBe(false);
  });

  it('can no longer be shown once the holder has discarded', () => {
    const r = withTwin();
    discardTile(r, 0, r.hands[0][1].id);
    expect(r.turnsTaken).toEqual([1, 0, 0, 0]);
    expect(canShowIndicator(r, 0)).toBe(false);
  });

  it('must be shown before drawing on the holder’s first turn', () => {
    const r = withTwin();
    // Move the twin to seat 1, who is not the starter.
    const twin = r.hands[0].shift()!;
    r.hands[1].push(twin);
    r.hands[0].push(r.hands[1].shift()!);
    discardTile(r, 0, r.hands[0][0].id);
    expect(r.turn).toBe(1);
    expect(canShowIndicator(r, 1)).toBe(true);
    drawFromPile(r, 1);
    expect(canShowIndicator(r, 1)).toBe(false);
  });

  it('needs a copy of the indicator in hand', () => {
    const r = withTwin();
    r.hands[0][0] = { id: 998, kind: 'fake' };
    expect(canShowIndicator(r, 0)).toBe(false);
    expect(() => showIndicator(r, 0)).toThrow();
  });
});

describe('bot finishing', () => {
  it('throws the okey to finish when that also wins', () => {
    const r = dealRound(5, 0);
    r.indicator = { id: 800, kind: 'number', color: 'red', value: 4 };
    r.okey = { color: 'red', value: 5 };
    let id = 700;
    const n = (color: 'red' | 'yellow' | 'blue' | 'black', value: number): Tile => ({ id: id++, kind: 'number', color, value });
    const okeyTile = n('red', 5);
    // 14 tiles that already win, plus the okey: throwing a run end (okey fills it) or the okey both win.
    r.hands[0] = [
      n('red', 1), n('red', 2), n('red', 3),
      n('blue', 7), n('blue', 8), n('blue', 9), n('blue', 10),
      n('yellow', 4), n('black', 4), n('blue', 4),
      n('black', 11), n('black', 12), n('black', 13), n('black', 1),
      okeyTile,
    ];
    expect(botPlanDiscard(r, 0)).toEqual({ tileId: okeyTile.id, win: true });
  });
});

it('penalty table matches the classic rules', () => {
  expect(PENALTY).toEqual({ win: 2, okeyFinish: 4, pairs: 4, pairsOkeyFinish: 8, indicator: 1 });
});

it('the colored okey doubles the okey finish', () => {
  expect(finishPenalty('sets', false)).toBe(2);
  expect(finishPenalty('sets', true)).toBe(4);
  expect(finishPenalty('sets', true, { coloredOkey: true, singleColor: false })).toBe(8);
  expect(finishPenalty('pairs', true, { coloredOkey: true, singleColor: false })).toBe(16);
  // A normal finish is not affected by the color.
  expect(finishPenalty('sets', false, { coloredOkey: true, singleColor: false })).toBe(2);
});

it('a single colour finish doubles what the others lose', () => {
  const rules = { coloredOkey: false, singleColor: true };
  expect(finishPenalty('sets', false, rules)).toBe(4);
  expect(finishPenalty('sets', true, rules)).toBe(8);
  expect(finishPenalty('pairs', true, rules)).toBe(16);
});

it('knows a hand finished in one colour', () => {
  const okey: Face = { color: 'red', value: 5 };
  const n = (color: Color, value: number): Tile => ({ id: 900 + value, kind: 'number', color, value });
  expect(isSingleColorFinish([n('red', 1), n('red', 2), n('black', 3)], okey)).toBe(false);
  expect(isSingleColorFinish([n('red', 1), n('red', 2), n('red', 3)], okey)).toBe(true);
  // The wild does not break the single colour.
  expect(isSingleColorFinish([n('red', 1), n('red', 2), { id: 999, kind: 'number', color: 'red', value: 5 }], okey)).toBe(true);
});

it('doubles what the others lose when the winner finished in one colour', () => {
  const r = finished(0, 'sets', 'plain');
  // The winner's fourteen tiles are all blue.
  r.hands[0] = Array.from({ length: 14 }, (_, i) => ({ id: 500 + i, kind: 'number', color: 'blue', value: (i % 13) + 1 })) as Tile[];
  expect(isSingleColorHand(r)).toBe(true);

  const plain = roundPenalties(r, { coloredOkey: false, singleColor: false });
  const single = roundPenalties(r, { coloredOkey: false, singleColor: true });
  expect(plain[1]).toBe(2);
  expect(single[1]).toBe(4);
  expect(single[0]).toBe(0);
});

it('does not double when the winner mixed the colours', () => {
  const r = finished(0, 'sets', 'plain');
  r.hands[0] = [
    { id: 501, kind: 'number', color: 'blue', value: 1 },
    { id: 502, kind: 'number', color: 'black', value: 2 },
  ] as Tile[];
  expect(isSingleColorHand(r)).toBe(false);
  expect(roundPenalties(r, { coloredOkey: false, singleColor: true })[1]).toBe(2);
});

it('a match starts from the chosen points', () => {
  expect(newMatch().points).toEqual([20, 20, 20, 20]);
  expect(newMatch(10).points).toEqual([10, 10, 10, 10]);
  expect(newMatch(40).start).toBe(40);
});

it('knows a red or black indicator makes a colored okey', () => {
  const r = dealRound(3, 0);
  r.indicator = { id: 900, kind: 'number', color: 'red', value: 4 };
  expect(isColoredOkey(r)).toBe(true);
  r.indicator = { id: 901, kind: 'number', color: 'blue', value: 4 };
  expect(isColoredOkey(r)).toBe(false);
});
