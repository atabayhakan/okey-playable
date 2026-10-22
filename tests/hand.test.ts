import { describe, expect, it } from 'vitest';
import { findWinningDiscard, meldsInHand, winningGroups, winningKind } from '../src/core/hand';
import { okeyFaceFor, type Color, type Face, type Tile } from '../src/core/tile';

let nextId = 1000;
const n = (color: Color, value: number): Tile => ({ id: nextId++, kind: 'number', color, value });
const fake = (): Tile => ({ id: nextId++, kind: 'fake' });
const run = (color: Color, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => n(color, from + i));

/** Red 5 is the okey (wild) in every test below. */
const okey: Face = { color: 'red', value: 5 };

/** 11 tiles: blue 7-10, a 4-group of three colors, black 11-12-13-1. */
const rest = () => [...run('blue', 7, 10), n('yellow', 4), n('black', 4), n('blue', 4), ...run('black', 11, 13), n('black', 1)];

describe('okey tile', () => {
  it('is one above the indicator, wrapping 13 to 1', () => {
    expect(okeyFaceFor({ id: 0, kind: 'number', color: 'blue', value: 13 })).toEqual({ color: 'blue', value: 1 });
    expect(okeyFaceFor({ id: 0, kind: 'number', color: 'red', value: 4 })).toEqual({ color: 'red', value: 5 });
  });
});

describe('winningKind', () => {
  it('accepts runs and groups, including 12-13-1', () => {
    expect(winningKind([...run('red', 1, 3), ...rest()], okey)).toBe('sets');
  });

  it('lets the okey fill a gap', () => {
    expect(winningKind([n('red', 1), n('red', 5), n('red', 3), ...rest()], okey)).toBe('sets');
  });

  it('lets the okey stand in at the start of a run', () => {
    expect(winningKind([n('red', 5), n('yellow', 12), n('yellow', 13), ...rest()], okey)).toBe('sets');
  });

  it('treats a fake okey as the okey face', () => {
    expect(winningKind([n('red', 4), fake(), n('red', 6), ...rest()], okey)).toBe('sets');
  });

  it('rejects a 13-1-2 run', () => {
    const hand = [...run('red', 1, 3), ...run('blue', 7, 11), n('yellow', 4), n('black', 4), n('blue', 4), n('black', 13), n('black', 1), n('black', 2)];
    expect(hand).toHaveLength(14);
    expect(winningKind(hand, okey)).toBeNull();
  });

  it('rejects a group with a repeated color', () => {
    const hand = [...run('red', 1, 3), ...run('blue', 7, 10), n('yellow', 4), n('yellow', 4), n('black', 4), ...run('black', 11, 13), n('black', 1)];
    expect(winningKind(hand, okey)).toBeNull();
  });

  it('accepts seven pairs, with the okey completing one', () => {
    const pairs = (color: Color, value: number) => [n(color, value), n(color, value)];
    const hand = [...pairs('red', 1), ...pairs('blue', 3), ...pairs('black', 9), ...pairs('yellow', 9), ...pairs('red', 12), ...pairs('blue', 13), n('yellow', 2), n('red', 5)];
    expect(winningKind(hand, okey)).toBe('pairs');
  });

  it('scores a hand that is both pairs and runs/sets as pairs (the bigger penalty)', () => {
    const twice = (tiles: Tile[]) => [...tiles, ...tiles.map((t) => ({ ...t, id: nextId++ }))];
    expect(winningKind(twice([...run('blue', 1, 3), ...run('black', 6, 9)]), okey)).toBe('pairs');
    expect(winningKind(twice([n('red', 6), n('blue', 6), n('black', 6), ...run('yellow', 1, 4)]), okey)).toBe('pairs');
  });

  it('needs exactly 14 tiles', () => {
    expect(winningKind(rest(), okey)).toBeNull();
  });
});

describe('winningGroups', () => {
  const letter: Record<Color, string> = { red: 'r', yellow: 'y', blue: 'u', black: 'k' };
  const faces = (groups: Tile[][]) => groups.map((g) => g.map((t) => (t.kind === 'fake' ? 'F' : `${letter[t.color]}${t.value}`)).join(' '));

  it('splits runs and sets, keeping each wild where it stands in', () => {
    const hand = [n('red', 1), n('red', 5), n('red', 3), ...rest()];
    const result = winningGroups(hand, okey)!;
    expect(result.kind).toBe('sets');
    expect(result.groups.flat()).toHaveLength(14);
    expect(new Set(result.groups.flat().map((t) => t.id)).size).toBe(14);
    // The red 5 is the okey, filling the 2 in red 1-2-3.
    expect(faces(result.groups)).toContain('r1 r5 r3');
    expect(faces(result.groups)).toContain('u7 u8 u9 u10');
    expect(faces(result.groups)).toContain('k11 k12 k13 k1');
    expect(faces(result.groups)).toContain('y4 u4 k4');
  });

  it('pairs identical tiles and gives a lone tile the okey', () => {
    const pairs = (color: Color, value: number) => [n(color, value), n(color, value)];
    const hand = [...pairs('red', 1), ...pairs('blue', 3), ...pairs('black', 9), ...pairs('yellow', 9), ...pairs('red', 12), ...pairs('blue', 13), n('yellow', 2), n('red', 5)];
    const result = winningGroups(hand, okey)!;
    expect(result.kind).toBe('pairs');
    expect(result.groups).toHaveLength(7);
    expect(faces(result.groups)).toContain('y2 r5');
  });

  it('returns null for a hand that does not win', () => {
    expect(winningGroups([...rest(), n('red', 1), n('red', 9), n('blue', 12)], okey)).toBeNull();
  });
});

describe('findWinningDiscard', () => {
  it('finds the one tile to throw', () => {
    const extra = n('yellow', 9);
    const hand = [...run('red', 1, 3), ...rest(), extra];
    expect(findWinningDiscard(hand, okey)).toBe(extra);
  });

  it('returns null when nothing wins', () => {
    const hand = [...run('red', 1, 2), n('yellow', 9), ...rest(), n('blue', 1)];
    expect(findWinningDiscard(hand, okey)).toBeNull();
  });
});

describe('meldsInHand', () => {
  const letter: Record<Color, string> = { red: 'r', yellow: 'y', blue: 'u', black: 'k' };
  const faces = (groups: Tile[][]) =>
    groups.map((g) =>
      g
        .map((t) => (t.kind === 'fake' ? 'F' : `${letter[t.color]}${t.value}`))
        .join(' '),
    );

  it('finds the sets and runs the hand already holds', () => {
    const melds = meldsInHand([...run('blue', 7, 10), n('yellow', 4), n('black', 4), n('blue', 4), ...run('black', 11, 13), n('black', 1)], okey);
    expect(faces(melds)).toContain('u7 u8 u9 u10');
    expect(faces(melds)).toContain('y4 u4 k4');
    expect(faces(melds)).toContain('k11 k12 k13');
  });

  it('counts the 12-13-1 wrap as a run', () => {
    const melds = meldsInHand([...run('black', 11, 13), n('black', 1)], okey);
    expect(faces(melds)).toContain('k11 k12 k13');
  });

  it('lets the wild finish a set', () => {
    const wild = n('red', 5);
    const melds = meldsInHand([n('yellow', 4), n('black', 4), wild, n('blue', 9), n('blue', 10)], okey);
    expect(melds.flat().some((t) => t.id === wild.id)).toBe(true);
    expect(melds.flat()).toHaveLength(3);
  });

  it('lets the wild finish a run', () => {
    const wild = n('red', 5);
    const melds = meldsInHand([n('blue', 9), n('blue', 10), wild], okey);
    expect(faces(melds)).toContain('u9 u10 r5');
  });

  it('finds nothing in a hand of scattered tiles', () => {
    expect(meldsInHand([n('red', 1), n('black', 5), n('blue', 9), n('yellow', 13)], okey)).toEqual([]);
  });

  it('never uses the same tile twice', () => {
    const hand = [...run('blue', 7, 10), n('yellow', 4), n('black', 4), n('blue', 4), ...run('black', 11, 13), n('black', 1), n('red', 5)];
    const melds = meldsInHand(hand, okey);
    const ids = melds.flat().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
