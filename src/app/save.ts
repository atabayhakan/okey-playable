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
 * v5: + matchStart, coloredOkey, singleColor, the optional rules
 * v6: + botPace, how long the opponents take over a move
 * v7: + stats streak, bestStreak, pairsWon, okeyWon, fastestWin, drawn (the statistics screen)
 * v8: + daily, dailyDate, parked: the daily deal and the match hand set aside while it is played
 */
export const SAVE_VERSION = 8;

/** How long the opponents take over a move. */
export type BotPace = 'relaxed' | 'quick';

export interface Stats {
  /** Hands played and won; `won` is the score sent to YouTube. */
  played: number;
  won: number;
  matchesPlayed: number;
  matchesWon: number;
  /** Hands won in a row right now, and the longest run so far. */
  streak: number;
  bestStreak: number;
  /** Hands the player won with seven pairs, and by throwing the okey. */
  pairsWon: number;
  okeyWon: number;
  /** The fewest turns the player took in a hand they won; 0 until one is won. */
  fastestWin: number;
  /** Hands that ended with the pile empty and no winner. */
  drawn: number;
}

export const emptyStats = (): Stats => ({
  played: 0,
  won: 0,
  matchesPlayed: 0,
  matchesWon: 0,
  streak: 0,
  bestStreak: 0,
  pairsWon: 0,
  okeyWon: 0,
  fastestWin: 0,
  drawn: 0,
});

/** The daily deal: one hand a day, the same for everyone that day. */
export interface DailyStats {
  /** The day (YYYYMMDD) of the last daily deal that was played to the end; 0 for none. */
  lastDate: number;
  /** Whether the player won that one. */
  lastWon: boolean;
  played: number;
  won: number;
  /** Consecutive days won, and the longest run. */
  streak: number;
  best: number;
}

export const emptyDaily = (): DailyStats => ({ lastDate: 0, lastWon: false, played: 0, won: 0, streak: 0, best: 0 });

/** The match hand that is set aside while the daily deal is played. */
export interface ParkedHand {
  round: RoundState;
  rack: Rack | null;
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
  /** A hand finished with all its tiles in one colour costs the others double. */
  singleColor: boolean;
  /** How long the opponents take over a move. */
  botPace: BotPace;
  daily: DailyStats;
  /** The day of the daily deal that `round` is; null when `round` belongs to the match. */
  dailyDate: number | null;
  /** The match hand set aside while `round` is a daily deal. */
  parked: ParkedHand | null;
}

export const emptySave = (): SaveData => ({
  v: SAVE_VERSION,
  stats: emptyStats(),
  match: newMatch(),
  round: null,
  rack: null,
  coachSeen: false,
  difficulty: 'normal',
  matchStart: START_POINTS,
  coloredOkey: false,
  singleColor: false,
  botPace: 'relaxed',
  daily: emptyDaily(),
  dailyDate: null,
  parked: null,
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
  if (d.v === 4) d = v4ToV5(d);
  if (d.v === 5) d = v5ToV6(d);
  if (d.v === 6) d = v6ToV7(d);
  if (d.v === 7) d = v7ToV8(d);

  const save = emptySave();
  const stats = (isObject(d.stats) ? d.stats : {}) as Raw;
  save.stats.played = count(stats.played);
  save.stats.won = Math.min(count(stats.won), save.stats.played);
  save.stats.matchesPlayed = count(stats.matchesPlayed);
  save.stats.matchesWon = Math.min(count(stats.matchesWon), save.stats.matchesPlayed);
  // The new counters of v7 are not known for hands played before: they start from zero.
  save.stats.streak = Math.min(count(stats.streak), save.stats.won);
  save.stats.bestStreak = Math.max(Math.min(count(stats.bestStreak), save.stats.won), save.stats.streak);
  save.stats.pairsWon = Math.min(count(stats.pairsWon), save.stats.won);
  save.stats.okeyWon = Math.min(count(stats.okeyWon), save.stats.won);
  save.stats.fastestWin = save.stats.won > 0 ? count(stats.fastestWin) : 0;
  save.stats.drawn = Math.min(count(stats.drawn), save.stats.played - save.stats.won);
  save.coachSeen = d.coachSeen === true;
  save.difficulty = isDifficulty(d.difficulty) ? d.difficulty : 'normal';
  save.matchStart = typeof d.matchStart === 'number' && d.matchStart > 0 ? d.matchStart : START_POINTS;
  save.coloredOkey = d.coloredOkey === true;
  save.singleColor = d.singleColor === true;
  save.botPace = d.botPace === 'quick' ? 'quick' : 'relaxed';
  if (d.v !== SAVE_VERSION) return save;

  const daily = (isObject(d.daily) ? d.daily : {}) as Raw;
  save.daily.played = count(daily.played);
  save.daily.won = Math.min(count(daily.won), save.daily.played);
  save.daily.streak = Math.min(count(daily.streak), save.daily.won);
  save.daily.best = Math.max(Math.min(count(daily.best), save.daily.won), save.daily.streak);
  save.daily.lastDate = count(daily.lastDate);
  save.daily.lastWon = save.daily.lastDate > 0 && daily.lastWon === true;
  save.dailyDate = count(d.dailyDate) > 0 ? count(d.dailyDate) : null;
  if (isObject(d.parked) && looksLikeRound((d.parked as Raw).round)) {
    const p = d.parked as Raw;
    save.parked = { round: p.round as RoundState, rack: Array.isArray(p.rack) ? (p.rack as Rack) : null };
  }

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

/** v4 had no optional rules beyond the difficulty. */
function v4ToV5(d: Raw): Raw {
  return { ...d, v: 5, matchStart: START_POINTS, coloredOkey: false, singleColor: false };
}

/** v5 had one pace for the opponents. */
function v5ToV6(d: Raw): Raw {
  return { ...d, v: 6, botPace: 'relaxed' };
}

/** v6 had no streaks or finish counters; they start from zero (see `upgrade`). */
function v6ToV7(d: Raw): Raw {
  return { ...d, v: 7 };
}

/** v7 had no daily deal. */
function v7ToV8(d: Raw): Raw {
  return { ...d, v: 8 };
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
