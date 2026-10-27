import { describe, expect, it } from 'vitest';
import { createTileSet } from '../src/core/deck';
import { winningKind, type WinKind } from '../src/core/hand';
import { createRng, shuffle, type Rng } from '../src/core/rng';
import { COLORS, resolve, type Color, type Face, type Tile } from '../src/core/tile';

/**
 * An independent, slow judge of whether 14 tiles win. It shares nothing with src/core/hand.ts but
 * the meaning of a wild: it tries every face for every wild and checks the result with a plain
 * exact cover over a list of every possible meld. The real code is fast and clever; this is
 * simple and obviously right, so a disagreement points at the real one.
 */
function brute(tiles: readonly Tile[], okey: Face): WinKind | null {
  const faces: number[] = []; // color index * 14 + value, value 1..13
  let wilds = 0;
  for (const tile of tiles) {
    const r = resolve(tile, okey);
    if (r.wild) wilds++;
    else faces.push(COLORS.indexOf(r.color) * 14 + r.value);
  }
  const base = new Array<number>(4 * 14).fill(0);
  for (const f of faces) base[f]++;

  // Every meld there is, as a list of the faces it uses.
  const melds: number[][] = [];
  for (let c = 0; c < 4; c++) {
    for (let start = 1; start <= 13; start++) {
      for (let len = 3; start + len - 1 <= 13; len++) {
        melds.push(Array.from({ length: len }, (_, i) => c * 14 + start + i));
      }
      // 12-13-1 and longer runs ending in a 1 after the 13; 13-1-2 is no run.
      if (start >= 2 && start <= 12) {
        melds.push([...Array.from({ length: 14 - start }, (_, i) => c * 14 + start + i), c * 14 + 1]);
      }
    }
  }
  for (let v = 1; v <= 13; v++) {
    for (let mask = 0; mask < 16; mask++) {
      const colors = [0, 1, 2, 3].filter((c) => mask & (1 << c));
      if (colors.length >= 3) melds.push(colors.map((c) => c * 14 + v));
    }
  }

  const covers = (counts: number[]): boolean => {
    const memo = new Map<string, boolean>();
    const go = (cs: number[]): boolean => {
      const first = cs.findIndex((n) => n > 0);
      if (first === -1) return true;
      const key = cs.join(',');
      const known = memo.get(key);
      if (known !== undefined) return known;
      let ok = false;
      for (const meld of melds) {
        if (!meld.includes(first)) continue;
        const next = [...cs];
        let fits = true;
        for (const f of meld) {
          if (next[f] === 0) {
            fits = false;
            break;
          }
          next[f]--;
        }
        if (fits && go(next)) {
          ok = true;
          break;
        }
      }
      memo.set(key, ok);
      return ok;
    };
    return go(counts);
  };

  // Every way to give the wilds a face.
  const options: number[] = [];
  for (let c = 0; c < 4; c++) for (let v = 1; v <= 13; v++) options.push(c * 14 + v);
  const assignments: number[][] = [[]];
  for (let w = 0; w < wilds; w++) {
    const grown: number[][] = [];
    for (const a of assignments) for (const o of options) if (a.length === 0 || o >= a[a.length - 1]) grown.push([...a, o]);
    assignments.length = 0;
    assignments.push(...grown);
  }

  let sets = false;
  for (const assigned of assignments) {
    const counts = [...base];
    for (const f of assigned) counts[f]++;
    // Seven pairs: every face an even number of times.
    if (counts.every((n) => n % 2 === 0)) return 'pairs';
    if (!sets && covers(counts)) sets = true;
  }
  return sets ? 'sets' : null;
}

/** A hand that is often won or one tile off: melds taken from the set, some real okeys, a few random tiles. */
function nearWin(tiles: Tile[], okey: Face, rng: Rng, wilds: number): Tile[] {
  const isWild = (t: Tile) => t.kind === 'number' && t.color === okey.color && t.value === okey.value;
  const pool = tiles.filter((t) => !isWild(t));
  const used = new Set<number>();
  const pick = (color: Color, value: number): Tile | null => {
    const found = pool.find((t) => t.kind === 'number' && t.color === color && t.value === value && !used.has(t.id));
    if (!found) return null;
    used.add(found.id);
    return found;
  };
  const hand: Tile[] = [];
  const lens = [[3, 3, 3, 5], [3, 3, 4, 4], [3, 4, 7], [4, 5, 5]][Math.floor(rng() * 4)];
  for (const len of lens) {
    if (rng() < 0.55) {
      const color = COLORS[Math.floor(rng() * 4)];
      const start = 1 + Math.floor(rng() * (14 - len));
      for (let q = start; q < start + len; q++) {
        const t = pick(color, q > 13 ? 1 : q);
        if (t) hand.push(t);
      }
    } else {
      const value = 1 + Math.floor(rng() * 13);
      for (const color of shuffle([...COLORS], rng).slice(0, Math.min(len, 4))) {
        const t = pick(color, value);
        if (t) hand.push(t);
      }
    }
  }
  const spare = pool.filter((t) => !used.has(t.id));
  const wildTiles = tiles.filter(isWild).slice(0, wilds);
  // Keep the hand at fourteen: the wilds replace the last tiles of the melds.
  hand.length = Math.min(hand.length, 14 - wilds);
  while (hand.length + wildTiles.length < 14) hand.push(spare.pop()!);
  return shuffle([...hand, ...wildTiles], rng).slice(0, 14);
}

describe('winningKind against a brute-force judge', () => {
  it('agrees on hands that are often one tile from winning, with 0, 1 or 2 wilds', () => {
    const rng = createRng(31337);
    const okey: Face = { color: 'blue', value: 8 };
    const seen = { sets: 0, pairs: 0, none: 0 };
    for (let i = 0; i < 700; i++) {
      const tiles = shuffle(createTileSet(), rng);
      const hand = nearWin(tiles, okey, rng, i % 3);
      const expected = brute(hand, okey);
      const actual = winningKind(hand, okey);
      expect(actual, `hand ${i}: ${hand.map((t) => (t.kind === 'fake' ? 'F' : `${t.color[0]}${t.value}`)).join(' ')}`).toBe(expected);
      seen[expected ?? 'none']++;
    }
    // The test proves something only if it sees every outcome.
    expect(seen.sets).toBeGreaterThan(60);
    expect(seen.none).toBeGreaterThan(60);
  });

  it('agrees on seven pairs, with and without wilds', () => {
    const rng = createRng(4242);
    const okey: Face = { color: 'red', value: 5 };
    let pairs = 0;
    for (let i = 0; i < 300; i++) {
      const tiles = shuffle(createTileSet(), rng);
      // Seven pairs, then a random tile or two broken.
      const numbers = tiles.filter((t) => t.kind === 'number' && !(t.color === 'red' && t.value === 5));
      const hand: Tile[] = [];
      const taken = new Set<number>();
      while (hand.length < 14) {
        const first = numbers.find((t) => !taken.has(t.id))!;
        taken.add(first.id);
        const twin = numbers.find((t) => !taken.has(t.id) && t.kind === 'number' && first.kind === 'number' && t.color === first.color && t.value === first.value);
        if (!twin) continue;
        taken.add(twin.id);
        hand.push(first, twin);
      }
      const broken = i % 4;
      for (let b = 0; b < broken; b++) hand[b * 3] = numbers.find((t) => !taken.has(t.id) && !hand.includes(t))!;
      if (i % 5 === 0) hand[13] = tiles.find((t) => t.kind === 'number' && t.color === 'red' && t.value === 5 && !hand.includes(t))!;
      const expected = brute(hand, okey);
      expect(winningKind(hand, okey), `hand ${i}`).toBe(expected);
      if (expected === 'pairs') pairs++;
    }
    expect(pairs).toBeGreaterThan(40);
  });
});
