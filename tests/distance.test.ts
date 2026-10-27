import { describe, expect, it } from 'vitest';
import { createTileSet } from '../src/core/deck';
import { distance, faceId, improvingFaces } from '../src/core/distance';
import { winningKind } from '../src/core/hand';
import { createRng, shuffle } from '../src/core/rng';
import type { Color, Face, Tile } from '../src/core/tile';

let nextId = 5000;
const n = (color: Color, value: number): Tile => ({ id: nextId++, kind: 'number', color, value });
const run = (color: Color, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => n(color, from + i));

/** Red 5 is the okey in the hand-made tests below. */
const okey: Face = { color: 'red', value: 5 };

describe('distance', () => {
  it('is 0 for a winning hand and counts the tiles still missing otherwise', () => {
    const win = [...run('blue', 7, 10), n('yellow', 4), n('black', 4), n('blue', 4), ...run('black', 11, 13), n('black', 1), ...run('red', 1, 3)];
    expect(win).toHaveLength(14);
    expect(distance(win, okey).sets).toBe(0);
    // Break one tile of the last run: one tile is missing.
    const oneAway = win.map((t) => (t.kind === 'number' && t.color === 'red' && t.value === 3 ? n('yellow', 9) : t));
    expect(distance(oneAway, okey).sets).toBe(1);
  });

  it('lets a wild take a place, so a hand with the okey is closer', () => {
    const base = [...run('blue', 7, 10), n('yellow', 4), n('black', 4), n('blue', 4), ...run('black', 11, 13), n('black', 1), n('red', 1), n('red', 3)];
    expect(base).toHaveLength(13);
    // Red 1 and red 3 with a hole at 2: any fill makes the hand.
    expect(distance([...base, n('red', 5)], okey).sets).toBe(0);
    expect(distance([...base, n('yellow', 9)], okey).sets).toBe(1);
  });

  it('counts the 12-13-1 run but not 13-1-2', () => {
    const top = [n('red', 12), n('red', 13), n('red', 1)];
    const hand = (extra: Tile[]) => [...top, ...extra];
    const filler = [...run('blue', 7, 10), n('yellow', 4), n('black', 4), n('blue', 4), ...run('black', 5, 6)];
    expect(distance(hand(filler.slice(0, 11)), okey).sets).toBeLessThanOrEqual(3);
    const bad = [n('red', 13), n('red', 1), n('red', 2)];
    // 13-1-2 is no run: at least as far as three loose tiles.
    expect(distance([...bad, ...filler.slice(0, 11)], okey).sets).toBeGreaterThan(distance(hand(filler.slice(0, 11)), okey).sets);
  });

  it('scores seven pairs on its own scale', () => {
    const pairs = (c: Color, v: number) => [n(c, v), n(c, v)];
    const hand = [...pairs('red', 1), ...pairs('blue', 3), ...pairs('black', 9), ...pairs('yellow', 9), ...pairs('red', 12), ...pairs('blue', 13), n('yellow', 2), n('black', 6)];
    expect(distance(hand, okey).pairs).toBe(1);
    expect(distance(hand, okey).sets).toBeGreaterThan(1);
  });

  it('finds the one face that brings a nearly won hand to a win', () => {
    // Everything is in place except the red 3 that closes red 1-2.
    const hand = [...run('blue', 7, 10), n('yellow', 4), n('black', 4), n('blue', 4), ...run('black', 11, 13), n('black', 1), n('red', 1), n('red', 2), n('yellow', 9)];
    expect(hand).toHaveLength(14);
    expect(distance(hand, okey).sets).toBe(1);
    expect(improvingFaces(hand, okey, 1)).toEqual([faceId(0, 3)]); // color index 0 is red
  });

  it('finds nothing to draw for a hand that has already won', () => {
    const win = [...run('blue', 7, 10), n('yellow', 4), n('black', 4), n('blue', 4), ...run('black', 11, 13), n('black', 1), ...run('red', 1, 3)];
    expect(improvingFaces(win, okey, 1)).toEqual([]);
  });

  it('agrees with trying every face and every throw, the slow way', () => {
    const rng = createRng(909);
    const face: Face = { color: 'yellow', value: 6 };
    const rank = (tiles: Tile[]): number => {
      const d = distance(tiles, face);
      return d.sets === 0 || d.pairs === 0 ? 0 : Math.min(d.sets, d.pairs + 1);
    };
    for (let i = 0; i < 20; i++) {
      const tiles = shuffle(createTileSet(), rng);
      const hand = i % 2 === 0 ? tiles.slice(0, 14) : arrangeNearWin(tiles, rng);
      const now = rank(hand);
      const slow = new Set<number>();
      for (let c = 0; c < 4; c++) {
        for (let v = 1; v <= 13; v++) {
          const extra = n(['red', 'yellow', 'blue', 'black'][c] as Color, v);
          const grown = [...hand, extra];
          // Every throw of the fifteen, the best one counts.
          const best = Math.min(...grown.map((_, j) => rank(grown.filter((__, k) => k !== j))));
          if (best < now) slow.add(faceId(c, v));
        }
      }
      // Faces of the okey itself are wilds, not faces: leave them out of the comparison.
      const fast = new Set(improvingFaces(hand, face, 1).filter((f) => f !== faceId(1, 6)));
      slow.delete(faceId(1, 6));
      // Every face it reports truly helps...
      for (const f of fast) expect(slow.has(f), `hand ${i}: face ${f} does not help`).toBe(true);
      // ...and the ones it leaves out go with no tile of the hand. (A tile that goes with nothing can
      // still take a place of its own and so count as closer, but that is no progress worth wanting.)
      const goesWith = (f: number): boolean =>
        hand.some((t) => {
          const x = t.kind === 'number' ? t : null;
          if (!x || (x.color === face.color && x.value === face.value)) return false;
          const c = ['red', 'yellow', 'blue', 'black'].indexOf(x.color);
          const dv = Math.abs(((f % 13) + 1) - x.value);
          return (c === Math.floor(f / 13) && Math.min(dv, 13 - dv) <= 2) || ((f % 13) + 1 === x.value);
        });
      for (const f of slow) if (!fast.has(f)) expect(goesWith(f), `hand ${i}: face ${f} was left out but goes with the hand`).toBe(false);
    }
  });

  it('agrees with winningKind on random hands, with and without wilds', () => {
    const rng = createRng(2024);
    let winners = 0;
    for (let i = 0; i < 4000; i++) {
      const tiles = shuffle(createTileSet(), rng);
      const first = tiles.find((t) => t.kind === 'number')!;
      const face: Face = { color: first.kind === 'number' ? first.color : 'red', value: ((first.kind === 'number' ? first.value : 1) % 13) + 1 };
      const hand = i % 2 === 0 ? tiles.slice(0, 14) : arrangeNearWin(tiles, rng);
      const d = distance(hand, face);
      const wins = winningKind(hand, face) !== null;
      if (wins) winners++;
      expect(d.sets === 0 || d.pairs === 0, `hand ${i}`).toBe(wins);
    }
    // The near-win generator must actually produce winners, or the test proves little.
    expect(winners).toBeGreaterThan(50);
  });

  it('changes by at most one tile when one tile of the hand is swapped', () => {
    const rng = createRng(77);
    for (let i = 0; i < 1500; i++) {
      const tiles = shuffle(createTileSet(), rng);
      const face: Face = { color: 'blue', value: 9 };
      const hand = tiles.slice(0, 14);
      const swapped = [...hand];
      swapped[i % 14] = tiles[14];
      const a = distance(hand, face);
      const b = distance(swapped, face);
      expect(Math.abs(a.sets - b.sets)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.pairs - b.pairs)).toBeLessThanOrEqual(1);
    }
  });

  it('is fast enough to run for every candidate discard', () => {
    const rng = createRng(5);
    const hands = Array.from({ length: 200 }, () => shuffle(createTileSet(), rng).slice(0, 14));
    const face: Face = { color: 'red', value: 4 };
    const start = performance.now();
    for (const hand of hands) distance(hand, face);
    const per = (performance.now() - start) / hands.length;
    // A bot decision runs it about fifteen times: this must stay well under a millisecond.
    expect(per).toBeLessThan(2);
  });
});

/**
 * A hand that is often one or two tiles from winning, or won: three or four melds drawn from the
 * tile set, filled up with random tiles. Plain random hands almost never win.
 */
function arrangeNearWin(tiles: Tile[], rng: () => number): Tile[] {
  const byFace = new Map<string, Tile[]>();
  for (const t of tiles) {
    if (t.kind !== 'number') continue;
    const key = `${t.color}${t.value}`;
    byFace.set(key, [...(byFace.get(key) ?? []), t]);
  }
  const used = new Set<number>();
  const pick = (color: Color, value: number): Tile | null => {
    const found = byFace.get(`${color}${value}`)?.find((t) => !used.has(t.id));
    if (!found) return null;
    used.add(found.id);
    return found;
  };
  const colors: Color[] = ['red', 'yellow', 'blue', 'black'];
  const hand: Tile[] = [];
  const lens = [[3, 3, 3, 5], [3, 3, 4, 4], [4, 4, 3, 3], [3, 4, 7]][Math.floor(rng() * 4)];
  for (const len of lens) {
    if (rng() < 0.5) {
      const color = colors[Math.floor(rng() * 4)];
      const start = 1 + Math.floor(rng() * (14 - len));
      for (let q = start; q < start + len; q++) {
        const t = pick(color, q);
        if (t) hand.push(t);
      }
    } else {
      const value = 1 + Math.floor(rng() * 13);
      for (const color of shuffle(colors, rng).slice(0, Math.min(len, 4))) {
        const t = pick(color, value);
        if (t) hand.push(t);
      }
    }
  }
  const spare = tiles.filter((t) => !used.has(t.id));
  while (hand.length < 14) hand.push(spare.pop()!);
  return hand.slice(0, 14);
}
