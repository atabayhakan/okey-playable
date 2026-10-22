import { TILE_COUNT } from '../core/deck';
import type { Difficulty } from '../core/bot';
import { SEATS, type RoundState } from '../core/game';
import { newMatch, START_POINTS, type MatchState } from '../core/scoring';
import type { Rack } from './rack';

/**
 * Cloud save (ytgame.game.saveData). Bump SAVE_VERSION when the shape changes and add a
 * step in `upgrade`: Playables certification requires older saves to keep loading.
 *
 * v1: stats { played, won }, round, rack
 * v2: + match points, match stats, round.turnsTaken / round.indicatorShownBy
 * v3: + coachSeen, so the rules card is only shown once
 * v4: + difficulty, the strength of the computer opponents
 */
export const SAVE_VERSION = 4;

export interface Stats {
  /** Hands played and won; `won` is the score sent to YouTube. */
  played: number;
  won: number;
  matchesPlayed: number;
  matchesWon: number;
}

export interface SaveData {
  v: number;
  stats: Stats;
  match: MatchState;
  /** The hand in progress, so a player can leave and come back. */
  round: RoundState | null;
  rack: Rack | null;
  /** The rules card has been read and closed. */
  coachSeen: boolean;
  /** How sharp the computer opponents are. */
  difficulty: Difficulty;
  /** The points a new match starts from. */
  matchStart: number;
  /** The colored okey: a red or black indicator makes the okey count double. */
  coloredOkey: boolean;
}

export const emptySave = (): SaveData => ({
  v: SAVE_VERSION,
  stats: { played: 0, won: 0, matchesPlayed: 0, matchesWon: 0 },
  match: newMatch(),
  round: null,
  rack: null,
  coachSeen: false,
  difficulty: 'normal',
  matchStart: START_POINTS,
  coloredOkey: false,
});

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

type Raw = Record<string, unknown>;

function upgrade(data: unknown): SaveData {
  let d = (isObject(data) ? data : {}) as Raw;
  if (d.v === 1) d = v1ToV2(d);
  if (d.v === 2) d = v2ToV3(d);
  if (d.v === 3) d = v3ToV4(d);

  const save = emptySave();
  const stats = (isObject(d.stats) ? d.stats : {}) as Raw;
  save.stats.played = count(stats.played);
  save.stats.won = Math.min(count(stats.won), save.stats.played);
  save.stats.matchesPlayed = count(stats.matchesPlayed);
  save.stats.matchesWon = Math.min(count(stats.matchesWon), save.stats.matchesPlayed);
  save.coachSeen = d.coachSeen === true;
  save.difficulty = isDifficulty(d.difficulty) ? d.difficulty : 'normal';
  save.matchStart = typeof d.matchStart === 'number' && d.matchStart > 0 ? d.matchStart : START_POINTS;
  save.coloredOkey = d.coloredOkey === true;
  if (d.v !== SAVE_VERSION) return save;

  if (looksLikeMatch(d.match)) {
    const m = d.match;
    save.match = { points: m.points, hands: m.hands, start: typeof m.start === 'number' ? m.start : START_POINTS };
  }
  if (looksLikeRound(d.round)) {
    save.round = d.round;
    save.rack = Array.isArray(d.rack) ? (d.rack as Rack) : null;
  }
  return save;
}

/** v1 had no match scoring and did not track turns or the indicator. */
function v1ToV2(d: Raw): Raw {
  const round = isObject(d.round) ? (d.round as Raw) : null;
  return {
    ...d,
    v: 2,
    match: newMatch(),
    // Unknown how many turns were played, so treat first turns as done: no gösterge this hand.
    round: round && { ...round, turnsTaken: new Array<number>(SEATS).fill(1), indicatorShownBy: null },
  };
}

/** v2 had no rules card. Players who already have a game do not need it again. */
function v2ToV3(d: Raw): Raw {
  return { ...d, v: 3, coachSeen: true };
}

/** v3 had no difficulty setting. */
function v3ToV4(d: Raw): Raw {
  return { ...d, v: 4, difficulty: 'normal' };
}

const isDifficulty = (x: unknown): x is Difficulty => x === 'easy' || x === 'normal' || x === 'hard';

const isObject = (x: unknown): x is object => typeof x === 'object' && x !== null;

const count = (x: unknown): number => (typeof x === 'number' && Number.isInteger(x) && x >= 0 ? x : 0);

const isSeatList = (x: unknown): x is number[] =>
  Array.isArray(x) && x.length === SEATS && x.every((n) => typeof n === 'number' && Number.isFinite(n));

function looksLikeMatch(x: unknown): x is MatchState {
  if (!isObject(x)) return false;
  const m = x as Partial<MatchState>;
  return isSeatList(m.points) && typeof m.hands === 'number' && m.hands >= 0;
}

function looksLikeRound(x: unknown): x is RoundState {
  if (!isObject(x)) return false;
  const r = x as Partial<RoundState>;
  if (!Array.isArray(r.pile) || !Array.isArray(r.hands) || !Array.isArray(r.discards)) return false;
  if (r.hands.length !== SEATS || r.discards.length !== SEATS || !r.indicator || !r.okey) return false;
  if (typeof r.turn !== 'number' || typeof r.phase !== 'string' || !isSeatList(r.turnsTaken)) return false;
  if (r.indicatorShownBy !== null && typeof r.indicatorShownBy !== 'number') return false;
  const tiles =
    r.pile.length +
    r.hands.reduce((n, h) => n + h.length, 0) +
    r.discards.reduce((n, d) => n + d.length, 0) +
    1 +
    (r.finishTile ? 1 : 0);
  return tiles === TILE_COUNT;
}
