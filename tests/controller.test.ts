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
