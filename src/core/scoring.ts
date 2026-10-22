import { SEATS, type RoundState } from './game';
import type { WinKind } from './hand';
import { resolve, type Face, type Tile } from './tile';

/**
 * Classic match scoring ("20'den düşme"): everyone starts with START_POINTS, the players
 * who did not finish lose points each hand, and the match ends when someone hits zero.
 */
export const START_POINTS = 20;

export const PENALTY = {
  /** Each other player, when a hand is finished with runs and sets. */
  win: 2,
  /** ...when the finishing discard is the okey. */
  okeyFinish: 4,
  /** ...when the hand is finished with seven pairs. */
  pairs: 4,
  /** ...when finished with pairs and the finishing discard is the okey. */
  pairsOkeyFinish: 8,
  /** Each other player, when a seat shows a copy of the indicator. */
  indicator: 1,
} as const;

export interface MatchState {
  points: number[];
  /** Hands completed in this match. */
  hands: number;
  /** The points everyone started with. */
  start?: number;
}

export const newMatch = (start: number = START_POINTS): MatchState => ({ points: new Array<number>(SEATS).fill(start), hands: 0, start });

/** The colored okey: a red or black indicator makes the okey count double. */
export const isColoredOkey = (r: RoundState): boolean => r.indicator.color === 'red' || r.indicator.color === 'black';

export function finishedWithOkey(r: RoundState): boolean {
  return r.finishTile !== null && resolve(r.finishTile, r.okey).wild;
}

/** What each other player loses when a hand is finished this way. */
export function finishPenalty(kind: WinKind, okeyDiscard: boolean, coloredOkey = false): number {
  // The colored okey only doubles the okey finish; a normal finish is the same.
  if (kind === 'pairs') {
    return okeyDiscard ? (coloredOkey ? PENALTY.pairsOkeyFinish * 2 : PENALTY.pairsOkeyFinish) : PENALTY.pairs;
  }
  return okeyDiscard ? (coloredOkey ? PENALTY.okeyFinish * 2 : PENALTY.okeyFinish) : PENALTY.win;
}

/** Points each seat loses for a finished round (0 for the winner). */
export function roundPenalties(r: RoundState, coloredOkey = false): number[] {
  const lost = new Array<number>(SEATS).fill(0);
  const charge = (amount: number, except: number) => {
    for (let seat = 0; seat < SEATS; seat++) if (seat !== except) lost[seat] += amount;
  };
  if (r.indicatorShownBy !== null) charge(PENALTY.indicator, r.indicatorShownBy);
  if (r.winner !== null && r.winKind !== null) {
    charge(finishPenalty(r.winKind, finishedWithOkey(r), coloredOkey), r.winner);
  }
  return lost;
}

/** Applies a finished round to the match and returns what each seat lost. */
export function scoreRound(match: MatchState, r: RoundState, coloredOkey = false): number[] {
  const lost = roundPenalties(r, coloredOkey);
  match.points = match.points.map((p, seat) => p - lost[seat]);
  match.hands++;
  return lost;
}

export const isMatchOver = (match: MatchState): boolean => match.points.some((p) => p <= 0);

/**
 * The face value of a hand: what the player is still holding.
 * A fake okey counts as the okey it stands in for; a real okey is worth 20.
 */
export function handValue(hand: readonly Tile[], okey: Face): number {
  let total = 0;
  for (const tile of hand) {
    if (tile.kind === 'fake') {
      total += 20;
      continue;
    }
    if (tile.color === okey.color && tile.value === okey.value) {
      total += 20;
      continue;
    }
    total += tile.value;
  }
  return total;
}

/** Seats with the most points; several on a tie. */
export function matchLeaders(match: MatchState): number[] {
  const best = Math.max(...match.points);
  return match.points.flatMap((p, seat) => (p === best ? [seat] : []));
}
