import { describe, expect, it } from 'vitest';
import { findWinningDiscard, winningKind } from '../src/core/hand';
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

  it('needs exactly 14 tiles', () => {
    expect(winningKind(rest(), okey)).toBeNull();
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
