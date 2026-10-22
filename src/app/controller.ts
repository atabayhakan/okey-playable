import { botPlanDiscard, botWantsDiscard, type Difficulty } from '../core/bot';
import { meldsInHand } from '../core/hand';
import {
  canDraw,
  canShowIndicator,
  canTakeDiscard,
  dealRound,
  declareWin,
  discardTile,
  drawFromPile,
  nextSeat,
  showIndicator,
  takeDiscard,
  type RoundState,
} from '../core/game';
import { randomSeed } from '../core/rng';
import { isMatchOver, matchLeaders, newMatch, scoreRound, handValue, START_POINTS, type MatchState, type RuleOptions } from '../core/scoring';
import type { Tile } from '../core/tile';
import type { Platform } from '../platform/playables';
import { arrangeMelds, arrangePairs, arrangeRuns, compactRack, moveTile, placeTile, reconcileRack, removeTile, type Rack } from './rack';
import { SAVE_VERSION, serializeSave, type SaveData, type Stats } from './save';
import type { Scheduler } from './scheduler';
import type { Sound } from './sound';

export const HUMAN = 0;

/**
 * How long the opponents think before they move. An easy game gives the
 * player time to think, a hard one keeps the pressure on.
 */
const BOT_DELAY: Record<Difficulty, { draw: number; discard: number }> = {
  easy: { draw: 900, discard: 1100 },
  normal: { draw: 320, discard: 420 },
  hard: { draw: 180, discard: 240 },
};
const NOTICE_MS = 2200;
/** How long the dealt tiles take to land on the rack. */
const DEAL_ANIM_MS = 900;
/** How long a thrown tile takes to settle on the pile. */
const DISCARD_ANIM_MS = 260;
/** Interstitial ads only at a natural break: before every Nth new hand. */
const HANDS_PER_INTERSTITIAL = 2;

export type Notice = { kind: 'invalidFinish' } | { kind: 'indicatorShown'; seat: number } | { kind: 'noAd' };

interface Deps {
  platform: Platform;
  scheduler: Scheduler;
  sound: Sound;
}

function freshRound(starter: number): { round: RoundState; rack: Rack } {
  const round = dealRound(randomSeed(), starter);
  // The hand starts grouped by its complete sets and runs, then by colour: the
  // player sees what they have from the first second.
  return { round, rack: arrangeMelds(round.hands[HUMAN], round.okey) };
}

/** Owns the game state, runs the bots, keeps score and saves progress. The view only reads and calls in. */
export class Controller {
  round: RoundState;
  rack: Rack;
  match: MatchState;
  stats: Stats;
  /** What each seat lost in the hand that just ended; null until a hand ends this session. */
  lastPenalties: number[] | null = null;
  selected: number | null = null;
  lastDrawn: number | null = null;
  notice: Notice | null = null;
  /** Set while the hand is being dealt out, so the tiles can animate in. */
  dealing = false;
  /** Tile that was just thrown, so the discard can animate. */
  discardingId: number | null = null;
  /** The one-time rules card is open. */
  coachOpen = false;
  /** The tile the hint points at, if the hint is showing. */
  hintTileId: number | null = null;
  /** The free hint of this hand is spent; the next one costs a rewarded ad. */
  private hintUsedThisHand = false;
  /** How sharp the computer opponents are. */
  difficulty: Difficulty = 'normal';
  /** The points a new match starts from. */
  matchStart: number = START_POINTS;
  /** The colored okey: a red or black indicator makes the okey count double. */
  coloredOkey = false;
  /** A hand finished with all its tiles in one colour costs the others double. */
  singleColor = false;

  private readonly listeners = new Set<() => void>();
  private cancelBot: (() => void) | null = null;
  private cancelNotice: (() => void) | null = null;
  private advancing = false;
  private handsSinceAd = 0;
  /** A hand dealt at startup is not in the save yet. */
  private dealtOnLoad = false;
  /** The rules card has been closed for good. */
  private coachSeen: boolean;
  /** Complete sets and runs the player had a moment ago, to spot a new one. */
  private lastMeldCount = 0;

  /** `canSave` is false when loading failed: saving then would wipe the player's progress. */
  constructor(
    private readonly deps: Deps,
    save: SaveData,
    private readonly canSave: boolean,
  ) {
    this.stats = { ...save.stats };
    this.match = { points: [...save.match.points], hands: save.match.hands };
    this.coachSeen = save.coachSeen;
    this.difficulty = save.difficulty;
    this.matchStart = save.matchStart;
    this.coloredOkey = save.coloredOkey;
    this.singleColor = save.singleColor;
    // A new player gets the rules card over their first hand.
    this.coachOpen = !save.coachSeen;
    if (save.round && save.round.phase !== 'roundOver') {
      this.round = save.round;
      this.rack = reconcileRack(save.rack ?? [], save.round.hands[HUMAN]);
    } else {
      // The player left on the result screen: that hand is already scored, so move on.
      if (isMatchOver(this.match)) this.match = newMatch(this.matchStart);
      ({ round: this.round, rack: this.rack } = freshRound(save.round ? nextSeat(save.round.starter) : HUMAN));
      this.dealtOnLoad = true;
    }
    // Counted from here on: the hand may already hold a complete set.
    this.lastMeldCount = this.melds.length;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Call once the game is interactive (after gameReady). */
  begin(): void {
    // Save it now, or reloading would deal a different hand.
    if (this.dealtOnLoad) void this.persist();
    this.scheduleBot();
  }

  get humanMustDiscard(): boolean {
    return this.round.turn === HUMAN && this.round.phase === 'discard';
  }

  get matchOver(): boolean {
    return isMatchOver(this.match);
  }

  /** The seed the current hand was dealt from: the deal can be replayed. */
  get seed(): number {
    return this.round.seed;
  }

  /** What the player's hand is worth right now. */
  get handValue(): number {
    return handValue(this.round.hands[HUMAN], this.round.okey);
  }

  /** The complete sets and runs the player already holds. */
  get melds(): Tile[][] {
    return meldsInHand(this.round.hands[HUMAN], this.round.okey);
  }

  /**
   * Points at the tile the player should throw: the one that costs the hand
   * the least. If the hand is one tile from winning, that tile is the answer.
   *
   * The first hint of a hand is free. After that the player watches a rewarded
   * ad for another one: the game never blocks, it only asks for the reward.
   */
  async requestHint(): Promise<void> {
    if (this.round.turn !== HUMAN || this.round.phase !== 'discard') return;
    if (this.hintTileId !== null) return;
    if (this.hintUsedThisHand) {
      const granted = await this.deps.platform.requestRewardedAd('hint').catch(() => false);
      if (!granted) {
        this.showNotice({ kind: 'noAd' });
        return;
      }
    }
    this.hintUsedThisHand = true;
    this.hintTileId = botPlanDiscard(this.round, HUMAN, this.difficulty).tileId;
    this.changed();
  }

  /** The hint has been used up for this hand. */
  get hintAvailable(): boolean {
    return this.round.turn === HUMAN && this.round.phase === 'discard' && this.hintTileId === null;
  }

  /** True when the next hint costs a rewarded ad. */
  get hintCostsAd(): boolean {
    return this.hintUsedThisHand;
  }

  /** The tile ids that belong to a complete meld. */
  get meldedTileIds(): Set<number> {
    return new Set(this.melds.flat().map((tile) => tile.id));
  }

  humanDraw(): void {
    if (canDraw(this.round, HUMAN)) this.receive(drawFromPile(this.round, HUMAN));
  }

  humanTakeDiscard(): void {
    if (canTakeDiscard(this.round, HUMAN)) this.receive(takeDiscard(this.round, HUMAN));
  }

  humanShowIndicator(): void {
    if (!canShowIndicator(this.round, HUMAN)) return;
    showIndicator(this.round, HUMAN);
    this.showNotice({ kind: 'indicatorShown', seat: HUMAN });
    this.deps.sound.show();
    void this.persist();
  }

  humanDiscard(tileId: number): void {
    if (!this.humanMustDiscard) return;
    discardTile(this.round, HUMAN, tileId);
    this.release(tileId);
    this.afterTurn();
  }

  humanFinish(tileId: number): void {
    if (!this.humanMustDiscard) return;
    if (!declareWin(this.round, HUMAN, tileId)) {
      this.showNotice({ kind: 'invalidFinish' });
      return;
    }
    this.release(tileId);
    this.afterTurn();
  }

  toggleSelect(tileId: number): void {
    this.select(this.selected === tileId ? null : tileId);
  }

  select(tileId: number | null): void {
    this.selected = tileId;
    this.changed();
  }

  moveInRack(tileId: number, slot: number): void {
    moveTile(this.rack, tileId, slot);
    this.changed();
  }

  sortRuns(): void {
    this.rack = arrangeRuns(this.round.hands[HUMAN], this.round.okey);
    this.changed();
  }

  sortPairs(): void {
    this.rack = arrangePairs(this.round.hands[HUMAN], this.round.okey);
    this.changed();
  }

  /** Lays the hand out with the complete sets and runs first. */
  sortMelds(): void {
    this.rack = arrangeMelds(this.round.hands[HUMAN], this.round.okey);
    this.changed();
  }

  /** Puts the tiles back in hand order, without the group gaps. */
  clearArrange(): void {
    const hand = this.round.hands[HUMAN];
    this.rack = hand.map((tile) => tile.id);
    this.changed();
  }

  /** Opens the rules card; it can be reopened from the toolbar at any time. */
  openCoach(): void {
    this.coachOpen = true;
    this.changed();
  }

  /** How sharp the computer opponents are. */
  setDifficulty(difficulty: Difficulty): void {
    this.difficulty = difficulty;
    void this.persist();
    this.changed();
  }

  /** The points a new match starts from. It applies to the next match. */
  setMatchStart(start: number): void {
    this.matchStart = start;
    void this.persist();
    this.changed();
  }

  /** The optional rules that change what a finished hand is worth. */
  get rules(): RuleOptions {
    return { coloredOkey: this.coloredOkey, singleColor: this.singleColor };
  }

  /** The colored okey: a red or black indicator makes the okey count double. */
  setColoredOkey(on: boolean): void {
    this.coloredOkey = on;
    void this.persist();
    this.changed();
  }

  /** A hand finished with all its tiles in one colour costs the others double. */
  setSingleColor(on: boolean): void {
    this.singleColor = on;
    void this.persist();
    this.changed();
  }

  /** Closes the rules card for good. */
  closeCoach(): void {
    this.coachOpen = false;
    this.coachSeen = true;
    void this.persist();
    this.changed();
  }

  /** From the result screen: the next hand, or a new match once someone has hit zero. */
  async nextHand(): Promise<void> {
    if (this.round.phase !== 'roundOver' || this.advancing) return;
    this.advancing = true;
    try {
      if (++this.handsSinceAd >= HANDS_PER_INTERSTITIAL) {
        this.handsSinceAd = 0;
        // Ads are not guaranteed (region, platform, fill); the game goes on either way.
        await this.deps.platform.requestInterstitialAd().catch(() => undefined);
      }
      this.cancelBot?.();
      this.cancelBot = null;
      if (this.matchOver) this.match = newMatch(this.matchStart);
      ({ round: this.round, rack: this.rack } = freshRound(nextSeat(this.round.starter)));
      this.lastPenalties = null;
      this.selected = null;
      this.lastDrawn = null;
      this.hintTileId = null;
      // A new hand brings a new free hint.
      this.hintUsedThisHand = false;
      this.dealing = true;
      this.clearNotice();
      void this.persist();
      this.changed();
      this.scheduleBot();
      // The deal is over in a moment; the tiles then sit still.
      this.deps.scheduler.after(DEAL_ANIM_MS, () => {
        this.dealing = false;
        this.changed();
      });
    } finally {
      this.advancing = false;
    }
  }

  async persist(): Promise<void> {
    if (!this.canSave) return;
    const save: SaveData = {
      v: SAVE_VERSION,
      stats: this.stats,
      match: this.match,
      round: this.round,
      rack: this.rack,
      coachSeen: this.coachSeen,
      difficulty: this.difficulty,
      matchStart: this.matchStart,
      coloredOkey: this.coloredOkey,
      singleColor: this.singleColor,
    };
    try {
      await this.deps.platform.saveData(serializeSave(save));
    } catch {
      this.deps.platform.logWarning();
    }
  }

  private receive(tile: Tile): void {
    placeTile(this.rack, tile.id);
    this.lastDrawn = tile.id;
    // A new tile means a new decision: the old hint is stale.
    this.hintTileId = null;
    this.deps.sound.tile();
    this.changed();
  }

  private release(tileId: number): void {
    removeTile(this.rack, tileId);
    // Close the hole the thrown tile leaves, so the rack stays one row of tiles.
    compactRack(this.rack);
    if (this.selected === tileId) this.selected = null;
    if (this.hintTileId === tileId) this.hintTileId = null;
    this.lastDrawn = null;
    this.clearNotice();
    this.deps.sound.throwTile();
    // The thrown tile is now on the pile: let it land with a little weight.
    this.discardingId = tileId;
    this.deps.scheduler.after(DISCARD_ANIM_MS, () => {
      if (this.discardingId === tileId) {
        this.discardingId = null;
        this.changed();
      }
    });
  }

  private afterTurn(): void {
    if (this.round.phase === 'roundOver') this.finishRound();
    else if (this.round.turn === HUMAN) {
      void this.persist();
      // Sıra oyuncuda: kısa bir uyarı, oyuncu bakmadığında fark etsin.
      this.deps.sound.turn();
    }
    this.changed();
    this.scheduleBot();
  }

  private finishRound(): void {
    this.lastPenalties = scoreRound(this.match, this.round, this.rules);
    this.stats.played++;
    if (this.round.winner === HUMAN) {
      this.stats.won++;
      this.deps.sound.win();
    }
    if (this.matchOver) {
      this.stats.matchesPlayed++;
      if (matchLeaders(this.match).includes(HUMAN)) this.stats.matchesWon++;
    }
    void this.persist();
    // The score sent must match the best score in the save: total hands won.
    this.deps.platform.sendScore(this.stats.won).catch(() => this.deps.platform.logWarning());
  }

  private scheduleBot(): void {
    const r = this.round;
    if (this.cancelBot || r.phase === 'roundOver' || r.turn === HUMAN) return;
    const delay = r.phase === 'draw' ? BOT_DELAY[this.difficulty].draw : BOT_DELAY[this.difficulty].discard;
    this.cancelBot = this.deps.scheduler.after(delay, () => {
      this.cancelBot = null;
      this.botStep();
    });
  }

  private botStep(): void {
    const r = this.round;
    const seat = r.turn;
    // Bots always take the gösterge point when they can.
    if (canShowIndicator(r, seat)) {
      showIndicator(r, seat);
      this.showNotice({ kind: 'indicatorShown', seat });
      this.deps.sound.show();
    }
    if (r.phase === 'draw') {
      if (botWantsDiscard(r, seat, this.difficulty)) takeDiscard(r, seat);
      else drawFromPile(r, seat);
      this.deps.sound.tile();
      this.changed();
      this.scheduleBot();
      return;
    }
    const plan = botPlanDiscard(r, seat, this.difficulty);
    if (!(plan.win && declareWin(r, seat, plan.tileId))) discardTile(r, seat, plan.tileId);
    this.deps.sound.throwTile();
    this.afterTurn();
  }

  private showNotice(notice: Notice): void {
    this.clearNotice();
    this.notice = notice;
    this.cancelNotice = this.deps.scheduler.after(NOTICE_MS, () => {
      this.cancelNotice = null;
      this.notice = null;
      this.changed();
    });
    this.changed();
  }

  private clearNotice(): void {
    this.cancelNotice?.();
    this.cancelNotice = null;
    this.notice = null;
  }

  private changed(): void {
    // A complete set or run appears: say so.
    const melds = this.melds.length;
    if (melds > this.lastMeldCount) this.deps.sound.meld();
    this.lastMeldCount = melds;
    for (const listener of this.listeners) listener();
  }
}
