import { COLORS, resolve, type Color, type Face, type Tile } from './tile';

export type WinKind = 'sets' | 'pairs';

export const WINNING_HAND_SIZE = 14;

/** counts[colorIndex][value], value 1..13 (index 0 unused). */
type Counts = number[][];

/** A place in a meld: a concrete face, or null for a wild standing in. */
type Slot = { c: number; v: number } | null;
/** Melds found so far by the solver; on success it holds the whole split. */
type Trail = Slot[][];

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

/**
 * Pairs is checked first: a hand that is both seven pairs and runs/sets scores as pairs,
 * which always costs the other players at least as much.
 */
export function winningKind(tiles: readonly Tile[], okey: Face): WinKind | null {
  if (tiles.length !== WINNING_HAND_SIZE) return null;
  const { counts, wilds } = tally(tiles, okey);
  if (isPairs(counts, wilds)) return 'pairs';
  if (canMeld(counts, wilds, [])) return 'sets';
  return null;
}

/**
 * The hand is finished with all its tiles in one colour. A set always needs
 * three or four colours, so such a hand can only be melded as runs of that
 * colour, with the wild standing in for the missing tiles.
 */
export function isSingleColorFinish(tiles: readonly Tile[], okey: Face): boolean {
  let color: Color | null = null;
  for (const tile of tiles) {
    const r = resolve(tile, okey);
    if (r.wild) continue;
    if (color === null) color = r.color;
    else if (color !== r.color) return false;
  }
  return color !== null;
}

export const isWinningHand = (tiles: readonly Tile[], okey: Face): boolean => winningKind(tiles, okey) !== null;

/**
 * The complete melds a hand already holds: sets of three or four of the same
 * value, and runs of three or more in one colour. The wild may stand in for a
 * missing tile, so two tiles plus the wild is a set or a run as well.
 *
 * The player cannot see this on the felt, so the view marks the tiles: it is
 * the difference between "I think I have something" and "I have two sets".
 */
export function meldsInHand(tiles: readonly Tile[], okey: Face): Tile[][] {
  const wilds: Tile[] = [];
  const pool: Tile[] = [];
  for (const tile of tiles) {
    if (resolve(tile, okey).wild) wilds.push(tile);
    else pool.push(tile);
  }

  const counts = COLORS.map(() => new Array<number>(14).fill(0));
  const byFace = new Map<string, Tile[]>();
  for (const tile of pool) {
    const r = resolve(tile, okey);
    if (r.wild) continue;
    counts[COLORS.indexOf(r.color)][r.value]++;
    const key = `${r.color}-${r.value}`;
    byFace.set(key, [...(byFace.get(key) ?? []), tile]);
  }
  const take = (color: Color, value: number): Tile => {
    const key = `${color}-${value}`;
    const tile = byFace.get(key)!.shift()!;
    counts[COLORS.indexOf(color)][value]--;
    return tile;
  };

  const melds: Tile[][] = [];

  // Sets first: three or four of the same value in different colours is the
  // scarcest meld, so it is worth taking before any run.
  for (let value = 1; value <= 13; value++) {
    for (;;) {
      const colors = COLORS.filter((c) => counts[COLORS.indexOf(c)][value] > 0);
      if (colors.length >= 3) {
        melds.push(colors.slice(0, 4).map((c) => take(c, value)));
        continue;
      }
      if (colors.length === 2 && wilds.length > 0) {
        melds.push([take(colors[0], value), take(colors[1], value), wilds.shift()!]);
        continue;
      }
      break;
    }
  }

  // Runs: the long ones first, then the 12-13-1 wrap, then what the wild
  // completes. The wrap is only taken when it does not break a longer run.
  for (const color of COLORS) {
    const c = COLORS.indexOf(color);
    const longestRun = (): number[] => {
      let best: number[] = [];
      let run: number[] = [];
      for (let value = 1; value <= 13; value++) {
        if (counts[c][value] > 0) {
          run.push(value);
          if (run.length > best.length) best = [...run];
        } else {
          run = [];
        }
      }
      return best;
    };
    for (;;) {
      const seq = longestRun();
      if (seq.length >= 3) {
        melds.push(seq.map((v) => take(color, v)));
        continue;
      }
      // The only way a run crosses from 13 back to 1.
      if (counts[c][12] > 0 && counts[c][13] > 0 && counts[c][1] > 0) {
        melds.push([take(color, 12), take(color, 13), take(color, 1)]);
        continue;
      }
      if (seq.length === 2 && wilds.length > 0) {
        melds.push([take(color, seq[0]), take(color, seq[1]), wilds.shift()!]);
        continue;
      }
      if (seq.length === 1 && wilds.length >= 2) {
        melds.push([take(color, seq[0]), wilds.shift()!, wilds.shift()!]);
        continue;
      }
      break;
    }
  }

  return melds;
}

/** For a 15-tile hand: a tile whose discard leaves a winning 14, or null. */
export function findWinningDiscard(hand: readonly Tile[], okey: Face): Tile | null {
  // Try ordinary tiles first so the okey is never thrown away needlessly.
  const order = [...hand].sort((a, b) => Number(resolve(a, okey).wild) - Number(resolve(b, okey).wild));
  for (const tile of order) {
    if (isWinningHand(hand.filter((t) => t !== tile), okey)) return tile;
  }
  return null;
}

/** How a winning hand splits: its pairs, or its runs and sets with each wild in place. */
export function winningGroups(tiles: readonly Tile[], okey: Face): { kind: WinKind; groups: Tile[][] } | null {
  const kind = winningKind(tiles, okey);
  if (!kind) return null;
  const faceKey = (c: number, v: number) => c * 100 + v;
  const pool = new Map<number, Tile[]>();
  const wildTiles: Tile[] = [];
  for (const tile of tiles) {
    const r = resolve(tile, okey);
    if (r.wild) wildTiles.push(tile);
    else {
      const key = faceKey(COLORS.indexOf(r.color), r.value);
      pool.set(key, [...(pool.get(key) ?? []), tile]);
    }
  }

  if (kind === 'pairs') {
    const groups: Tile[][] = [];
    for (const key of [...pool.keys()].sort((a, b) => a - b)) {
      const same = pool.get(key)!;
      while (same.length >= 2) groups.push(same.splice(0, 2));
      if (same.length === 1) groups.push([same[0], wildTiles.pop()!]);
    }
    while (wildTiles.length >= 2) groups.push(wildTiles.splice(0, 2));
    return { kind, groups };
  }

  const { counts, wilds } = tally(tiles, okey);
  const trail: Trail = [];
  canMeld(counts, wilds, trail);
  const groups = trail.map((meld) => meld.map((slot) => (slot === null ? wildTiles.pop()! : pool.get(faceKey(slot.c, slot.v))!.pop()!)));
  return { kind, groups };
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
 * meld it could belong to, and recurses. Counts are restored before returning; on
 * success `trail` holds the melds used.
 */
function canMeld(counts: Counts, wilds: number, trail: Trail): boolean {
  for (let c = 0; c < COLORS.length; c++) {
    for (let v = 1; v <= 13; v++) {
      if (counts[c][v] === 0) continue;
      counts[c][v]--;
      const ok = meldAsGroup(counts, wilds, c, v, trail) || meldAsRun(counts, wilds, c, v, trail);
      counts[c][v]++;
      return ok;
    }
  }
  // Leftover wilds would have been absorbed by a longer run or a 4-group above.
  return wilds === 0;
}

/** Records `meld`, then tries to place everything else; undoes the record on failure. */
function withMeld(meld: Slot[], counts: Counts, wilds: number, trail: Trail): boolean {
  trail.push(meld);
  if (canMeld(counts, wilds, trail)) return true;
  trail.pop();
  return false;
}

function meldAsGroup(counts: Counts, wilds: number, c: number, v: number, trail: Trail): boolean {
  const others = [0, 1, 2, 3].filter((o) => o !== c);
  const members: Slot[] = [{ c, v }];
  const pick = (i: number): boolean => {
    if (i === others.length) {
      for (let pad = 0; pad <= wilds && members.length + pad <= 4; pad++) {
        if (members.length + pad < 3) continue;
        if (withMeld([...members, ...new Array<Slot>(pad).fill(null)], counts, wilds - pad, trail)) return true;
      }
      return false;
    }
    if (pick(i + 1)) return true;
    const o = others[i];
    if (counts[o][v] === 0) return false;
    counts[o][v]--;
    members.push({ c: o, v });
    const ok = pick(i + 1);
    members.pop();
    counts[o][v]++;
    return ok;
  };
  return pick(0);
}

function meldAsRun(counts: Counts, wilds: number, c: number, v: number, trail: Trail): boolean {
  // The tile is the lowest real tile of the run; wilds may stand in below it.
  for (let lead = 0; lead <= wilds && v - lead >= 1; lead++) {
    const start = v - lead;
    const run: Slot[] = [...new Array<Slot>(lead).fill(null), { c, v }];
    if (extendRun(counts, wilds - lead, c, v + 1, run, start === 1 ? 13 : WRAP_POS, trail)) return true;
  }
  // A 1 may instead be the top of a ...12-13-1 run.
  if (v === 1) {
    for (let start = 12; start >= 2; start--) {
      if (fillRun(counts, wilds, c, start, [], { c, v }, trail)) return true;
    }
  }
  return false;
}

function extendRun(counts: Counts, wilds: number, c: number, pos: number, run: Slot[], lastPos: number, trail: Trail): boolean {
  if (run.length >= 3 && withMeld([...run], counts, wilds, trail)) return true;
  if (pos > lastPos) return false;
  const v = valueAt(pos);
  if (counts[c][v] > 0) {
    counts[c][v]--;
    run.push({ c, v });
    const ok = extendRun(counts, wilds, c, pos + 1, run, lastPos, trail);
    run.pop();
    counts[c][v]++;
    if (ok) return true;
  }
  if (wilds === 0) return false;
  run.push(null);
  const ok = extendRun(counts, wilds - 1, c, pos + 1, run, lastPos, trail);
  run.pop();
  return ok;
}

/** Fills every position from pos up to 13 (real tile or wild), then closes the run with the 1. */
function fillRun(counts: Counts, wilds: number, c: number, pos: number, run: Slot[], closer: Slot, trail: Trail): boolean {
  if (pos > 13) return withMeld([...run, closer], counts, wilds, trail);
  if (counts[c][pos] > 0) {
    counts[c][pos]--;
    run.push({ c, v: pos });
    const ok = fillRun(counts, wilds, c, pos + 1, run, closer, trail);
    run.pop();
    counts[c][pos]++;
    if (ok) return true;
  }
  if (wilds === 0) return false;
  run.push(null);
  const ok = fillRun(counts, wilds - 1, c, pos + 1, run, closer, trail);
  run.pop();
  return ok;
}
