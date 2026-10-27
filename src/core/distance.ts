import { COLORS, resolve, type Face, type Tile } from './tile';

/**
 * How far a hand is from winning: the number of tiles still to draw, if every draw
 * were the tile that is wanted.
 *
 * A winning hand has 14 tiles in at most four melds (each is three or more
 * tiles, so five would need fifteen). A hand is `distance` tiles away from the
 * best winning hand when it already holds `14 - distance` of its tiles. So the
 * question is how many of the hand's tiles can be placed in at most four melds
 * with 14 places in all, the tiles that find no place being junk. The wilds are
 * not part of that search: a wild fits any place, so it is always placed.
 *
 * The search runs over the tiles from the lowest up. For the lowest tile left it
 * tries throwing it away, or putting it in a run or a set that starts from it,
 * and goes on with what is left. The state is the set of tiles left and the
 * places left, so it is tiny: the same ones come up again and again.
 */

export const FACES = 52;
export const faceId = (color: number, value: number): number => color * 13 + (value - 1);
export const faceColor = (face: number): number => (face / 13) | 0;
export const faceValue = (face: number): number => (face % 13) + 1;

/** Places in a winning hand. */
const PLACES = 14;
/** A run may end on a 1 after the 13; that is position 14. 13-1-2 is not a run. */
const WRAP_POS = 14;
const valueAt = (pos: number): number => (pos === WRAP_POS ? 1 : pos);

export interface Distance {
  /** Tiles to draw to win with runs and sets. */
  sets: number;
  /** ...and with seven pairs. */
  pairs: number;
}

/** A meld that starts from one tile: the other tiles it can use, and its size. */
interface Pattern {
  /** Faces of the other tiles that could be in it, besides the tile it starts from. */
  others: number[];
  /** Faces that must be there; the ends of a run, which would otherwise be a shorter run. */
  ends: number[];
  /** Places the meld takes. */
  len: number;
}

/** Memo for the search; one buffer for all calls, 2^15 hands x 15 place counts. */
const MEMO = new Int8Array((1 << 15) * 15);

class Solver {
  private readonly byFace: number[][] = Array.from({ length: FACES }, () => []);
  private readonly cache: (Pattern[] | undefined)[];
  private readonly faces: number[];
  private size: number;

  /** `spare` is how many tiles may be pushed on top later (see `push`). */
  constructor(faces: readonly number[], spare = 0) {
    this.faces = [...faces];
    this.size = faces.length;
    this.cache = new Array(this.size + spare);
    this.faces.forEach((face, i) => this.byFace[face].push(i));
    MEMO.fill(-1, 0, (1 << (this.size + spare)) * 15);
  }

  /** The most tiles that find a place. */
  best(): number {
    return this.solve((1 << this.size) - 1, PLACES);
  }

  /**
   * Adds one more tile on top of the hand, as the last one. What the search has worked out for
   * the hand without it stays valid: those states never use the new tile. Only the states that
   * hold it are new, and `pop` forgets them.
   */
  push(face: number): void {
    this.byFace[face].push(this.size);
    this.faces.push(face);
    this.size++;
    this.forgetPatternsNear(face);
  }

  /** Takes the last tile off again. */
  pop(): void {
    const face = this.faces.pop()!;
    this.byFace[face].pop();
    this.size--;
    MEMO.fill(-1, (1 << this.size) * 15, (1 << (this.size + 1)) * 15);
    this.forgetPatternsNear(face);
    this.cache[this.size] = undefined;
  }

  /** The melds that start from a tile can use a new tile only if it has the tile's color or number. */
  private forgetPatternsNear(face: number): void {
    for (let t = 0; t < this.size; t++) {
      const other = this.faces[t];
      if (this.cache[t] && (faceColor(other) === faceColor(face) || faceValue(other) === faceValue(face))) this.cache[t] = undefined;
    }
  }

  private solve(mask: number, places: number): number {
    if (mask === 0) return 0;
    // `places` runs 0..14, so a mask takes 15 slots.
    const key = mask * 15 + places;
    const memo = MEMO[key];
    if (memo >= 0) return memo;
    const t = 31 - Math.clz32(mask & -mask);
    const rest = mask ^ (1 << t);
    let best = this.solve(rest, places);
    if (places >= 3) {
      for (const pattern of this.patternsFor(t)) {
        if (pattern.len > places) continue;
        const taken = this.take(pattern, t, rest, places);
        if (!taken) continue;
        const value = taken.count + 1 + this.solve(rest & ~taken.mask, places - pattern.len);
        if (value > best) best = value;
      }
    }
    MEMO[key] = best;
    return best;
  }

  /** The tiles of the hand that make this meld, or null if its ends are not there. */
  private take(pattern: Pattern, anchor: number, rest: number, places: number): { mask: number; count: number } | null {
    if (pattern.len > places) return null;
    let used = 0;
    const find = (face: number): boolean => {
      for (const i of this.byFace[face]) {
        if (i > anchor && rest & (1 << i) && !(used & (1 << i))) {
          used |= 1 << i;
          return true;
        }
      }
      return false;
    };
    for (const end of pattern.ends) if (!find(end)) return null;
    let count = pattern.ends.length;
    for (const face of pattern.others) {
      if (pattern.ends.includes(face)) continue;
      if (find(face)) count++;
    }
    return { mask: used, count };
  }

  /** Every meld that could start from this tile, the lowest one left. */
  private patternsFor(t: number): Pattern[] {
    const known = this.cache[t];
    if (known) return known;
    const face = this.faces[t];
    const color = faceColor(face);
    const value = faceValue(face);
    // Tiles higher up the list that could join: the lower ones are decided already.
    const has = (f: number): boolean => this.byFace[f].some((i) => i > t);

    const patterns = new Map<string, Pattern>();
    // Windows that use the same tiles in the same number of places are one meld.
    const add = (others: number[], ends: number[], len: number): void => {
      const key = `${len}|${ends.join(',')}|${others.join(',')}`;
      if (!patterns.has(key)) patterns.set(key, { others, ends, len });
    };

    // Sets: this value in other colors.
    const colors = [0, 1, 2, 3].filter((c) => c !== color);
    for (let bits = 0; bits < 8; bits++) {
      const chosen = colors.filter((_, i) => bits & (1 << i)).map((c) => faceId(c, value));
      if (!chosen.every(has)) continue;
      add(chosen, chosen, Math.max(3, chosen.length + 1));
    }

    // Runs: windows of positions in this color that contain the tile.
    for (const pos of value === 1 ? [1, WRAP_POS] : [value]) {
      for (let len = 3; len <= 13; len++) {
        for (let start = Math.max(1, pos - len + 1); start <= Math.min(pos, WRAP_POS + 1 - len); start++) {
          const end = start + len - 1;
          if (start === 1 && end === WRAP_POS) continue;
          const others: number[] = [];
          for (let q = start; q <= end; q++) {
            if (q === pos) continue;
            const f = faceId(color, valueAt(q));
            if (has(f)) others.push(f);
          }
          // A longer run whose end is a hole is the shorter run: the same tiles, fewer places.
          const ends: number[] = [];
          if (len > 3) {
            const first = faceId(color, valueAt(start));
            const last = faceId(color, valueAt(end));
            if (start !== pos && !has(first)) continue;
            if (end !== pos && !has(last)) continue;
            if (start !== pos) ends.push(first);
            if (end !== pos) ends.push(last);
          }
          add(others, ends, len);
        }
      }
    }

    const list = [...patterns.values()];
    this.cache[t] = list;
    return list;
  }
}

/** Seven pairs: the faces held twice are pairs, the faces held once are half of one. */
function pairsDistance(faces: readonly number[]): number {
  const count = new Map<number, number>();
  for (const f of faces) count.set(f, (count.get(f) ?? 0) + 1);
  const matched = [...count.values()]
    .map((c) => Math.min(c, 2))
    .sort((a, b) => b - a)
    .slice(0, 7)
    .reduce((sum, c) => sum + c, 0);
  return faces.length - matched;
}

/**
 * The faces that would bring a hand of fourteen closer to winning if drawn: with each of them,
 * the hand of fifteen can throw one tile and be nearer than it is now. `pairBias` is how much
 * further a seven-pairs plan counts (see `tuning.pairBias`).
 *
 * One search tells the distance after the best throw of a hand of fifteen: the thrown tile is
 * one that finds no place, so it is `tiles - matched - 1` without trying the throws one by one.
 * Only faces that go with a tile of the hand are tried; a tile that goes with nothing can still take
 * a place of its own and so count as closer, but that is no progress worth wanting. `skip` lets the
 * caller leave out faces it does not need.
 */
export function improvingFaces(tiles: readonly Tile[], okey: Face, pairBias: number, skip?: (face: number) => boolean): number[] {
  const faces: number[] = [];
  for (const tile of tiles) {
    const r = resolve(tile, okey);
    if (!r.wild) faces.push(faceId(COLORS.indexOf(r.color), r.value));
  }
  faces.sort((a, b) => a - b);
  const real = faces.length;

  // One search for the hand, then one tile after another is put on top and taken off again.
  const solver = new Solver(faces, 1);
  const nowSets = real - solver.best();
  const nowPairs = pairsDistance(faces);
  const rank = (sets: number, pairs: number): number => (sets === 0 || pairs === 0 ? 0 : Math.min(sets, pairs + pairBias));
  const now = rank(nowSets, nowPairs);
  if (now === 0) return [];

  // Faces next to a tile of the hand: its own face, two up and down in the color, the same number elsewhere.
  const near = new Set<number>();
  for (const f of faces) {
    const color = faceColor(f);
    const value = faceValue(f);
    for (let dv = -2; dv <= 2; dv++) {
      let v = value + dv;
      if (v > 13) v -= 13;
      else if (v < 1) v += 13;
      near.add(faceId(color, v));
    }
    for (let c = 0; c < 4; c++) near.add(faceId(c, value));
  }

  const out: number[] = [];
  for (const f of near) {
    // A face nobody can draw any more (the caller knows) is not worth a search.
    if (skip?.(f)) continue;
    solver.push(f);
    // The thrown tile finds no place, so the hand left is one tile fewer than the fifteen.
    const afterSets = real - solver.best();
    solver.pop();
    const afterPairs = pairsDistance([...faces, f]) - 1;
    if (rank(afterSets, afterPairs) < now) out.push(f);
  }
  return out;
}

/**
 * Tiles still to draw to win, with runs and sets and with seven pairs. For a hand
 * of fourteen tiles: 0 is a winning hand. For fifteen, call it on the hand with
 * one tile thrown.
 */
export function distance(tiles: readonly Tile[], okey: Face): Distance {
  const faces: number[] = [];
  for (const tile of tiles) {
    const r = resolve(tile, okey);
    if (!r.wild) faces.push(faceId(COLORS.indexOf(r.color), r.value));
  }
  // The memo holds hands up to fifteen tiles; a hand is fourteen, or fifteen before the throw.
  if (faces.length > 15) throw new Error(`distance() takes at most 15 tiles, got ${faces.length}`);
  faces.sort((a, b) => a - b);
  return { sets: faces.length - new Solver(faces).best(), pairs: pairsDistance(faces) };
}
