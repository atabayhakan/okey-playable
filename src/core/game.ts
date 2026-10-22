import { createTileSet } from './deck';
import { winningKind, type WinKind } from './hand';
import { createRng, shuffle } from './rng';
import { okeyFaceFor, type Face, type NumberTile, type Tile } from './tile';

export const SEATS = 4;

export type Phase = 'draw' | 'discard' | 'roundOver';

/** Plain data so it can go straight into the cloud save. */
export interface RoundState {
  /** Seat dealt 15 tiles; it opens the round by discarding. */
  starter: number;
  turn: number;
  phase: Phase;
  /** Face-down pile; the last element is the top. */
  pile: Tile[];
  indicator: NumberTile;
  okey: Face;
  hands: Tile[][];
  /** discards[s] holds what seat s threw; only the next seat may pick up its top tile. */
  discards: Tile[][];
  /** Winning seat; stays null if the pile runs out. */
  winner: number | null;
  winKind: WinKind | null;
  finishTile: Tile | null;
  /** Turns each seat has completed this round; a turn ends with a discard. */
  turnsTaken: number[];
  /** Seat that showed a copy of the indicator (gösterge), if any. */
  indicatorShownBy: number | null;
  /** Seed the hand was dealt from: the deal can be replayed and checked. */
  seed: number;
}

export const nextSeat = (seat: number): number => (seat + 1) % SEATS;
export const previousSeat = (seat: number): number => (seat + SEATS - 1) % SEATS;

export function dealRound(seed: number, starter: number): RoundState {
  const tiles = shuffle(createTileSet(), createRng(seed));
  const indicator = tiles.splice(tiles.findIndex((t) => t.kind === 'number'), 1)[0] as NumberTile;
  const hands: Tile[][] = Array.from({ length: SEATS }, () => []);
  for (let i = 0; i < SEATS; i++) hands[(starter + i) % SEATS] = tiles.splice(0, i === 0 ? 15 : 14);
  return {
    starter,
    turn: starter,
    phase: 'discard',
    pile: tiles,
    indicator,
    okey: okeyFaceFor(indicator),
    hands,
    discards: Array.from({ length: SEATS }, () => []),
    winner: null,
    winKind: null,
    finishTile: null,
    turnsTaken: new Array<number>(SEATS).fill(0),
    indicatorShownBy: null,
    seed,
  };
}

export function canDraw(r: RoundState, seat: number): boolean {
  return r.phase === 'draw' && r.turn === seat && r.pile.length > 0;
}

export function canTakeDiscard(r: RoundState, seat: number): boolean {
  return r.phase === 'draw' && r.turn === seat && r.discards[previousSeat(seat)].length > 0;
}

/** The tile in seat's hand identical to the indicator, if any (there are two of every tile). */
export function indicatorTwin(r: RoundState, seat: number): Tile | null {
  const { color, value } = r.indicator;
  return r.hands[seat].find((t) => t.kind === 'number' && t.color === color && t.value === value) ?? null;
}

/**
 * Gösterge: only on the seat's first turn, before it draws. The starter is dealt 15 tiles
 * and never draws on its first turn, so it may show until its first discard.
 */
export function canShowIndicator(r: RoundState, seat: number): boolean {
  const beforeFirstDraw = r.phase === 'draw' || (r.phase === 'discard' && seat === r.starter);
  return (
    r.turn === seat &&
    r.turnsTaken[seat] === 0 &&
    beforeFirstDraw &&
    r.indicatorShownBy === null &&
    indicatorTwin(r, seat) !== null
  );
}

export function showIndicator(r: RoundState, seat: number): void {
  if (!canShowIndicator(r, seat)) throw new Error(`Seat ${seat} cannot show the indicator now`);
  r.indicatorShownBy = seat;
}

export function drawFromPile(r: RoundState, seat: number): Tile {
  if (!canDraw(r, seat)) throw new Error(`Seat ${seat} cannot draw now`);
  const tile = r.pile.pop()!;
  r.hands[seat].push(tile);
  r.phase = 'discard';
  return tile;
}

export function takeDiscard(r: RoundState, seat: number): Tile {
  if (!canTakeDiscard(r, seat)) throw new Error(`Seat ${seat} cannot take a discard now`);
  const tile = r.discards[previousSeat(seat)].pop()!;
  r.hands[seat].push(tile);
  r.phase = 'discard';
  return tile;
}

export function discardTile(r: RoundState, seat: number, tileId: number): Tile {
  const tile = removeFromHand(r, seat, tileId);
  r.discards[seat].push(tile);
  r.turnsTaken[seat]++;
  if (r.pile.length === 0) {
    r.phase = 'roundOver';
  } else {
    r.turn = nextSeat(seat);
    r.phase = 'draw';
  }
  return tile;
}

/** Finish by throwing tileId; returns false (and changes nothing) if the other 14 do not win. */
export function declareWin(r: RoundState, seat: number, tileId: number): boolean {
  assertDiscardTurn(r, seat);
  const rest = r.hands[seat].filter((t) => t.id !== tileId);
  const kind = winningKind(rest, r.okey);
  if (!kind) return false;
  r.finishTile = removeFromHand(r, seat, tileId);
  r.winner = seat;
  r.winKind = kind;
  r.phase = 'roundOver';
  return true;
}

function assertDiscardTurn(r: RoundState, seat: number): void {
  if (r.phase !== 'discard' || r.turn !== seat) throw new Error(`Seat ${seat} cannot discard now`);
}

function removeFromHand(r: RoundState, seat: number, tileId: number): Tile {
  assertDiscardTurn(r, seat);
  const hand = r.hands[seat];
  const i = hand.findIndex((t) => t.id === tileId);
  if (i === -1) throw new Error(`Tile ${tileId} is not in seat ${seat}'s hand`);
  return hand.splice(i, 1)[0];
}
