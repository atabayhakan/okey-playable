import { describe, expect, it } from 'vitest';
import { Controller, HUMAN } from '../src/app/controller';
import { emptySave, parseSave, serializeSave } from '../src/app/save';
import { Scheduler } from '../src/app/scheduler';
import { Sound } from '../src/app/sound';
import { dealRound } from '../src/core/game';
import type { Platform } from '../src/platform/playables';

const platform = (overrides: Partial<Platform> = {}): Platform => ({
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
  ...overrides,
});

/** A controller that never touches the network and never speaks. */
const makeController = (save = emptySave(), p = platform()) =>
  new Controller({ platform: p, scheduler: new Scheduler(), sound: new Sound(false) }, save, true);

describe('controller', () => {
  it('boots on a fresh save: a hand is dealt and the rules card is waiting', () => {
    const game = makeController();
    expect(game.round.hands[HUMAN]).toHaveLength(15);
    expect(game.round.pile).toHaveLength(48);
    expect(game.coachOpen).toBe(true);
    // A hand can already hold a set; the count must match the tiles.
    expect(game.meldedTileIds.size).toBe(game.melds.flat().length);
  });

  it('boots on a saved game in progress and keeps the hand', () => {
    const round = dealRound(11, 1);
    const save = { ...emptySave(), round, rack: null, coachSeen: true };
    const game = makeController(parseSave(serializeSave(save)));
    expect(game.round.seed).toBe(11);
    expect(game.round.hands[HUMAN]).toHaveLength(14);
    // Returning players have already read the rules.
    expect(game.coachOpen).toBe(false);
  });

  it('does not offer the rules card twice', () => {
    const game = makeController();
    game.closeCoach();
    expect(game.coachOpen).toBe(false);
    game.openCoach();
    expect(game.coachOpen).toBe(true);
  });

  it('keeps the hand value and the meld count in step with the hand', () => {
    const game = makeController();
    const before = game.handValue;
    expect(game.handValue).toBe(before);
    expect(game.meldedTileIds.size).toBe(game.melds.flat().length);
  });

  it('keeps the chosen difficulty in the save', () => {
    const game = makeController();
    expect(game.difficulty).toBe('normal');
    game.setDifficulty('hard');
    expect(game.difficulty).toBe('hard');
    const restored = makeController(parseSave(serializeSave({ ...emptySave(), difficulty: 'hard' })));
    expect(restored.difficulty).toBe('hard');
  });

  it('falls back to normal for a broken difficulty', () => {
    const restored = makeController(parseSave(JSON.stringify({ ...emptySave(), difficulty: 'impossible' })));
    expect(restored.difficulty).toBe('normal');
  });

  it('keeps the opponents’ pace in the save, and a quick pace waits less for a bot', () => {
    const waits = (pace: 'relaxed' | 'quick'): number => {
      const delays: number[] = [];
      const scheduler = new Scheduler();
      const after = scheduler.after.bind(scheduler);
      scheduler.after = (ms, fn) => {
        delays.push(ms);
        return after(ms, fn);
      };
      // The player starts with 15 tiles and throws one: the next move is a bot's.
      const round = dealRound(5, HUMAN);
      const game = new Controller(
        { platform: platform(), scheduler, sound: new Sound(false) },
        { ...emptySave(), round, rack: null, coachSeen: true, botPace: pace },
        false,
      );
      game.setBotPace(pace);
      delays.length = 0;
      game.humanDiscard(game.round.hands[HUMAN].at(-1)!.id);
      return delays.at(-1)!;
    };
    expect(waits('quick')).toBeLessThan(waits('relaxed'));
    const game = makeController();
    game.setBotPace('quick');
    expect(game.botPace).toBe('quick');
  });

  it('gives one free hint per hand, then asks for a rewarded ad', async () => {
    const ads: string[] = [];
    const game = makeController(emptySave(), platform({ requestRewardedAd: (id) => { ads.push(id); return Promise.resolve(true); } }));

    await game.requestHint();
    expect(game.hintTileId).not.toBeNull();
    expect(ads).toHaveLength(0);
    expect(game.hintCostsAd).toBe(true);

    // After the throw it is the player's turn again: now the hint costs an ad.
    game.humanDiscard(game.hintTileId!);
    game.round.turn = HUMAN;
    game.round.phase = 'discard';
    await game.requestHint();
    expect(ads).toEqual(['hint']);
    expect(game.hintTileId).not.toBeNull();
  });

  it('says so when the ad is not available', async () => {
    const game = makeController(emptySave(), platform({ requestRewardedAd: () => Promise.resolve(false) }));
    await game.requestHint();
    game.humanDiscard(game.hintTileId!);
    game.round.turn = HUMAN;
    game.round.phase = 'discard';
    await game.requestHint();
    expect(game.notice?.kind).toBe('noAd');
    expect(game.hintTileId).toBeNull();
  });

  it('keeps the optional rules in the save', () => {
    const game = makeController();
    game.setMatchStart(40);
    game.setColoredOkey(true);
    game.setSingleColor(true);
    expect(game.rules).toEqual({ coloredOkey: true, singleColor: true });
    const restored = makeController(
      parseSave(serializeSave({ ...emptySave(), matchStart: 40, coloredOkey: true, singleColor: true })),
    );
    expect(restored.matchStart).toBe(40);
    expect(restored.coloredOkey).toBe(true);
    expect(restored.singleColor).toBe(true);
  });
});

describe('statistics', () => {
  const t = (color: 'red' | 'yellow' | 'blue' | 'black', value: number, id: number) => ({ id, kind: 'number' as const, color, value });
  /** Runs of 4, 3, 3 and 4, plus a spare tile to throw: the player finishes by throwing it. */
  const winningHand = () => [
    t('red', 1, 9301), t('red', 2, 9302), t('red', 3, 9303), t('red', 4, 9304),
    t('blue', 5, 9305), t('blue', 6, 9306), t('blue', 7, 9307),
    t('black', 9, 9308), t('black', 10, 9309), t('black', 11, 9310),
    t('yellow', 3, 9311), t('yellow', 4, 9312), t('yellow', 5, 9313), t('yellow', 6, 9314),
    t('black', 13, 9315),
  ];

  /** A game in which the player holds a finished hand, having taken `turns` turns before this one. */
  const readyToFinish = (turns: number) => {
    const game = makeController();
    game.round = dealRound(42, HUMAN);
    // An okey that none of the tiles above can be mistaken for.
    game.round.okey = { color: 'yellow', value: 12 };
    game.round.hands[HUMAN] = winningHand();
    game.round.turnsTaken[HUMAN] = turns;
    return game;
  };

  it('counts a win, its streak and the turns it took', () => {
    const game = readyToFinish(5);
    game.humanFinish(9315);
    expect(game.round.winner).toBe(HUMAN);
    expect(game.stats).toMatchObject({ played: 1, won: 1, streak: 1, bestStreak: 1, fastestWin: 6, pairsWon: 0, okeyWon: 0, drawn: 0 });
  });

  it('keeps the fewest turns over several wins, and the best streak after a loss', () => {
    const game = readyToFinish(8);
    game.humanFinish(9315);
    game.round = readyToFinish(3).round;
    game.humanFinish(9315);
    expect(game.stats).toMatchObject({ won: 2, streak: 2, bestStreak: 2, fastestWin: 4 });
    // A bot wins the next hand: the streak ends, the best one stays.
    game.round.winner = 2;
    game['finishRound']();
    expect(game.stats).toMatchObject({ played: 3, won: 2, streak: 0, bestStreak: 2, fastestWin: 4 });
  });

  it('counts a drawn hand without breaking the streak', () => {
    const game = readyToFinish(1);
    game.humanFinish(9315);
    game.round.winner = null;
    game.round.winKind = null;
    game['finishRound']();
    expect(game.stats).toMatchObject({ played: 2, won: 1, streak: 1, drawn: 1 });
  });

  it('counts a win by throwing the okey, and a win with pairs', () => {
    const game = readyToFinish(2);
    // The spare tile is the okey itself: finishing by throwing it counts as an okey finish.
    game.round.hands[HUMAN][14] = t('yellow', 12, 9316);
    game.humanFinish(9316);
    expect(game.stats.okeyWon).toBe(1);

    const pairs = readyToFinish(2);
    pairs.round.hands[HUMAN] = [
      t('red', 1, 9401), t('red', 1, 9402), t('red', 5, 9403), t('red', 5, 9404),
      t('blue', 2, 9405), t('blue', 2, 9406), t('blue', 7, 9407), t('blue', 7, 9408),
      t('black', 9, 9409), t('black', 9, 9410), t('black', 11, 9411), t('black', 11, 9412),
      t('yellow', 4, 9413), t('yellow', 4, 9414), t('black', 13, 9415),
    ];
    pairs.humanFinish(9415);
    expect(pairs.round.winKind).toBe('pairs');
    expect(pairs.stats.pairsWon).toBe(1);
  });
});

describe('the first-hand guide', () => {
  /** A new player: the guide starts at its first step, on a hand the player opens. */
  const newPlayer = (today = 20261030) => {
    const game = new Controller(
      { platform: platform(), scheduler: new Scheduler(), sound: new Sound(false), today: () => today },
      emptySave(),
      true,
    );
    game.round = dealRound(5, HUMAN);
    return game;
  };

  it('starts for a new player and not for one who has read the rules before', () => {
    expect(newPlayer().tour).toBe(0);
    expect(makeController({ ...emptySave(), tutorial: 3 }).tour).toBeNull();
    // A v8 save of a player who closed the rules card has no guide to show.
    const { tutorial: _t, ...v8 } = { ...emptySave(), v: 8, coachSeen: true };
    expect(makeController(parseSave(JSON.stringify(v8))).tour).toBeNull();
    const { tutorial: _u, ...fresh } = { ...emptySave(), v: 8, coachSeen: false };
    expect(makeController(parseSave(JSON.stringify(fresh))).tour).toBe(0);
  });

  it('moves on as the player throws, draws and throws again, then ends', () => {
    const game = newPlayer();
    game.humanDiscard(game.round.hands[HUMAN][0].id);
    expect(game.tour).toBe(1);
    // A bot's turns in between change nothing; the player's draw is the next step.
    game.round.turn = HUMAN;
    game.round.phase = 'draw';
    game.humanDraw();
    expect(game.tour).toBe(2);
    game.humanDiscard(game.round.hands[HUMAN][0].id);
    expect(game.tour).toBeNull();
  });

  it('takes a tile from the left as well as a draw from the pile', () => {
    const game = newPlayer();
    game.humanDiscard(game.round.hands[HUMAN][0].id);
    game.round.turn = HUMAN;
    game.round.phase = 'draw';
    game.round.discards[(HUMAN + 3) % 4].push(game.round.hands[1][0]);
    game.humanTakeDiscard();
    expect(game.tour).toBe(2);
  });

  it('keeps its place in the save', () => {
    const saves: string[] = [];
    const game = new Controller(
      { platform: { ...platform(), saveData: (raw) => (saves.push(raw), Promise.resolve()) }, scheduler: new Scheduler(), sound: new Sound(false) },
      emptySave(),
      true,
    );
    game.round = dealRound(5, HUMAN);
    game.humanDiscard(game.round.hands[HUMAN][0].id);
    void game.persist();
    expect(makeController(parseSave(saves.at(-1)!)).tour).toBe(1);
  });

  it('ends when the hand ends, however far it had got', () => {
    const game = newPlayer();
    game.round.phase = 'roundOver';
    game.round.winner = 2;
    game['finishRound']();
    expect(game.tour).toBeNull();
    // ...and a guide that ended does not come back with the next hand.
    expect(makeController(parseSave(serializeSave({ ...emptySave(), tutorial: 3 }))).tour).toBeNull();
  });

  it('does not run in the daily deal, and the daily deal does not advance it', () => {
    const game = newPlayer();
    game.round = dealRound(5, HUMAN);
    game.startDaily();
    expect(game.dailyActive).toBe(true);
    expect(game.tour).toBeNull();
    game.humanDiscard(game.round.hands[HUMAN][0].id);
    game.round.phase = 'roundOver';
    game.round.winner = 2;
    game['finishRound']();
    // Back in the match hand the guide is where it was.
    void game.nextHand();
    return Promise.resolve().then(() => {
      expect(game.dailyActive).toBe(false);
      expect(game.tour).toBe(0);
    });
  });
});

describe('motion', () => {
  it('tells the view where a drawn tile came from', () => {
    const game = makeController();
    game.pendingMotions = [];
    game.round.turn = HUMAN;
    game.round.phase = 'draw';
    game.humanDraw();
    // A draw can also complete a meld, so only the first motion is about the tile.
    expect(game.pendingMotions[0]).toEqual({ kind: 'draw', tileId: expect.any(Number), seat: HUMAN });
  });

  it('tells the view where a taken tile came from', () => {
    const game = makeController();
    game.pendingMotions = [];
    game.round.turn = HUMAN;
    game.round.phase = 'draw';
    // A tile on the pile of the player to the right.
    game.round.discards[(HUMAN + 3) % 4].push(game.round.hands[1][0]);
    game.humanTakeDiscard();
    // Like a draw, a taken tile can also complete a meld, so only the first motion is about the tile.
    expect(game.pendingMotions[0]).toEqual({ kind: 'take', tileId: expect.any(Number), seat: HUMAN, from: (HUMAN + 3) % 4 });
  });

  it('tells the view where a thrown tile went', () => {
    const game = makeController();
    game.pendingMotions = [];
    game.round.turn = HUMAN;
    game.round.phase = 'discard';
    const tileId = game.round.hands[HUMAN][0].id;
    game.humanDiscard(tileId);
    expect(game.pendingMotions).toEqual([{ kind: 'throw', tileId, seat: HUMAN, to: HUMAN }]);
  });

  it('shows a meld when a set or a run appears', () => {
    const game = makeController();
    // A fixed deal, so the leftovers and the okey do not change between runs.
    game.round = dealRound(42, 0);
    const t = (color: 'red' | 'yellow' | 'blue' | 'black', value: number, id: number) => ({
      id,
      kind: 'number' as const,
      color,
      value,
    });
    // First a hand with no meld at all, so the count has to go up afterwards.
    game.round.hands[HUMAN] = [
      t('red', 1, 9201), t('red', 4, 9202), t('red', 7, 9203), t('red', 10, 9204),
      t('blue', 2, 9205), t('blue', 5, 9206), t('blue', 8, 9207), t('blue', 11, 9208),
      t('black', 3, 9209), t('black', 6, 9210), t('black', 9, 9211), t('black', 12, 9212),
      t('yellow', 1, 9213), t('yellow', 14, 9214),
    ];
    game.sortMelds();
    game.pendingMotions = [];

    game.round.hands[HUMAN] = [
      t('red', 3, 9101),
      t('yellow', 3, 9102),
      t('blue', 3, 9103),
      ...game.round.hands[HUMAN].filter((x) => x.id < 9000).slice(0, 11),
    ];
    game.sortMelds();
    const meld = game.pendingMotions.find((m) => m.kind === 'meld');
    expect(meld).toBeDefined();
    expect(meld && meld.kind === 'meld' ? meld.tileIds : []).toContain(9101);
  });
});
