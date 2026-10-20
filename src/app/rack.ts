import { COLORS, resolve, type Face, type Tile } from '../core/tile';

/**
 * The player's istaka: a fixed row of slots holding tile ids, with gaps the player
 * arranges freely. The view wraps it into 2 or 3 rows depending on the screen, so the
 * arrangement survives orientation changes.
 */
export const RACK_SLOTS = 30;
export type Rack = (number | null)[];

/** Put a new tile right after the last tile on the rack (or the first free slot). */
export function placeTile(rack: Rack, id: number): void {
  if (rack.includes(id)) return;
  let last = -1;
  rack.forEach((slot, i) => {
    if (slot !== null) last = i;
  });
  let slot = rack.indexOf(null, last + 1);
  if (slot === -1) slot = rack.indexOf(null);
  rack[slot] = id;
}

export function removeTile(rack: Rack, id: number): void {
  const i = rack.indexOf(id);
  if (i !== -1) rack[i] = null;
}

/** Move a tile to a slot, swapping with whatever is there. */
export function moveTile(rack: Rack, id: number, slot: number): void {
  const from = rack.indexOf(id);
  if (from === -1 || from === slot || slot < 0 || slot >= RACK_SLOTS) return;
  [rack[from], rack[slot]] = [rack[slot], rack[from]];
}

/** Rebuild a saved rack so it holds exactly the tiles in hand. */
export function reconcileRack(saved: readonly unknown[], hand: readonly Tile[]): Rack {
  const inHand = new Set(hand.map((t) => t.id));
  const seen = new Set<number>();
  const rack: Rack = Array.from({ length: RACK_SLOTS }, (_, i) => {
    const id = saved[i];
    if (typeof id !== 'number' || !inHand.has(id) || seen.has(id)) return null;
    seen.add(id);
    return id;
  });
  for (const tile of hand) if (!seen.has(tile.id)) placeTile(rack, tile.id);
  return rack;
}

/** "Seri diz": consecutive runs of one color, each followed by a gap; wilds last. */
export function arrangeRuns(hand: readonly Tile[], okey: Face): Rack {
  const groups: Tile[][] = [];
  let prev: [number, number] | null = null;
  for (const tile of sortedTiles(hand, okey)) {
    const key = sortKey(tile, okey);
    const continues = prev !== null && prev[0] === key[0] && (key[0] === COLORS.length || key[1] === prev[1] + 1);
    if (continues) groups[groups.length - 1].push(tile);
    else groups.push([tile]);
    prev = key;
  }
  return layoutGroups(groups);
}

/** "Çift diz": identical tiles side by side, each pair followed by a gap; wilds last. */
export function arrangePairs(hand: readonly Tile[], okey: Face): Rack {
  const groups = new Map<string, Tile[]>();
  for (const tile of sortedTiles(hand, okey)) {
    const key = sortKey(tile, okey).join('-');
    const group = groups.get(key);
    if (group) group.push(tile);
    else groups.set(key, [tile]);
  }
  return layoutGroups([...groups.values()]);
}

/** Wilds sort after every color. */
function sortKey(tile: Tile, okey: Face): [number, number] {
  const r = resolve(tile, okey);
  return r.wild ? [COLORS.length, 0] : [COLORS.indexOf(r.color), r.value];
}

function sortedTiles(hand: readonly Tile[], okey: Face): Tile[] {
  return [...hand].sort((a, b) => {
    const [ac, av] = sortKey(a, okey);
    const [bc, bv] = sortKey(b, okey);
    return ac - bc || av - bv;
  });
}

function layoutGroups(groups: Tile[][]): Rack {
  const rack: Rack = new Array(RACK_SLOTS).fill(null);
  const tiles = groups.reduce((n, g) => n + g.length, 0);
  const withGaps = tiles + groups.length - 1 <= RACK_SLOTS;
  let i = 0;
  for (const group of groups) {
    for (const tile of group) rack[i++] = tile.id;
    if (withGaps) i++;
  }
  return rack;
}
