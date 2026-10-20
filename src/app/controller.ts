import { botPlanDiscard, botWantsDiscard } from '../core/bot';
import {
  canDraw,
  canTakeDiscard,
  dealRound,
  declareWin,
  discardTile,
  drawFromPile,
  nextSeat,
  takeDiscard,
  type RoundState,
} from '../core/game';
import { randomSeed } from '../core/rng';
import type { Tile } from '../core/tile';
import type { Platform } from '../platform/playables';
import { arrangePairs, arrangeRuns, moveTile, placeTile, reconcileRack, removeTile, type Rack } from './rack';
import { SAVE_VERSION, serializeSave, type SaveData, type Stats } from './save';
import type { Scheduler } from './scheduler';
import type { Sound } from './sound';

export const HUMAN = 0;

const BOT_DRAW_DELAY_MS = 600;
const BOT_DISCARD_DELAY_MS = 750;
const NOTICE_MS = 2200;
/** Interstitial ads only at a natural break: before every Nth new hand. */
const HANDS_PER_INTERSTITIAL = 2;

export type Notice = 'invalidFinish';

interface Deps {
  platform: Platform;
  scheduler: Scheduler;
  sound: Sound;
}

function freshRound(starter: number): { round: RoundState; rack: Rack } {
  const round = dealRound(randomSeed(), starter);
  return { round, rack: arrangeRuns(round.hands[HUMAN], round.okey) };
}

/** Owns the game state, runs the bots and saves progress. The view only reads and calls in. */
export class Controller {
  round: RoundState;
  rack: Rack;
  stats: Stats;
  selected: number | null = null;
  lastDrawn: number | null = null;
  notice: Notice | null = null;

  private readonly listeners = new Set<() => void>();
  private cancelBot: (() => void) | null = null;
  private cancelNotice: (() => void) | null = null;
  private advancing = false;
  private handsSinceAd = 0;

  /** `canSave` is false when loading failed: saving then would wipe the player's progress. */
  constructor(
    private readonly deps: Deps,
    save: SaveData,
    private readonly canSave: boolean,
  ) {
    this.stats = { ...save.stats };
    if (save.round && save.round.phase !== 'roundOver') {
      this.round = save.round;
      this.rack = reconcileRack(save.rack ?? [], save.round.hands[HUMAN]);
    } else {
      ({ round: this.round, rack: this.rack } = freshRound(save.round ? nextSeat(save.round.starter) : HUMAN));
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Call once the game is interactive (after gameReady). */
  begin(): void {
    this.scheduleBot();
  }

  get humanMustDiscard(): boolean {
    return this.round.turn === HUMAN && this.round.phase === 'discard';
  }

  humanDraw(): void {
    if (canDraw(this.round, HUMAN)) this.receive(drawFromPile(this.round, HUMAN));
  }

  humanTakeDiscard(): void {
    if (canTakeDiscard(this.round, HUMAN)) this.receive(takeDiscard(this.round, HUMAN));
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
      this.showNotice('invalidFinish');
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
      ({ round: this.round, rack: this.rack } = freshRound(nextSeat(this.round.starter)));
      this.selected = null;
      this.lastDrawn = null;
      this.clearNotice();
      void this.persist();
      this.changed();
      this.scheduleBot();
    } finally {
      this.advancing = false;
    }
  }

  async persist(): Promise<void> {
    if (!this.canSave) return;
    const save: SaveData = { v: SAVE_VERSION, stats: this.stats, round: this.round, rack: this.rack };
    try {
      await this.deps.platform.saveData(serializeSave(save));
    } catch {
      this.deps.platform.logWarning();
    }
  }

  private receive(tile: Tile): void {
    placeTile(this.rack, tile.id);
    this.lastDrawn = tile.id;
    this.deps.sound.tile();
    this.changed();
  }

  private release(tileId: number): void {
    removeTile(this.rack, tileId);
    if (this.selected === tileId) this.selected = null;
    this.lastDrawn = null;
    this.clearNotice();
    this.deps.sound.tile();
  }

  private afterTurn(): void {
    if (this.round.phase === 'roundOver') this.finishRound();
    else if (this.round.turn === HUMAN) void this.persist();
    this.changed();
    this.scheduleBot();
  }

  private finishRound(): void {
    this.stats.played++;
    if (this.round.winner === HUMAN) this.stats.won++;
    void this.persist();
    // The score sent must match the best score in the save: total hands won.
    this.deps.platform.sendScore(this.stats.won).catch(() => this.deps.platform.logWarning());
  }

  private scheduleBot(): void {
    const r = this.round;
    if (this.cancelBot || r.phase === 'roundOver' || r.turn === HUMAN) return;
    const delay = r.phase === 'draw' ? BOT_DRAW_DELAY_MS : BOT_DISCARD_DELAY_MS;
    this.cancelBot = this.deps.scheduler.after(delay, () => {
      this.cancelBot = null;
      this.botStep();
    });
  }

  private botStep(): void {
    const r = this.round;
    const seat = r.turn;
    if (r.phase === 'draw') {
      if (botWantsDiscard(r, seat)) takeDiscard(r, seat);
      else drawFromPile(r, seat);
      this.changed();
      this.scheduleBot();
      return;
    }
    const plan = botPlanDiscard(r, seat);
    if (!(plan.win && declareWin(r, seat, plan.tileId))) discardTile(r, seat, plan.tileId);
    this.deps.sound.tile();
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
    for (const listener of this.listeners) listener();
  }
}
