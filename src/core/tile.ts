export const COLORS = ['red', 'yellow', 'blue', 'black'] as const;
export type Color = (typeof COLORS)[number];

export interface NumberTile {
  id: number;
  kind: 'number';
  color: Color;
  /** 1..13 */
  value: number;
}

/** The two "sahte okey" tiles: they stand in for the real okey's face. */
export interface FakeOkeyTile {
  id: number;
  kind: 'fake';
}

export type Tile = NumberTile | FakeOkeyTile;

export interface Face {
  color: Color;
  value: number;
}

export type Resolved = { wild: true } | { wild: false; color: Color; value: number };

export const nextValue = (value: number): number => (value === 13 ? 1 : value + 1);

/** The okey is the tile one above the indicator in the same color (13 wraps to 1). */
export function okeyFaceFor(indicator: NumberTile): Face {
  return { color: indicator.color, value: nextValue(indicator.value) };
}

/** How a tile counts this round: the real okey is wild, a fake okey takes the okey's face. */
export function resolve(tile: Tile, okey: Face): Resolved {
  if (tile.kind === 'fake') return { wild: false, color: okey.color, value: okey.value };
  if (tile.color === okey.color && tile.value === okey.value) return { wild: true };
  return { wild: false, color: tile.color, value: tile.value };
}
