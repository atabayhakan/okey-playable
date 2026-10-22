import { previousSeat, type RoundState } from './game';
import { findWinningDiscard, meldsInHand, winningKind } from './hand';
import { finishPenalty } from './scoring';
import { resolve, type Face, type Tile } from './tile';

/** How sharp the computer opponents are. */
export type Difficulty = 'easy' | 'normal' | 'hard';

/**
 * A discard is worth taking once it links with two tiles in hand. The bar
 * matters: if the bots always take from the pile in front of them, the face
 * down pile never empties and the hand never ends.
 */
const TAKE_BAR: Record<Difficulty, number> = { easy: 7, normal: 4, hard: 2 };

/** Distance between two values of one color, counting the 12-13-1 wrap. */
function distance(a: number, b: number): number {
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
      const d = distance(me.value, o.value);
      score += d === 0 ? 1 : d === 1 ? 4 : d === 2 ? 2 : 0;
    } else if (o.value === me.value && !groupColors.has(o.color)) {
      groupColors.add(o.color);
      score += 3;
    }
  }
  return score;
}

export function botWantsDiscard(r: RoundState, seat: number, difficulty: Difficulty = 'normal'): boolean {
  const offer = r.discards[previousSeat(seat)].at(-1);
  if (!offer) return false;
  const hand = r.hands[seat];
  if (resolve(offer, r.okey).wild) return true;
  if (difficulty !== 'easy' && findWinningDiscard([...hand, offer], r.okey)) return true;
  const worth = tileValue(offer, hand, r.okey);
  // Taking a tile the bot would throw straight back is a wasted turn: the
  // hand comes out the same and the middle pile never gets drawn from. Draw
  // instead, or the hand never ends.
  if (chooseDiscard([...hand, offer], r.okey).id === offer.id) return false;

  // Taking only pays when the tile really joins the hand: it completes a meld,
  // or it is clearly better than a random tile from the middle.
  const before = meldsInHand(hand, r.okey).length;
  const after = meldsInHand([...hand, offer], r.okey).length;
  if (after > before) return true;
  return worth >= TAKE_BAR[difficulty];
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

export function botPlanDiscard(r: RoundState, seat: number, _difficulty: Difficulty = 'normal'): { tileId: number; win: boolean } {
  const hand = r.hands[seat];
  const winning = bestFinish(hand, r.okey);
  if (winning) return { tileId: winning.id, win: true };

  return { tileId: chooseDiscard(hand, r.okey).id, win: false };
}

/**
 * The tile the bot throws: the one that costs the hand the least, meaning it
 * is worth little on its own and breaks the fewest finished melds.
 */
function chooseDiscard(hand: readonly Tile[], okey: Face): Tile {
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
