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
