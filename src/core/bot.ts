import { distance, faceId, FACES, improvingFaces } from './distance';
import { previousSeat, type RoundState } from './game';
import { meldsInHand, winningKind } from './hand';
import { createRng } from './rng';
import { finishPenalty } from './scoring';
import { COLORS, resolve, type Face, type Tile } from './tile';

/**
 * How sharp the computer opponents are.
 *
 * - easy: rules of thumb about which tiles go together, a hand that is slow to come
 *   together, and now and then a plain mistake.
 * - normal: plays by distance to a win: every throw and every take is the one that brings
 *   the hand closest to winning.
 * - hard: the same, and it keeps count of the tiles that are gone, so it holds on to the
 *   tiles it can still draw and lets the dead ones go.
 */
export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * The numbers the bots play by. An object rather than constants so that bench/tune.test.ts can
 * try other values; nothing else changes them.
 */
export const tuning = {
  /**
   * Easy takes a discarded tile once it links with this much in hand. The bar matters:
   * if the bots always take from the pile in front of them, the face down pile never
   * empties and the hand never ends.
   */
  easyTakeBar: 4,
  /** Chance that an easy bot throws a tile at random instead of the one it meant to. */
  easyMistake: 0.15,
  /**
   * Chance that a normal bot slips: it throws a tile that leaves the hand at most one step further
   * from winning than the best throw, or lets a tile it wanted go by. The hard bot never does.
   */
  normalMistake: 0.2,
  /**
   * Seven pairs ask for exact tiles (the other copy of one face), where runs and sets accept
   * several. A hole in a pairs plan therefore counts as this much more of a distance.
   */
  pairBias: 1,
  /** Hard also takes a tile that leaves the distance alone if it adds this many tiles to draw. */
  hardTakeMargin: 3,
  /** How much each tile that could still be drawn counts for the hard bot. 0 ignores them. */
  outsWeight: 1,
  /**
   * Counting the tiles that help costs a search per face, so the hard bot only does it for this
   * many throws (or takes): the ones that go with the hand least, which are the ones it might throw.
   */
  hardCandidates: 4,
};

/** Distance between two values of one color, counting the 12-13-1 wrap. */
function gap(a: number, b: number): number {
  if (a > b) [a, b] = [b, a];
  if (a === 1 && b === 13) return 1;
  if (a === 1 && b === 12) return 2;
  return b - a;
}

/** Rough usefulness of a tile given the rest of the hand. Higher means keep it. */
export function tileValue(tile: Tile, hand: readonly Tile[], okey: Face): number {
  const me = resolve(tile, okey);
  if (me.wild) return 100;
  let score = 0;
  const groupColors = new Set<string>();
  for (const other of hand) {
    if (other === tile) continue;
    const o = resolve(other, okey);
    if (o.wild) continue;
    if (o.color === me.color) {
      const d = gap(me.value, o.value);
      score += d === 0 ? 1 : d === 1 ? 4 : d === 2 ? 2 : 0;
    } else if (o.value === me.value && !groupColors.has(o.color)) {
      groupColors.add(o.color);
      score += 3;
    }
  }
  return score;
}

// ---- Distance: what the normal and the hard bot play by -----------------------------------

/** Tiles to draw to win, taking the better of the two ways to win. */
function toWin(hand: readonly Tile[], okey: Face): number {
  const d = distance(hand, okey);
  // The bias is for holes that are yet to be filled: a hand of seven pairs has none, it has won.
  if (d.sets === 0 || d.pairs === 0) return 0;
  return Math.min(d.sets, d.pairs + tuning.pairBias);
}

/** How many of each tile the bot cannot see yet, from what is face up and in its own hand. */
interface Unseen {
  /** By face (see faceId): copies that may still be in the pile or in another hand. */
  faces: number[];
  /** Real okeys that may still turn up. */
  wilds: number;
}

function unseenTiles(r: RoundState, seat: number): Unseen {
  const faces = new Array<number>(FACES).fill(2);
  let wilds = 2;
  const see = (tile: Tile): void => {
    const x = resolve(tile, r.okey);
    if (x.wild) wilds--;
    else faces[faceId(COLORS.indexOf(x.color), x.value)]--;
  };
  r.hands[seat].forEach(see);
  r.discards.forEach((pile) => pile.forEach(see));
  see(r.indicator);
  return { faces: faces.map((n) => Math.max(0, n)), wilds: Math.max(0, wilds) };
}

/**
 * How many tiles that would help are still out there for this hand: the copies of every face
 * that would bring it closer to winning, and the okeys. A hand that needs a tile whose copies
 * are all gone is further from winning than its distance says.
 *
 * This asks the search which faces help (`improvingFaces`). Reading the faces from the holes of
 * one plan was tried first and made the hard bot weaker than the normal one: the plan it reads
 * is just one of many equally good ones.
 */
function outs(hand: readonly Tile[], okey: Face, unseen: Unseen): number {
  const helping = improvingFaces(hand, okey, tuning.pairBias, (f) => unseen.faces[f] === 0);
  const wild = toWin(hand, okey) > 0 ? unseen.wilds : 0;
  return helping.reduce((sum, f) => sum + unseen.faces[f], 0) + wild;
}

/** Every tile of a hand of fifteen with how far the hand is from winning once it is thrown. */
function afterEachThrow(hand: readonly Tile[], okey: Face): { tile: Tile; rest: Tile[]; away: number }[] {
  return hand.map((tile) => {
    const rest = hand.filter((t) => t !== tile);
    return { tile, rest, away: toWin(rest, okey) };
  });
}

/** The tile to throw from fifteen: the one that leaves the hand closest to a win. */
function throwByDistance(r: RoundState, seat: number, hand: readonly Tile[], level: Difficulty): Tile {
  const options = afterEachThrow(hand, r.okey);
  const closest = Math.min(...options.map((o) => o.away));

  if (level === 'hard') {
    // Closest to a win first, and among the throws that leave the hand equally close, the one with
    // the most tiles left to draw that would help.
    const unseen = unseenTiles(r, seat);
    let best = options[0];
    let bestScore = -Infinity;
    for (const option of loosest(options.filter((o) => o.away === closest), hand, r.okey)) {
      const score = hardValue(option.rest, option.away, r.okey, unseen) - tileValue(option.tile, hand, r.okey) / 100;
      if (score > bestScore) {
        best = option;
        bestScore = score;
      }
    }
    return best.tile;
  }

  if (level === 'normal' && dice(r, seat + 5) < tuning.normalMistake) {
    // A slip: any throw that is at most one step worse than the best, never the okey.
    const nearBest = options.filter((o) => o.away <= closest + 1 && !resolve(o.tile, r.okey).wild);
    return nearBest[Math.floor(dice(r, seat + 29) * nearBest.length) % nearBest.length].tile;
  }

  const tied = options.filter((o) => o.away === closest);
  if (tied.length === 1) return tied[0].tile;
  // Throw the tile that is worth least next to its neighbours.
  return tied.reduce((a, b) => (tileValue(a.tile, hand, r.okey) <= tileValue(b.tile, hand, r.okey) ? a : b)).tile;
}

/** The throws worth a closer look: the few whose tile goes with the hand least. */
function loosest<T extends { tile: Tile }>(options: T[], hand: readonly Tile[], okey: Face): T[] {
  if (options.length <= tuning.hardCandidates) return options;
  return [...options].sort((a, b) => tileValue(a.tile, hand, okey) - tileValue(b.tile, hand, okey)).slice(0, tuning.hardCandidates);
}

/**
 * What the hard bot makes of a hand of fourteen: nearness to a win first (a step of distance is
 * worth more than every tile that could be drawn), then the tiles it can still draw that help.
 */
function hardValue(hand: readonly Tile[], away: number, okey: Face, unseen: Unseen): number {
  // `outs` costs a search per face: skip it when it counts for nothing.
  const left = tuning.outsWeight === 0 ? 0 : outs(hand, okey, unseen);
  return -away * 1000 + left * tuning.outsWeight;
}

/** How many tiles a hand of fifteen is from winning once this tile is thrown: 0 means it wins. */
export function awayAfterThrow(hand: readonly Tile[], tileId: number, okey: Face): number {
  return toWin(
    hand.filter((t) => t.id !== tileId),
    okey,
  );
}

/** Would taking the offered tile bring the hand closer to a win than it is now? */
function takingHelps(r: RoundState, seat: number, offer: Tile, level: Difficulty): boolean {
  const hand = r.hands[seat];
  const now = toWin(hand, r.okey);
  const taken = [...hand, offer];
  let bestAfter = now;
  for (const tile of taken) {
    const rest = taken.filter((t) => t !== tile);
    bestAfter = Math.min(bestAfter, toWin(rest, r.okey));
    if (bestAfter < now) return true;
  }
  if (level === 'hard') {
    // As close as before, but with more live tiles to draw: worth the tile in front of it.
    const unseen = unseenTiles(r, seat);
    const before = hardValue(hand, now, r.okey, unseen);
    let after = -Infinity;
    // Nothing brings it closer (that was checked above): the throws that keep it as close as it is.
    const equal = afterEachThrow(taken, r.okey).filter((o) => o.away === now);
    for (const option of loosest(equal, taken, r.okey)) {
      after = Math.max(after, hardValue(option.rest, option.away, r.okey, unseen));
    }
    return after > before + tuning.hardTakeMargin;
  }
  return false;
}

// ---- Easy: rules of thumb ----------------------------------------------------------------

/**
 * The tile an easy bot throws: the one that costs the hand the least, meaning it is
 * worth little on its own and breaks the fewest finished melds.
 */
function chooseByThumb(hand: readonly Tile[], okey: Face): Tile {
  const meldCount = meldsInHand(hand, okey).length;
  let worst = hand[0];
  let worstScore = Infinity;
  for (const tile of hand) {
    const rest = hand.filter((t) => t !== tile);
    const broken = meldCount - meldsInHand(rest, okey).length;
    const score = tileValue(tile, hand, okey) - broken * 6;
    if (score < worstScore) {
      worst = tile;
      worstScore = score;
    }
  }
  return worst;
}

/** A random but reproducible number for this decision: the same hand always plays out the same. */
function dice(r: RoundState, seat: number): number {
  const played = r.discards.reduce((n, pile) => n + pile.length, 0);
  return createRng((r.seed * 31 + played * 7 + seat) >>> 0)();
}

// ---- The bot ------------------------------------------------------------------------------

export function botWantsDiscard(r: RoundState, seat: number, difficulty: Difficulty = 'normal'): boolean {
  const offer = r.discards[previousSeat(seat)].at(-1);
  if (!offer) return false;
  const hand = r.hands[seat];
  if (resolve(offer, r.okey).wild) return true;

  if (difficulty !== 'easy') {
    // A normal bot now and then does not notice that the tile in front of it would help.
    if (difficulty === 'normal' && dice(r, seat + 11) < tuning.normalMistake) return false;
    return takingHelps(r, seat, offer, difficulty);
  }

  const worth = tileValue(offer, hand, r.okey);
  // Taking a tile the bot would throw straight back is a wasted turn: the hand comes out the
  // same and the middle pile never gets drawn from. Draw instead, or the hand never ends.
  if (chooseByThumb([...hand, offer], r.okey).id === offer.id) return false;
  // Taking only pays when the tile really joins the hand: it completes a meld, or it is
  // clearly better than a random tile from the middle.
  const before = meldsInHand(hand, r.okey).length;
  const after = meldsInHand([...hand, offer], r.okey).length;
  if (after > before) return true;
  return worth >= tuning.easyTakeBar;
}

/** The finishing discard that costs the others the most (e.g. throwing the okey), or null. */
function bestFinish(hand: readonly Tile[], okey: Face): Tile | null {
  let best: Tile | null = null;
  let bestPenalty = 0;
  for (const tile of hand) {
    const kind = winningKind(hand.filter((t) => t !== tile), okey);
    if (!kind) continue;
    const penalty = finishPenalty(kind, resolve(tile, okey).wild);
    if (penalty > bestPenalty) {
      best = tile;
      bestPenalty = penalty;
    }
  }
  return best;
}

export function botPlanDiscard(r: RoundState, seat: number, difficulty: Difficulty = 'normal'): { tileId: number; win: boolean } {
  const hand = r.hands[seat];
  const winning = bestFinish(hand, r.okey);
  if (winning) return { tileId: winning.id, win: true };

  if (difficulty === 'easy') {
    const meant = chooseByThumb(hand, r.okey);
    if (dice(r, seat) < tuning.easyMistake) {
      // A slip: any tile but the okey, which even a careless player does not throw away.
      const loose = hand.filter((t) => !resolve(t, r.okey).wild);
      return { tileId: loose[Math.floor(dice(r, seat + 17) * loose.length) % loose.length].id, win: false };
    }
    return { tileId: meant.id, win: false };
  }
  return { tileId: throwByDistance(r, seat, hand, difficulty).id, win: false };
}
