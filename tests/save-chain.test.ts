import { describe, expect, it } from 'vitest';
import { Controller, HUMAN } from '../src/app/controller';
import { emptySave, parseSave, SAVE_VERSION, serializeSave, TUTORIAL_DONE, type SaveData } from '../src/app/save';
import { Scheduler } from '../src/app/scheduler';
import { Sound } from '../src/app/sound';
import { dealRound } from '../src/core/game';
import type { Platform } from '../src/platform/playables';

/**
 * Playables certification: a save written by any earlier version must keep loading. Each version is made
 * from a full current save by taking out what that version did not have yet, so that the chain from every
 * version to the current one is run, not only the last step.
 */

const platform: Platform = {
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
  sendScore: () => Promise.resolve(),
  requestInterstitialAd: () => Promise.resolve(),
  requestRewardedAd: () => Promise.resolve(true),
  logError: () => undefined,
  logWarning: () => undefined,
};

/** A player well into the game: every setting changed from its default, a hand on the table. */
const full = (): SaveData => ({
  ...emptySave(),
  stats: { played: 12, won: 5, matchesPlayed: 3, matchesWon: 1, streak: 2, bestStreak: 3, pairsWon: 1, okeyWon: 2, fastestWin: 7, drawn: 1 },
  match: { points: [14, 9, 17, 20], hands: 4, start: 40 },
  round: dealRound(21, 1),
  rack: null,
  coachSeen: true,
  difficulty: 'hard',
  matchStart: 40,
  coloredOkey: true,
  singleColor: true,
  botPace: 'quick',
  daily: { lastDate: 20261029, lastWon: true, played: 4, won: 3, streak: 2, best: 2 },
  tutorial: TUTORIAL_DONE,
});

/** What the save looked like in `version`: the later fields taken out. */
function asVersion(version: number): Record<string, unknown> {
  const raw = JSON.parse(serializeSave(full())) as Record<string, any>;
  raw.v = version;
  const drop = (...keys: string[]) => keys.forEach((k) => delete raw[k]);
  if (version < 9) drop('tutorial');
  if (version < 8) drop('daily', 'dailyDate', 'parked');
  if (version < 7) for (const k of ['streak', 'bestStreak', 'pairsWon', 'okeyWon', 'fastestWin', 'drawn']) delete raw.stats[k];
  if (version < 6) drop('botPace');
  if (version < 5) drop('matchStart', 'coloredOkey', 'singleColor');
  if (version < 4) drop('difficulty');
  if (version < 3) drop('coachSeen');
  if (version < 2) {
    drop('match');
    delete raw.stats.matchesPlayed;
    delete raw.stats.matchesWon;
    delete raw.round.turnsTaken;
    delete raw.round.indicatorShownBy;
  }
  return raw;
}

const boot = (save: SaveData) => new Controller({ platform, scheduler: new Scheduler(), sound: new Sound(false), today: () => 20261030 }, save, true);

describe('a save from every earlier version', () => {
  const current = full();

  for (let version = 1; version <= SAVE_VERSION; version++) {
    it(`v${version} loads as the current version and the game starts on it`, () => {
      const save = parseSave(JSON.stringify(asVersion(version)));
      expect(save.v).toBe(SAVE_VERSION);

      // What every version had: the hand counts and the hand in progress.
      expect(save.stats.played).toBe(12);
      expect(save.stats.won).toBe(5);
      expect(save.round?.seed).toBe(21);
      expect(save.round?.hands).toEqual(current.round?.hands);

      // What a version had is kept; what it did not have is the default.
      const had = (since: number) => version >= since;
      expect(save.match.points).toEqual(had(2) ? [14, 9, 17, 20] : emptySave().match.points);
      expect(save.stats.matchesPlayed).toBe(had(2) ? 3 : 0);
      expect(save.coachSeen).toBe(true);
      expect(save.difficulty).toBe(had(4) ? 'hard' : 'normal');
      expect(save.matchStart).toBe(had(5) ? 40 : emptySave().matchStart);
      expect(save.coloredOkey).toBe(had(5));
      expect(save.singleColor).toBe(had(5));
      expect(save.botPace).toBe(had(6) ? 'quick' : 'relaxed');
      expect(save.stats.bestStreak).toBe(had(7) ? 3 : 0);
      expect(save.stats.fastestWin).toBe(had(7) ? 7 : 0);
      expect(save.daily).toEqual(had(8) ? current.daily : emptySave().daily);
      expect(save.dailyDate).toBeNull();
      expect(save.parked).toBeNull();
      // Everybody here had read the rules, so nobody is walked through the first hand.
      expect(save.tutorial).toBe(TUTORIAL_DONE);

      // The game starts on it: the same hand on the table, nothing thrown.
      const game = boot(save);
      expect(game.round.seed).toBe(21);
      expect(game.round.hands[HUMAN]).toHaveLength(current.round!.hands[HUMAN].length);
      expect(game.tour).toBeNull();

      // And what it writes back is a save of today's version that reads the same.
      expect(parseSave(serializeSave(save))).toEqual(save);
    });
  }

  it('v1 had no turn counts: nobody may show the indicator in that hand, and nobody has taken a turn yet', () => {
    const save = parseSave(JSON.stringify(asVersion(1)));
    expect(save.round?.turnsTaken).toEqual([1, 1, 1, 1]);
    expect(save.round?.indicatorShownBy).toBeNull();
  });

  it('a player who had not closed the rules card is still walked through the first hand', () => {
    for (let version = 3; version < SAVE_VERSION; version++) {
      const raw = asVersion(version);
      raw.coachSeen = false;
      expect(parseSave(JSON.stringify(raw)).tutorial).toBe(0);
    }
  });

  it('a save with a hand that does not add up is dropped but keeps what the player earned', () => {
    const raw = asVersion(SAVE_VERSION) as Record<string, any>;
    raw.round.pile = raw.round.pile.slice(1);
    const save = parseSave(JSON.stringify(raw));
    expect(save.round).toBeNull();
    expect(save.stats.won).toBe(5);
    expect(save.daily.won).toBe(3);
    // The game still starts, on a new hand.
    expect(boot(save).round.hands[HUMAN].length).toBeGreaterThan(0);
  });

  it('a save from a version that does not exist yet is read as far as it can be', () => {
    const raw = { ...asVersion(SAVE_VERSION), v: SAVE_VERSION + 1 };
    const save = parseSave(JSON.stringify(raw));
    // Not trusted for the hand (the shape may have changed), but the numbers are the player's.
    expect(save.stats.played).toBe(12);
    expect(save.difficulty).toBe('hard');
    expect(save.round).toBeNull();
  });
});
