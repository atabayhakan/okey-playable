import { meldsInHand } from '../core/hand';
import { COLORS, resolve, type Color, type Face, type Tile } from '../core/tile';

/**
 * The player's istaka: a row of slots holding tile ids, with gaps the player
 * arranges freely. The view wraps it into rows depending on the screen, so the
 * arrangement survives orientation changes.
 *
 * A slot holds a tile id, null (free space) or GROUP_BREAK (the gap that
 * separates two groups). Gaps are what make a set or a run readable at a
 * glance; free slots are invisible, so an empty rack is quiet.
 */
export const GROUP_BREAK = -1;
export const RACK_SLOTS = 30;
export type Rack = (number | null)[];

/** Put a new tile right after the last tile on the rack (or the first free slot). */
export function placeTile(rack: Rack, id: number): void {
  if (rack.includes(id)) return;
  let last = -1;
  rack.forEach((slot, i) => {
    if (slot !== null && slot !== GROUP_BREAK) last = i;
  });
  let slot = rack.indexOf(null, last + 1);
  if (slot === -1) slot = rack.indexOf(null);
  if (slot === -1) {
    // No free slot: drop it in right after the last tile.
    const insertAt = last === -1 ? 0 : last + 1;
    rack.splice(insertAt, 0, id);
    return;
  }
  rack[slot] = id;
}

export function removeTile(rack: Rack, id: number): void {
  const i = rack.indexOf(id);
  if (i !== -1) rack[i] = null;
}

/**
 * Closes the hole a thrown tile leaves behind, keeping the group breaks. The
 * ıstaka should read as one continuous row of tiles, not as a grid with gaps.
 */
export function compactRack(rack: Rack): void {
  const kept = rack.filter((id) => id !== null);
  while (kept.length && kept[kept.length - 1] === GROUP_BREAK) kept.pop();
  rack.fill(null);
  kept.forEach((id, i) => {
    rack[i] = id;
  });
}

/** Move a tile to a slot, swapping with whatever is there. */
export function moveTile(rack: Rack, id: number, slot: number): void {
  const from = rack.indexOf(id);
  if (from === -1 || slot < 0 || slot >= RACK_SLOTS) return;
  if (from === slot) return;
  // Swapping with a gap would break the layout, so the tile simply moves there.
  const target = rack[slot];
  if (target === GROUP_BREAK) {
    rack[from] = null;
    rack[slot] = id;
    return;
  }
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

/**
 * "En iyi diz": the complete sets and runs the hand already holds come first,
 * each as its own group, and everything else is grouped by colour. This is the
 * layout that answers "what have I got?" at a glance.
 */
export function arrangeMelds(hand: readonly Tile[], okey: Face): Rack {
  const melds = meldsInHand(hand, okey);
  const used = new Set(melds.flat().map((tile) => tile.id));
  const groups: Tile[][] = melds.map((meld) => [...meld]);
  const byColor = new Map<Color, Tile[]>();
  const wilds: Tile[] = [];
  for (const tile of hand) {
    if (used.has(tile.id)) continue;
    const r = resolve(tile, okey);
    if (r.wild) {
      wilds.push(tile);
      continue;
    }
    byColor.set(r.color, [...(byColor.get(r.color) ?? []), tile]);
  }
  for (const tiles of byColor.values()) {
    tiles.sort((a, b) => {
      const ra = resolve(a, okey);
      const rb = resolve(b, okey);
      return (ra.wild ? 0 : ra.value) - (rb.wild ? 0 : rb.value);
    });
    groups.push(tiles);
  }
  if (wilds.length) groups.push(wilds);
  return layoutGroups(groups);
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

/**
 * Lays the groups out with a gap between each pair of groups, so the player
 * can see where one set or run ends and the next begins.
 */
function layoutGroups(groups: Tile[][]): Rack {
  const rack: Rack = new Array(RACK_SLOTS).fill(null);
  const tiles = groups.reduce((n, g) => n + g.length, 0);
  const withGaps = tiles + groups.length - 1 <= RACK_SLOTS;
  let i = 0;
  for (const group of groups) {
    for (const tile of group) rack[i++] = tile.id;
    if (withGaps && group !== groups[groups.length - 1]) rack[i++] = GROUP_BREAK;
  }
  return rack;
}
