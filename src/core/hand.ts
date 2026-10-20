import { COLORS, resolve, type Face, type Tile } from './tile';

export type WinKind = 'sets' | 'pairs';

export const WINNING_HAND_SIZE = 14;

/** counts[colorIndex][value], value 1..13 (index 0 unused). */
type Counts = number[][];

/** Run position 14 is the 1 that may close a 12-13-1 run (13-1-2 is not allowed). */
const WRAP_POS = 14;
const valueAt = (pos: number) => (pos === WRAP_POS ? 1 : pos);

function tally(tiles: readonly Tile[], okey: Face): { counts: Counts; wilds: number } {
  const counts = COLORS.map(() => new Array<number>(14).fill(0));
  let wilds = 0;
  for (const tile of tiles) {
    const r = resolve(tile, okey);
    if (r.wild) wilds++;
    else counts[COLORS.indexOf(r.color)][r.value]++;
  }
  return { counts, wilds };
}

export function winningKind(tiles: readonly Tile[], okey: Face): WinKind | null {
  if (tiles.length !== WINNING_HAND_SIZE) return null;
  const { counts, wilds } = tally(tiles, okey);
  if (canMeld(counts, wilds)) return 'sets';
  if (isPairs(counts, wilds)) return 'pairs';
  return null;
}

export const isWinningHand = (tiles: readonly Tile[], okey: Face): boolean => winningKind(tiles, okey) !== null;

/** For a 15-tile hand: a tile whose discard leaves a winning 14, or null. */
export function findWinningDiscard(hand: readonly Tile[], okey: Face): Tile | null {
  // Try ordinary tiles first so the okey is never thrown away needlessly.
  const order = [...hand].sort((a, b) => Number(resolve(a, okey).wild) - Number(resolve(b, okey).wild));
  for (const tile of order) {
    if (isWinningHand(hand.filter((t) => t !== tile), okey)) return tile;
  }
  return null;
}

/** Seven pairs of identical tiles; a wild pairs with anything. */
function isPairs(counts: Counts, wilds: number): boolean {
  let singles = 0;
  for (const row of counts) for (const n of row) singles += n % 2;
  return singles <= wilds;
}

/**
 * Can every tile be split into runs (same color, consecutive, 3+) and groups
 * (same value, distinct colors, 3-4)? Takes the lowest remaining tile, tries every
 * meld it could belong to, and recurses. Counts are restored before returning.
 */
function canMeld(counts: Counts, wilds: number): boolean {
  for (let c = 0; c < COLORS.length; c++) {
    for (let v = 1; v <= 13; v++) {
      if (counts[c][v] === 0) continue;
      counts[c][v]--;
      const ok = meldAsGroup(counts, wilds, c, v) || meldAsRun(counts, wilds, c, v);
      counts[c][v]++;
      return ok;
    }
  }
  // Leftover wilds would have been absorbed by a longer run or a 4-group above.
  return wilds === 0;
}

function meldAsGroup(counts: Counts, wilds: number, c: number, v: number): boolean {
  const others = [0, 1, 2, 3].filter((o) => o !== c);
  const pick = (i: number, size: number): boolean => {
    if (i === others.length) {
      for (let pad = 0; pad <= wilds && size + pad <= 4; pad++) {
        if (size + pad >= 3 && canMeld(counts, wilds - pad)) return true;
      }
      return false;
    }
    if (pick(i + 1, size)) return true;
    const o = others[i];
    if (counts[o][v] === 0) return false;
    counts[o][v]--;
    const ok = pick(i + 1, size + 1);
    counts[o][v]++;
    return ok;
  };
  return pick(0, 1);
}

function meldAsRun(counts: Counts, wilds: number, c: number, v: number): boolean {
  // The tile is the lowest real tile of the run; wilds may stand in below it.
  for (let lead = 0; lead <= wilds && v - lead >= 1; lead++) {
    const start = v - lead;
    if (extendRun(counts, wilds - lead, c, v + 1, lead + 1, start === 1 ? 13 : WRAP_POS)) return true;
  }
  // A 1 may instead be the top of a ...12-13-1 run.
  if (v === 1) {
    for (let start = 12; start >= 2; start--) {
      if (fillRun(counts, wilds, c, start, 13)) return true;
    }
  }
  return false;
}

function extendRun(counts: Counts, wilds: number, c: number, pos: number, length: number, lastPos: number): boolean {
  if (length >= 3 && canMeld(counts, wilds)) return true;
  if (pos > lastPos) return false;
  const v = valueAt(pos);
  if (counts[c][v] > 0) {
    counts[c][v]--;
    const ok = extendRun(counts, wilds, c, pos + 1, length + 1, lastPos);
    counts[c][v]++;
    if (ok) return true;
  }
  return wilds > 0 && extendRun(counts, wilds - 1, c, pos + 1, length + 1, lastPos);
}

/** Every position from pos..lastPos must be filled, by a real tile or a wild. */
function fillRun(counts: Counts, wilds: number, c: number, pos: number, lastPos: number): boolean {
  if (pos > lastPos) return canMeld(counts, wilds);
  if (counts[c][pos] > 0) {
    counts[c][pos]--;
    const ok = fillRun(counts, wilds, c, pos + 1, lastPos);
    counts[c][pos]++;
    if (ok) return true;
  }
  return wilds > 0 && fillRun(counts, wilds - 1, c, pos + 1, lastPos);
}
