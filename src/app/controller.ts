import { awayAfterThrow, botPlanDiscard, botWantsDiscard, type Difficulty } from '../core/bot';
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
  previousSeat,
  showIndicator,
  takeDiscard,
  type RoundState,
} from '../core/game';
import { dailySeed, dayNumber, previousDay } from '../core/daily';
import { randomSeed } from '../core/rng';
import {
  finishedWithOkey,
  isMatchOver,
  matchLeaders,
  newMatch,
  NO_EXTRA_RULES,
  scoreRound,
  handValue,
  START_POINTS,
  type MatchState,
  type RuleOptions,
} from '../core/scoring';
import type { Tile } from '../core/tile';
import type { Platform } from '../platform/playables';
import type { Motion } from './motion';
import { arrangeMelds, arrangePairs, arrangeRuns, compactRack, moveTile, placeTile, reconcileRack, removeTile, type Rack } from './rack';
import { SAVE_VERSION, serializeSave, TUTORIAL_DONE, type BotPace, type DailyStats, type ParkedHand, type SaveData, type Stats } from './save';
import type { Scheduler } from './scheduler';
import type { Sound } from './sound';

export const HUMAN = 0;

/**
 * How long the opponents think before they move. An easy game gives the
 * player time to think, a hard one keeps the pressure on. The tile flight
 * plays on top of this, so the player sees what happened before the next
 * move starts.
 */
const BOT_DELAY: Record<Difficulty, { draw: number; discard: number }> = {
  easy: { draw: 1000, discard: 1100 },
  normal: { draw: 450, discard: 550 },
  hard: { draw: 260, discard: 340 },
};
/** A quick pace shortens the opponents' thinking; the tile flight still plays in full. */
const QUICK_PACE = 0.45;
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
  /** Seed for the first hand dealt, so a deal can be asked for (tests, layout checks); later hands are random. */
  firstSeed?: number;
  /** Today as YYYYMMDD; tests pass their own. */
  today?: () => number;
}

/** The daily deal is played against the same opponents for everyone, whatever the table setting. */
const DAILY_DIFFICULTY: Difficulty = 'normal';

function freshRound(starter: number, seed: number = randomSeed()): { round: RoundState; rack: Rack } {
  const round = dealRound(seed, starter);
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
  /** The menu is open. */
  menuOpen = false;
  /** The statistics screen is open (it opens from the menu). */
  statsOpen = false;
  /** What happened on the table, waiting for the view to show it. */
  pendingMotions: Motion[] = [];
  /** When this hand was dealt, for the clock. */
  private handStartedAt = performance.now();
  /** When the game was paused, so the pause does not count as playing time. */
  private clockFrozen: number | null = null;
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
  /** How long the opponents take over a move. */
  botPace: BotPace = 'relaxed';
  /** The daily deal's results. */
  daily: DailyStats;
  /** The day of the daily deal being played, or null while the hand belongs to the match. */
  dailyDate: number | null = null;
  /** The match hand set aside while the daily deal is played. */
  private parked: ParkedHand | null = null;
  /** How far the first-hand guide has got; see `tour`. */
  private tutorial: number;

  private readonly listeners = new Set<() => void>();
  private readonly clockListeners = new Set<() => void>();
  private cancelBot: (() => void) | null = null;
  private cancelNotice: (() => void) | null = null;
  private cancelClock: (() => void) | null = null;
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
    this.botPace = save.botPace;
    this.daily = { ...save.daily };
    this.tutorial = save.tutorial;
    // A new player gets the rules card over their first hand.
    this.coachOpen = !save.coachSeen;

    // A daily deal that is finished, or belongs to a day that is over, is not resumed: the
    // match hand that was set aside comes back (its result, if it was played out, is in `daily`).
    let { round, rack } = save;
    let parked = save.parked;
    let dailyDate = save.dailyDate;
    if (dailyDate !== null && (dailyDate !== this.today() || !round || round.phase === 'roundOver')) {
      ({ round = null, rack = null } = parked ?? {});
      parked = null;
      dailyDate = null;
    }
    this.dailyDate = dailyDate;
    this.parked = parked;

    if (round && round.phase !== 'roundOver') {
      this.round = round;
      this.rack = reconcileRack(rack ?? [], round.hands[HUMAN]);
    } else {
      // The player left on the result screen: that hand is already scored, so move on.
      if (isMatchOver(this.match)) this.match = newMatch(this.matchStart);
      ({ round: this.round, rack: this.rack } = freshRound(round ? nextSeat(round.starter) : HUMAN, deps.firstSeed));
      this.dealtOnLoad = true;
    }
    // Counted from here on: the hand may already hold a complete set.
    this.lastMeldCount = this.melds.length;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /**
   * A tick every second, for the clock on the table. It goes through the
   * scheduler, so a pause freezes it with everything else.
   */
  subscribeClock(listener: () => void): () => void {
    this.clockListeners.add(listener);
    return () => void this.clockListeners.delete(listener);
  }

  /** Call once the game is interactive (after gameReady). */
  begin(): void {
    // Save it now, or reloading would deal a different hand.
    if (this.dealtOnLoad) void this.persist();
    this.scheduleBot();
    this.scheduleClock();
  }

  /** How long this hand has been running, without the time the game was paused. */
  get handElapsedMs(): number {
    const now = this.clockFrozen ?? performance.now();
    return Math.max(0, now - this.handStartedAt);
  }

  /** Freezes the clock; the pause should not count as playing time. */
  pauseClock(): void {
    this.clockFrozen = performance.now();
  }

  resumeClock(): void {
    if (this.clockFrozen === null) return;
    this.handStartedAt += performance.now() - this.clockFrozen;
    this.clockFrozen = null;
  }

  private scheduleClock(): void {
    this.cancelClock?.();
    this.cancelClock = this.deps.scheduler.after(1000, () => {
      for (const listener of this.clockListeners) listener();
      this.scheduleClock();
    });
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
    // The hint is the best advice there is, whatever the opponents' level: advice from the
    // easy bot, which throws a tile at random now and then, would be no help.
    this.hintTileId = botPlanDiscard(this.round, HUMAN, 'hard').tileId;
    this.changed();
  }

  /** How many tiles the hand is from winning once the hinted tile is thrown; null while no hint is shown. */
  get hintAway(): number | null {
    if (this.hintTileId === null) return null;
    return awayAfterThrow(this.round.hands[HUMAN], this.hintTileId, this.round.okey);
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
    if (!canDraw(this.round, HUMAN)) return;
    const tile = drawFromPile(this.round, HUMAN);
    this.tourAfter('draw');
    this.receive(tile, { kind: 'draw', tileId: tile.id, seat: HUMAN });
  }

  humanTakeDiscard(): void {
    if (!canTakeDiscard(this.round, HUMAN)) return;
    const from = previousSeat(HUMAN);
    const tile = takeDiscard(this.round, HUMAN);
    this.tourAfter('draw');
    this.receive(tile, { kind: 'take', tileId: tile.id, seat: HUMAN, from });
  }

  humanShowIndicator(): void {
    if (!canShowIndicator(this.round, HUMAN)) return;
    showIndicator(this.round, HUMAN);
    this.showNotice({ kind: 'indicatorShown', seat: HUMAN });
    this.pendingMotions.push({ kind: 'indicator', seat: HUMAN });
    this.deps.sound.show();
    void this.persist();
  }

  humanDiscard(tileId: number): void {
    if (!this.humanMustDiscard) return;
    discardTile(this.round, HUMAN, tileId);
    this.tourAfter('throw');
    this.release(tileId);
    this.pendingMotions.push({ kind: 'throw', tileId, seat: HUMAN, to: HUMAN });
    this.afterTurn();
  }

  humanFinish(tileId: number): void {
    if (!this.humanMustDiscard) return;
    if (!declareWin(this.round, HUMAN, tileId)) {
      this.showNotice({ kind: 'invalidFinish' });
      return;
    }
    this.release(tileId);
    this.pendingMotions.push({ kind: 'win', seat: HUMAN });
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

  /** How long the opponents take over a move. */
  setBotPace(pace: BotPace): void {
    this.botPace = pace;
    void this.persist();
    this.changed();
  }

  /** The optional rules that change what a finished hand is worth; the daily deal plays by the plain ones. */
  get rules(): RuleOptions {
    return this.dailyDate !== null ? NO_EXTRA_RULES : { coloredOkey: this.coloredOkey, singleColor: this.singleColor };
  }

  /** How sharp the opponents are in the hand being played. */
  private get botLevel(): Difficulty {
    return this.dailyDate !== null ? DAILY_DIFFICULTY : this.difficulty;
  }

  private today(): number {
    return this.deps.today ? this.deps.today() : dayNumber(new Date());
  }

  /**
   * The first-hand guide's step while it is running, otherwise null: 0 the first
   * throw, 1 the first draw, 2 the second throw. It only runs in the match's own
   * hand, never in the daily deal, and ends with the hand.
   */
  get tour(): number | null {
    if (this.tutorial >= TUTORIAL_DONE || this.dailyDate !== null || this.round.phase === 'roundOver') return null;
    return this.tutorial;
  }

  /** The guide moves on when the player does what the step asked. */
  private tourAfter(action: 'throw' | 'draw'): void {
    if (this.tutorial >= TUTORIAL_DONE || this.dailyDate !== null) return;
    if (action === 'draw') this.tutorial = Math.max(this.tutorial, 2);
    else this.tutorial = this.tutorial === 0 ? 1 : TUTORIAL_DONE;
  }

  /** Whether the daily deal is the hand on the table. */
  get dailyActive(): boolean {
    return this.dailyDate !== null;
  }

  /** Today's daily deal has been played to the end. */
  get dailyDoneToday(): boolean {
    return this.daily.lastDate === this.today();
  }

  /** Hands won in the match and in daily deals together: the score sent to YouTube. */
  private get totalWins(): number {
    return this.stats.won + this.daily.won;
  }

  /**
   * Sets the match hand aside and deals today's daily deal: the same hand for everyone who
   * plays today, once a day. A daily deal already begun is simply resumed.
   */
  startDaily(): void {
    if (this.dailyDate !== null) {
      this.closeMenu();
      return;
    }
    // Played already today, or the match hand is on its result screen (it is closed from there).
    if (this.dailyDoneToday || this.round.phase === 'roundOver') return;
    const day = this.today();
    this.parked = { round: this.round, rack: this.rack };
    this.dailyDate = day;
    this.menuOpen = false;
    this.statsOpen = false;
    this.enterRound(freshRound(HUMAN, dailySeed(day)), true);
  }

  /** From the daily deal's result: back to the match hand that was set aside. */
  private leaveDaily(): void {
    const parked = this.parked;
    this.dailyDate = null;
    this.parked = null;
    if (parked) this.enterRound({ round: parked.round, rack: reconcileRack(parked.rack ?? [], parked.round.hands[HUMAN]) }, false);
    else this.enterRound(freshRound(HUMAN), true);
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

  /** Opens the menu. */
  openMenu(): void {
    this.menuOpen = true;
    this.changed();
  }

  closeMenu(): void {
    this.menuOpen = false;
    this.statsOpen = false;
    this.changed();
  }

  /** The statistics screen replaces the menu; closing it returns to the menu. */
  openStats(): void {
    this.statsOpen = true;
    this.menuOpen = true;
    this.changed();
  }

  closeStats(): void {
    this.statsOpen = false;
    this.changed();
  }

  /**
   * Throws the match away and starts from zero: fresh points, a fresh hand.
   * The save keeps the hand in progress, which is right for a player coming
   * back — this is the way out when they want a clean start instead.
   */
  newMatch(): void {
    // The daily deal is not part of the match: finish it, then the match can be thrown away.
    if (this.dailyDate !== null) return;
    this.dealHand(true);
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
      if (this.dailyDate !== null) this.leaveDaily();
      else this.dealHand(this.matchOver);
    } finally {
      this.advancing = false;
    }
  }

  /** Deals a hand; with fresh points it is a whole new match. */
  private dealHand(freshPoints: boolean): void {
    if (freshPoints) this.match = newMatch(this.matchStart);
    this.enterRound(freshRound(nextSeat(this.round.starter)), true);
  }

  /** Puts a hand on the table; `deal` plays the dealing animation (a hand picked up again has none). */
  private enterRound(next: { round: RoundState; rack: Rack }, deal: boolean): void {
    this.cancelBot?.();
    this.cancelBot = null;
    ({ round: this.round, rack: this.rack } = next);
    this.lastPenalties = null;
    this.selected = null;
    this.lastDrawn = null;
    this.hintTileId = null;
    // A new hand brings a new free hint.
    this.hintUsedThisHand = false;
    this.handStartedAt = performance.now();
    this.dealing = deal;
    // A hand picked up again did not just form its sets: no chime for them.
    if (!deal) this.lastMeldCount = this.melds.length;
    this.clearNotice();
    void this.persist();
    this.changed();
    this.scheduleBot();
    // The deal is over in a moment; the tiles then sit still.
    if (deal) {
      this.deps.scheduler.after(DEAL_ANIM_MS, () => {
        this.dealing = false;
        this.changed();
      });
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
      botPace: this.botPace,
      daily: this.daily,
      dailyDate: this.dailyDate,
      parked: this.parked,
      tutorial: this.tutorial,
    };
    try {
      await this.deps.platform.saveData(serializeSave(save));
    } catch {
      this.deps.platform.logWarning();
    }
  }

  private receive(tile: Tile, motion?: Motion): void {
    placeTile(this.rack, tile.id);
    this.lastDrawn = tile.id;
    // A new tile means a new decision: the old hint is stale.
    this.hintTileId = null;
    this.deps.sound.tile();
    if (motion) this.pendingMotions.push(motion);
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
    // A hand that has been played out is the end of the guide, whatever step it had got to.
    if (this.dailyDate === null) this.tutorial = TUTORIAL_DONE;
    if (this.dailyDate !== null) this.finishDaily(this.dailyDate);
    else this.finishMatchHand();
    void this.persist();
    // The score sent must match the best score in the save: total hands won, the daily ones too.
    this.deps.platform.sendScore(this.totalWins).catch(() => this.deps.platform.logWarning());
  }

  /** A daily deal is over: one result a day, kept apart from the match and its numbers. */
  private finishDaily(day: number): void {
    const { daily, round } = this;
    const won = round.winner === HUMAN;
    daily.played++;
    if (won) {
      daily.won++;
      // Days in a row: yesterday's deal must have been won too.
      daily.streak = daily.lastWon && daily.lastDate === previousDay(day) ? daily.streak + 1 : 1;
      daily.best = Math.max(daily.best, daily.streak);
      this.deps.sound.win();
    } else {
      daily.streak = 0;
    }
    daily.lastDate = day;
    daily.lastWon = won;
  }

  private finishMatchHand(): void {
    this.lastPenalties = scoreRound(this.match, this.round, this.rules);
    const { stats, round } = this;
    stats.played++;
    if (round.winner === HUMAN) {
      stats.won++;
      stats.streak++;
      stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
      if (round.winKind === 'pairs') stats.pairsWon++;
      if (finishedWithOkey(round)) stats.okeyWon++;
      // The finishing throw ends the hand without being counted as a turn.
      const turns = round.turnsTaken[HUMAN] + 1;
      stats.fastestWin = stats.fastestWin === 0 ? turns : Math.min(stats.fastestWin, turns);
      this.deps.sound.win();
    } else if (round.winner === null) {
      // Nobody won: a run of wins is not broken by a hand that was never decided.
      stats.drawn++;
    } else {
      stats.streak = 0;
    }
    if (this.matchOver) {
      this.stats.matchesPlayed++;
      if (matchLeaders(this.match).includes(HUMAN)) this.stats.matchesWon++;
    }
  }

  private scheduleBot(): void {
    const r = this.round;
    if (this.cancelBot || r.phase === 'roundOver' || r.turn === HUMAN) return;
    const base = r.phase === 'draw' ? BOT_DELAY[this.botLevel].draw : BOT_DELAY[this.botLevel].discard;
    const delay = this.botPace === 'quick' ? Math.round(base * QUICK_PACE) : base;
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
      this.pendingMotions.push({ kind: 'indicator', seat });
      this.deps.sound.show();
    }
    if (r.phase === 'draw') {
      if (botWantsDiscard(r, seat, this.botLevel)) {
        const from = previousSeat(seat);
        const tile = takeDiscard(r, seat);
        this.pendingMotions.push({ kind: 'take', tileId: tile.id, seat, from });
      } else {
        const tile = drawFromPile(r, seat);
        this.pendingMotions.push({ kind: 'draw', tileId: tile.id, seat });
      }
      this.deps.sound.tile();
      this.changed();
      this.scheduleBot();
      return;
    }
    const plan = botPlanDiscard(r, seat, this.botLevel);
    if (plan.win && declareWin(r, seat, plan.tileId)) {
      this.pendingMotions.push({ kind: 'win', seat });
    } else {
      discardTile(r, seat, plan.tileId);
      this.pendingMotions.push({ kind: 'throw', tileId: plan.tileId, seat, to: seat });
    }
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
    if (melds > this.lastMeldCount) {
      this.deps.sound.meld();
      this.pendingMotions.push({ kind: 'meld', tileIds: this.meldedTileIdsArray() });
    }
    this.lastMeldCount = melds;
    for (const listener of this.listeners) listener();
  }

  private meldedTileIdsArray(): number[] {
    return this.melds.flat().map((tile) => tile.id);
  }
}
