import { TILE_COUNT } from '../core/deck';
import { SEATS, type RoundState } from '../core/game';
import type { Rack } from './rack';

/**
 * Cloud save (ytgame.game.saveData). Bump SAVE_VERSION when the shape changes and add a
 * migration in `upgrade`: Playables certification requires older saves to keep loading.
 */
export const SAVE_VERSION = 1;

export interface Stats {
  played: number;
  won: number;
}

export interface SaveData {
  v: number;
  stats: Stats;
  /** The hand in progress, so a player can leave and come back. */
  round: RoundState | null;
  rack: Rack | null;
}

export const emptySave = (): SaveData => ({ v: SAVE_VERSION, stats: { played: 0, won: 0 }, round: null, rack: null });

export const serializeSave = (save: SaveData): string => JSON.stringify(save);

/** Never throws: an unreadable save becomes a fresh one. */
export function parseSave(raw: string): SaveData {
  if (!raw) return emptySave();
  try {
    return upgrade(JSON.parse(raw));
  } catch {
    return emptySave();
  }
}

function upgrade(data: unknown): SaveData {
  const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const save = emptySave();
  const stats = (d.stats ?? {}) as Partial<Record<keyof Stats, unknown>>;
  save.stats.played = count(stats.played);
  save.stats.won = Math.min(count(stats.won), save.stats.played);
  // Future: `if (d.v === 1) migrate v1 -> v2` steps go here. Stats always carry over.
  if (d.v === SAVE_VERSION && looksLikeRound(d.round)) {
    save.round = d.round;
    save.rack = Array.isArray(d.rack) ? (d.rack as Rack) : null;
  }
  return save;
}

const count = (x: unknown): number => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : 0);

function looksLikeRound(x: unknown): x is RoundState {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Partial<RoundState>;
  if (!Array.isArray(r.pile) || !Array.isArray(r.hands) || !Array.isArray(r.discards)) return false;
  if (r.hands.length !== SEATS || r.discards.length !== SEATS || !r.indicator || !r.okey) return false;
  if (typeof r.turn !== 'number' || typeof r.phase !== 'string') return false;
  const tiles =
    r.pile.length +
    r.hands.reduce((n, h) => n + h.length, 0) +
    r.discards.reduce((n, d) => n + d.length, 0) +
    1 +
    (r.finishTile ? 1 : 0);
  return tiles === TILE_COUNT;
}
