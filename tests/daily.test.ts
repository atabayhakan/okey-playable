import { describe, expect, it } from 'vitest';
import { Controller, HUMAN } from '../src/app/controller';
import { emptySave, parseSave, serializeSave, type SaveData } from '../src/app/save';
import { Scheduler } from '../src/app/scheduler';
import { Sound } from '../src/app/sound';
import { dailySeed, dayNumber, previousDay } from '../src/core/daily';
import { dealRound } from '../src/core/game';
import type { Platform } from '../src/platform/playables';

const platform = (scores: number[] = []): Platform => ({
  inPlayables: false,
  firstFrameReady: () => undefined,
  gameReady: () => undefined,
  loadData: () => Promise.resolve(''),
  saveData: () => Promise.resolve(),
  getLanguage: () => Promise.resolve('en'),
  isAudioEnabled: () => false,
  onAudioEnabledChange: () => () => undefined,
  onPause: () => () => undefined,
  onResume: () => () => undefined,
  sendScore: (n) => {
    scores.push(n);
    return Promise.resolve();
  },
  requestInterstitialAd: () => Promise.resolve(),
  requestRewardedAd: () => Promise.resolve(true),
  logError: () => undefined,
  logWarning: () => undefined,
});

const make = (day: number, save: SaveData = { ...emptySave(), coachSeen: true }, scores: number[] = []) =>
  new Controller({ platform: platform(scores), scheduler: new Scheduler(), sound: new Sound(false), today: () => day }, save, true);

const t = (color: 'red' | 'yellow' | 'blue' | 'black', value: number, id: number) => ({ id, kind: 'number' as const, color, value });
/** Runs of 4, 3, 3 and 4, and a spare tile (id 9315) to throw: the player finishes with it. */
const winningHand = () => [
  t('red', 1, 9301), t('red', 2, 9302), t('red', 3, 9303), t('red', 4, 9304),
  t('blue', 5, 9305), t('blue', 6, 9306), t('blue', 7, 9307),
  t('black', 9, 9308), t('black', 10, 9309), t('black', 11, 9310),
  t('yellow', 3, 9311), t('yellow', 4, 9312), t('yellow', 5, 9313), t('yellow', 6, 9314),
  t('black', 13, 9315),
];
/** Makes the daily deal on the table a hand the player wins by throwing tile 9315. */
const rigWin = (game: Controller): void => {
  game.round.okey = { color: 'yellow', value: 12 };
  game.round.hands[HUMAN] = winningHand();
};

describe('the day', () => {
  it('numbers a day as YYYYMMDD in the local calendar', () => {
    expect(dayNumber(new Date(2026, 9, 30, 23, 59))).toBe(20261030);
    expect(dayNumber(new Date(2026, 0, 1, 0, 0))).toBe(20260101);
  });

  it('knows the day before, over month and year ends and leap days', () => {
    expect(previousDay(20261030)).toBe(20261029);
    expect(previousDay(20260301)).toBe(20260228);
    expect(previousDay(20240301)).toBe(20240229);
    expect(previousDay(20260101)).toBe(20251231);
  });

  it('deals the same hand for the same day, and another one for the next day', () => {
    expect(dailySeed(20261030)).toBe(dailySeed(20261030));
    const days = Array.from({ length: 60 }, (_, i) => dailySeed(20261001 + i));
    expect(new Set(days).size).toBe(days.length);
    expect(days.every((s) => Number.isInteger(s) && s > 0)).toBe(true);
  });
});

describe('the daily deal', () => {
  it('deals today’s hand: the same tiles and bots every time, the player to move', () => {
    const a = make(20261030);
    const b = make(20261030);
    a.startDaily();
    b.startDaily();
    expect(a.dailyActive).toBe(true);
    expect(a.round.seed).toBe(dailySeed(20261030));
    expect(a.round.hands[HUMAN].map((x) => x.id)).toEqual(b.round.hands[HUMAN].map((x) => x.id));
    expect(a.round.turn).toBe(HUMAN);
    const next = make(20261031);
    next.startDaily();
    expect(next.round.hands[HUMAN].map((x) => x.id)).not.toEqual(a.round.hands[HUMAN].map((x) => x.id));
  });

  it('sets the match hand aside and brings it back, untouched', () => {
    const game = make(20261030);
    const before = game.round.seed;
    const points = [...game.match.points];
    game.startDaily();
    expect(game.round.seed).not.toBe(before);
    rigWin(game);
    game.humanFinish(9315);
    expect(game.round.phase).toBe('roundOver');
    void game.nextHand();
    return Promise.resolve().then(() => {
      expect(game.dailyActive).toBe(false);
      expect(game.round.seed).toBe(before);
      expect(game.match.points).toEqual(points);
      expect(game.match.hands).toBe(0);
    });
  });

  it('keeps the result out of the match numbers, and counts it as a daily win', () => {
    const scores: number[] = [];
    const game = make(20261030, { ...emptySave(), coachSeen: true, stats: { ...emptySave().stats, played: 4, won: 2 } }, scores);
    game.startDaily();
    rigWin(game);
    game.humanFinish(9315);
    expect(game.stats).toMatchObject({ played: 4, won: 2 });
    expect(game.daily).toEqual({ lastDate: 20261030, lastWon: true, played: 1, won: 1, streak: 1, best: 1 });
    // The score sent to YouTube is every hand won, the daily ones included.
    expect(scores.at(-1)).toBe(3);
  });

  it('plays once a day: it cannot be started again after it was played', () => {
    const game = make(20261030);
    game.startDaily();
    rigWin(game);
    game.humanFinish(9315);
    return game.nextHand().then(() => {
      expect(game.dailyDoneToday).toBe(true);
      const seed = game.round.seed;
      game.startDaily();
      expect(game.dailyActive).toBe(false);
      expect(game.round.seed).toBe(seed);
    });
  });

  it('counts days in a row, and a missed day starts the run again', () => {
    const run = (days: number[]) => {
      let save: SaveData = { ...emptySave(), coachSeen: true };
      let game = make(days[0], save);
      for (const day of days) {
        game = make(day, parseSave(serializeSave(save)));
        game.startDaily();
        rigWin(game);
        game.humanFinish(9315);
        save = { ...save, daily: game.daily };
      }
      return game.daily;
    };
    expect(run([20260228, 20260301, 20260302])).toMatchObject({ streak: 3, best: 3, won: 3 });
    expect(run([20260228, 20260302])).toMatchObject({ streak: 1, best: 1, won: 2 });
  });

  it('ends the run on a deal that was not won, and keeps the best', () => {
    let save: SaveData = { ...emptySave(), coachSeen: true };
    for (const day of [20260301, 20260302]) {
      const game = make(day, parseSave(serializeSave(save)));
      game.startDaily();
      rigWin(game);
      game.humanFinish(9315);
      save = { ...save, daily: game.daily };
    }
    const game = make(20260303, parseSave(serializeSave(save)));
    game.startDaily();
    // A bot finishes first.
    game.round.phase = 'roundOver';
    game.round.winner = 2;
    game['finishRound']();
    expect(game.daily).toMatchObject({ lastDate: 20260303, lastWon: false, streak: 0, best: 2, played: 3, won: 2 });
  });

  it('is resumed after a restart on the same day, with the match hand still set aside', () => {
    const saves: string[] = [];
    const game = new Controller(
      {
        platform: { ...platform(), saveData: (raw) => (saves.push(raw), Promise.resolve()) },
        scheduler: new Scheduler(),
        sound: new Sound(false),
        today: () => 20261030,
      },
      { ...emptySave(), coachSeen: true },
      true,
    );
    const matchSeed = game.round.seed;
    game.startDaily();
    const dailyHand = game.round.hands[HUMAN].map((x) => x.id);
    const restored = make(20261030, parseSave(saves.at(-1)!));
    expect(restored.dailyActive).toBe(true);
    expect(restored.round.hands[HUMAN].map((x) => x.id)).toEqual(dailyHand);
    // Finishing it from there still gives the match hand back.
    restored.round.phase = 'roundOver';
    restored.round.winner = 1;
    restored['finishRound']();
    return restored.nextHand().then(() => {
      expect(restored.dailyActive).toBe(false);
      expect(restored.round.seed).toBe(matchSeed);
    });
  });

  it('gives the match hand back when the day changes under a daily deal', () => {
    const saves: string[] = [];
    const game = new Controller(
      {
        platform: { ...platform(), saveData: (raw) => (saves.push(raw), Promise.resolve()) },
        scheduler: new Scheduler(),
        sound: new Sound(false),
        today: () => 20261030,
      },
      { ...emptySave(), coachSeen: true },
      true,
    );
    const matchSeed = game.round.seed;
    game.startDaily();
    // The player comes back the next day: yesterday's deal is over.
    const restored = make(20261031, parseSave(saves.at(-1)!));
    expect(restored.dailyActive).toBe(false);
    expect(restored.round.seed).toBe(matchSeed);
    // It was not played, so it was not counted.
    expect(restored.daily.played).toBe(0);
  });

  it('is played against opponents of one strength, and by the plain rules', () => {
    const game = make(20261030, { ...emptySave(), coachSeen: true, difficulty: 'hard', coloredOkey: true, singleColor: true });
    expect(game.rules).toEqual({ coloredOkey: true, singleColor: true });
    game.startDaily();
    expect(game.rules).toEqual({ coloredOkey: false, singleColor: false });
    // The table setting stays what the player chose.
    expect(game.difficulty).toBe('hard');
  });

  it('does not throw the match away while the daily deal is on the table', () => {
    const game = make(20261030);
    game.round = dealRound(1, HUMAN);
    game.startDaily();
    const seed = game.round.seed;
    game.newMatch();
    expect(game.round.seed).toBe(seed);
    expect(game.dailyActive).toBe(true);
  });
});

describe('the daily deal in the save', () => {
  it('upgrades a v7 save, which had no daily deal', () => {
    const { daily: _d, dailyDate: _dd, parked: _p, ...rest } = emptySave();
    const save = parseSave(JSON.stringify({ ...rest, v: 7 }));
    expect(save.daily).toEqual(emptySave().daily);
    expect(save.dailyDate).toBeNull();
    expect(save.parked).toBeNull();
  });

  it('keeps the daily results and the set-aside hand, and distrusts contradicting numbers', () => {
    const parked = { round: dealRound(5, 1), rack: null };
    const save = parseSave(
      serializeSave({ ...emptySave(), daily: { lastDate: 20261030, lastWon: true, played: 3, won: 2, streak: 2, best: 2 }, dailyDate: 20261030, parked }),
    );
    expect(save.daily).toEqual({ lastDate: 20261030, lastWon: true, played: 3, won: 2, streak: 2, best: 2 });
    expect(save.dailyDate).toBe(20261030);
    expect(save.parked?.round.seed).toBe(5);

    const odd = parseSave(JSON.stringify({ ...emptySave(), daily: { lastDate: 0, lastWon: true, played: 1, won: 5, streak: 9, best: 0 }, parked: { round: { pile: [] } } }));
    expect(odd.daily).toEqual({ lastDate: 0, lastWon: false, played: 1, won: 1, streak: 1, best: 1 });
    expect(odd.parked).toBeNull();
  });
});
