import { COLORS, type Tile } from './tile';

export const TILE_COUNT = 106;

/** 4 colors x 1..13 x 2 copies, plus 2 fake okeys. */
export function createTileSet(): Tile[] {
  const tiles: Tile[] = [];
  let id = 0;
  for (let copy = 0; copy < 2; copy++) {
    for (const color of COLORS) {
      for (let value = 1; value <= 13; value++) tiles.push({ id: id++, kind: 'number', color, value });
    }
  }
  tiles.push({ id: id++, kind: 'fake' }, { id: id++, kind: 'fake' });
  return tiles;
}
