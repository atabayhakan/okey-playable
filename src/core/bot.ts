import { previousSeat, type RoundState } from './game';
import { findWinningDiscard } from './hand';
import { resolve, type Face, type Tile } from './tile';

/** A discard is worth taking if it already links with about two tiles in hand. */
const TAKE_THRESHOLD = 6;

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

export function botWantsDiscard(r: RoundState, seat: number): boolean {
  const offer = r.discards[previousSeat(seat)].at(-1);
  if (!offer) return false;
  const hand = r.hands[seat];
  if (resolve(offer, r.okey).wild) return true;
  if (findWinningDiscard([...hand, offer], r.okey)) return true;
  return tileValue(offer, hand, r.okey) >= TAKE_THRESHOLD;
}

export function botPlanDiscard(r: RoundState, seat: number): { tileId: number; win: boolean } {
  const hand = r.hands[seat];
  const winning = findWinningDiscard(hand, r.okey);
  if (winning) return { tileId: winning.id, win: true };
  let worst = hand[0];
  let worstScore = Infinity;
  for (const tile of hand) {
    const score = tileValue(tile, hand, r.okey);
    if (score < worstScore) {
      worst = tile;
      worstScore = score;
    }
  }
  return { tileId: worst.id, win: false };
}
