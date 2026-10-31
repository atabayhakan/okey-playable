import { HUMAN, type Controller } from '../app/controller';
import type { Motion } from '../app/motion';
import type { Difficulty } from '../core/bot';
import { GROUP_BREAK } from '../app/rack';
import { canDraw, canShowIndicator, canTakeDiscard, previousSeat, SEATS } from '../core/game';
import { winningGroups } from '../core/hand';
import { finishedWithOkey, isSingleColorHand, matchLeaders, START_POINTS } from '../core/scoring';
import { resolve, type Color, type Tile } from '../core/tile';
import type { Strings } from '../i18n';
import { flash, flyAway, Flights, moveTo, rectOf, reducedMotion, winPulse, type Rect } from './flight';

/** Where each seat sits on the table, and where its discard pile is. */
const SEAT_AREA: Record<number, string> = { 1: 'right', 2: 'top', 3: 'left' };
const PILE_AREA: Record<number, string> = { 0: 'br', 1: 'tr', 2: 'tl', 3: 'bl' };

const DRAG_THRESHOLD_PX = 6;
/** The pile is "running low" at this many tiles: the hand is about to be called. */
const PILE_LOW = 12;
/** Match lengths: the points everyone starts from. */
const MATCH_LENGTHS: [id: 'short' | 'classic' | 'long', start: number][] = [
  ['short', 10],
  ['classic', 20],
  ['long', 40],
];
/** Suppresses the click a browser fires after a drag ends on the dragged tile. */
const CLICK_AFTER_DRAG_MS = 400;
/** A shape per color, so tiles stay readable for color-blind players. */
const COLOR_MARKS: Record<Color, string> = { red: '●', yellow: '▲', blue: '■', black: '◆' };

type Attrs = Record<string, string | number | boolean | undefined>;
type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === 'class') el.className = String(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) el.append(child);
  return el;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * How the table is laid out for a given amount of room. `chrome` is the height
 * of everything that is not the table or the rack (toolbar, gaps, padding) and
 * `statusStrip` the strip the status bar takes above the seats in landscape.
 * They mirror the CSS: the compact values match the [data-compact] rules.
 */
interface FitMode {
  chrome: number;
  statusStrip: number;
  minTile: number;
  maxTile: number;
  minBoardWide: number;
  minBoardTall: number;
}

interface FitResult {
  mode: FitMode;
  tile: number;
  cols: number;
  rackH: number;
}

/**
 * How many rows a grid of `cols` tracks needs for these items, placed the way CSS grid places them: in
 * order, and an item that does not fit in what is left of a row starts the next one. Dividing the tracks
 * by the columns is not enough: a two-track tile that finds one track left on a row leaves it empty, and
 * the rack comes out a row taller than that sum says.
 */
const rowsFor = (items: readonly number[], cols: number): number => {
  let rows = 1;
  let used = 0;
  for (const span of items) {
    if (used + span > cols) {
      rows++;
      used = 0;
    }
    used += span;
  }
  return rows;
};

/** Height of a rack of `rows` rows of tiles `t` px wide: the tiles, the row gaps and the padding. */
const rackHeight = (t: number, rows: number) => t * (1.38 * rows + 0.08 * (rows - 1) + 0.44);

const ROOMY: FitMode = { chrome: 74, statusStrip: 48, minTile: 30, maxTile: 56, minBoardWide: 185, minBoardTall: 230 };
const COMPACT: FitMode = { chrome: 52, statusStrip: 40, minTile: 20, maxTile: 40, minBoardWide: 105, minBoardTall: 150 };

interface Drag {
  tileId: number;
  pointerId: number;
  startX: number;
  startY: number;
  source: HTMLElement;
  ghost: HTMLElement | null;
  hover: HTMLElement | null;
}

/**
 * Renders the table from the controller's state. Everything is DOM, so text stays sharp
 * at any size or pixel density. Works with touch, mouse and keyboard.
 */
export class View {
  private drag: Drag | null = null;
  private dirty = false;
  private ignoreClicksUntil = 0;
  /** Tiles that already form a complete set or run; marked on the rack. */
  private meldedIds = new Set<number>();
  /** The running tile flights, so a pause can freeze them. */
  private readonly flights: Flights;

  constructor(
    private readonly root: HTMLElement,
    private readonly game: Controller,
    private readonly t: Strings,
  ) {
    root.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    root.addEventListener('pointermove', (e) => this.onPointerMove(e));
    root.addEventListener('pointerup', (e) => this.onPointerUp(e));
    root.addEventListener('pointercancel', () => this.endDrag());
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('keydown', (e) => this.onKey(e));
    // Resizing only re-fits; the game state is untouched.
    new ResizeObserver(() => this.fit()).observe(root);
    this.flights = new Flights(root);
  }

  render(): void {
    // Re-rendering mid-drag would destroy the dragged tile; catch up when it ends.
    if (this.drag) {
      this.dirty = true;
      return;
    }
    this.dirty = false;
    this.meldedIds = this.game.meldedTileIds;
    // What happened on the table, and where the tiles were before the redraw.
    const motions = this.game.pendingMotions;
    this.game.pendingMotions = [];
    // The rectangle has to be taken now: after the redraw the old element is
    // detached and measures nothing.
    const sources = motions.map((motion) => {
      const element = this.motionSource(motion);
      return element ? { element, rect: rectOf(element) } : null;
    });
    // The tile colours are set from CSS variables under this attribute.
    this.root.dataset.palette = this.game.palette;
    const focusedKey = (document.activeElement as HTMLElement | null)?.dataset?.key;
    const modal = this.game.round.phase === 'roundOver' ? this.resultModal() : null;
    const coach = this.game.coachOpen ? this.coach() : null;
    const menu = this.game.menuOpen ? (this.game.statsOpen ? this.statsModal() : this.menu()) : null;
    this.root.replaceChildren(this.table(), ...(modal ? [modal] : []), ...(coach ? [coach] : []), ...(menu ? [menu] : []));
    this.fit();
    motions.forEach((motion, index) => this.playMotion(motion, sources[index]));
    if (menu) {
      menu.querySelector<HTMLElement>('[data-action="close-menu"], [data-action="close-stats"]')?.focus({ preventScroll: true });
    } else if (coach) {
      coach.querySelector<HTMLElement>('[data-action="close-coach"]')?.focus({ preventScroll: true });
    } else if (modal) {
      modal.querySelector<HTMLElement>('[data-action="next-hand"]')?.focus({ preventScroll: true });
    } else if (focusedKey) {
      const el = this.root.querySelector<HTMLButtonElement>(`[data-key="${focusedKey}"]`);
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }
  }

  // ---- Layout ---------------------------------------------------------------

  /**
   * Size tiles to the viewport.
   *
   * The rack is a grid of half-tile tracks: a tile takes two, the gap between
   * two groups takes one. On a wide screen the rack uses more columns, so a
   * fifteen-tile hand stays in one or two rows and the table keeps its room.
   * On a narrow one it uses fewer columns and a bigger tile, because the
   * touch target matters more than the row count. The table always gets at
   * least its minimum height, otherwise the seats and the piles overlap.
   */
  private fit(): void {
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    if (!width || !height) return;
    const avail = width - 16;
    const items = this.rackItems();
    const wide = width > height;

    // The roomy layout first; when the screen is too short for it, the compact
    // one (thinner buttons, tighter spacing, smaller tiles) so nothing overlaps.
    const layout = this.fitRack(avail, height, items, wide, ROOMY) ?? this.fitCompactRack(avail, height, items, wide);
    const mode = layout.mode;
    const { tile, cols, rackH } = layout;

    // The table's own height: what is left after the rack and the fixed rows.
    const boardH = height - rackH - mode.chrome;
    // In landscape the status bar sits above the seats and needs its own strip.
    // 33 = the two rows' text lines (name, points, the indicator caption) and the row gaps.
    const extra = wide ? mode.statusStrip + 33 : 80;
    // The table tiles follow the room the table actually has.
    const btw = clamp(Math.floor((boardH - extra) / (wide ? 2.9 : 4.31)), mode === COMPACT ? 14 : 16, 64);
    const rackW = Math.floor(cols * 0.52 * tile + 0.52 * tile);

    this.root.style.setProperty('--tile-w', `${tile}px`);
    this.root.style.setProperty('--btw', `${btw}px`);
    this.root.style.setProperty('--cols', String(cols));
    this.root.style.setProperty('--rack-w', `${rackW}px`);
    this.root.toggleAttribute('data-compact', mode === COMPACT);
  }

  /** The biggest tile for which both the rack and the table fit in `mode`, or null if none does. */
  private fitRack(avail: number, height: number, items: number[], wide: boolean, mode: FitMode): FitResult | null {
    const minBoard = wide ? mode.minBoardWide : mode.minBoardTall;
    for (let t = mode.maxTile; t >= mode.minTile; t -= 1) {
      const cols = 2 * Math.floor((avail / t - 0.52) / 1.04);
      if (cols < 8) continue;
      const rackH = rackHeight(t, rowsFor(items, cols));
      if (height - rackH - mode.chrome < minBoard) continue;
      return { mode, tile: t, cols, rackH };
    }
    return null;
  }

  /**
   * The compact layout always answers: when even its smallest tile leaves the
   * table short of its minimum, that tile is used anyway. A very small screen
   * gets a readable, tight table rather than none.
   */
  private fitCompactRack(avail: number, height: number, items: number[], wide: boolean): FitResult {
    const fitted = this.fitRack(avail, height, items, wide, COMPACT);
    if (fitted) return fitted;
    const tile = COMPACT.minTile;
    const cols = Math.max(8, 2 * Math.floor((avail / tile - 0.52) / 1.04));
    return { mode: COMPACT, tile, cols, rackH: rackHeight(tile, rowsFor(items, cols)) };
  }

  /**
   * What the rack puts in its grid, in order, as the tracks each takes: two for a
   * tile or a free slot, one for the gap between two groups. The empty tail of the
   * rack is trimmed, so a hand that fits on two rows does not reserve three. A tile
   * of the hand that is not on the rack is drawn after the rest.
   */
  private rackItems(): number[] {
    const rack = this.game.rack;
    const items: number[] = [];
    for (let i = 0; i < this.rackSlots(); i++) items.push(rack[i] === GROUP_BREAK ? 1 : 2);
    for (const tile of this.game.round.hands[HUMAN]) if (!rack.includes(tile.id)) items.push(2);
    return items;
  }

  /** Slots the rack actually uses, with the empty tail trimmed off. */
  private rackSlots(): number {
    let last = -1;
    this.game.rack.forEach((id, i) => {
      if (id !== null) last = i;
    });
    return last + 1;
  }

  // ---- Building blocks --------------------------------------------------------

  private table(): HTMLElement {
    return h(
      // The table is the page's main region; the heading is for screen readers only.
      'main',
      { class: 'table' },
      h('h1', { class: 'sr-only' }, this.t.gameTitle),
      h(
        'div',
        { class: 'board' },
        this.discardPile(2, 'tl'),
        this.seat(2, 'top'),
        this.discardPile(1, 'tr'),
        this.seat(3, 'left'),
        this.center(),
        this.seat(1, 'right'),
        this.discardPile(3, 'bl'),
        h(
          'div',
          {
            // While a guide step is showing the bar gives its room to the words (see `.guided` in the CSS).
            class: `status${this.game.notice ? ` notice ${this.game.notice.kind}` : ''}${this.tourStep() && !this.game.notice ? ' guided' : ''}`,
            role: 'status',
            'aria-live': 'polite',
          },
          // The clock first: how long this hand has been going.
          h('span', { class: 'clock', title: this.t.clockLabel, 'aria-label': this.t.clockLabel }, this.clockText()),
          // The title keeps the full text reachable when a narrow bar has to cut it.
          h('span', { class: 'status-text', title: this.statusText() }, this.statusText()),
          // The hint rides along in the status bar: no new button on the table.
          this.game.hintAvailable
            ? h(
                'button',
                {
                  class: `hint-button${this.game.hintCostsAd ? ' ad' : ''}`,
                  'data-action': 'hint',
                  'data-key': 'hint',
                  'aria-label': this.t.hintLabel,
                  title: this.game.hintCostsAd ? this.t.hintAdLabel : this.t.hintLabel,
                },
                this.game.hintCostsAd ? `${this.t.hint} 🎬` : this.t.hint,
              )
            : null,
        ),
        this.discardPile(0, 'br'),
      ),
      this.toolbar(),
      this.rack(),
    );
  }

  // ---- Motion ----------------------------------------------------------------

  /**
   * Where a moving tile was before the table was redrawn. The old element is
   * still in the DOM when this runs, so the rectangle is the real one.
   */
  private motionSource(motion: Motion): HTMLElement | null {
    switch (motion.kind) {
      case 'draw':
        return this.root.querySelector<HTMLElement>('.pile .tile.back');
      case 'take':
        return this.root.querySelector<HTMLElement>(`.discard.${PILE_AREA[motion.from]} .tile`);
      case 'throw':
        return motion.seat === HUMAN
          ? this.root.querySelector<HTMLElement>(`.rack [data-tile-id="${motion.tileId}"]`)
          : this.root.querySelector<HTMLElement>(`.seat.${SEAT_AREA[motion.seat]} .avatar`);
      default:
        return null;
    }
  }

  /** Where a moving tile ends up. A tile lands on a tile; a bot's tile does not land at all. */
  private motionTarget(motion: Motion): HTMLElement | null {
    switch (motion.kind) {
      case 'draw':
      case 'take':
        return motion.seat === HUMAN
          ? this.root.querySelector<HTMLElement>(`.rack [data-tile-id="${motion.tileId}"]`)
          : this.root.querySelector<HTMLElement>(`.seat.${SEAT_AREA[motion.seat]} .avatar`);
      case 'throw':
        return this.root.querySelector<HTMLElement>(`.discard.${PILE_AREA[motion.to]} .tile`);
      default:
        return null;
    }
  }

  /** Shows what happened: a tile travels, a meld flashes, the gösterge glitters. */
  private playMotion(motion: Motion, source: { element: HTMLElement; rect: Rect | null } | null): void {
    if (reducedMotion()) return;
    switch (motion.kind) {
      case 'draw':
      case 'take':
      case 'throw': {
        const target = this.motionTarget(motion);
        if (target?.classList.contains('tile')) {
          // The tile itself travels, so the eye follows one object.
          const to = rectOf(target);
          if (source?.rect && to) {
            const animation = moveTo(target, source.rect, to);
            if (animation) this.flights.track(animation);
          }
          return;
        }
        // A bot's hand is hidden, so the tile flies towards the seat and fades.
        if (source && target) {
          const to = rectOf(target);
          if (to) {
            const animation = flyAway(this.root, source.element, to, source.rect ?? undefined);
            if (animation) this.flights.track(animation);
          }
        }
        return;
      }
      case 'meld':
        for (const id of motion.tileIds) {
          const element = this.root.querySelector<HTMLElement>(`.rack [data-tile-id="${id}"]`);
          if (element) flash(element, 'meld-flash');
        }
        return;
      case 'indicator': {
        const element = this.root.querySelector<HTMLElement>('.indicator .tile');
        if (element) flash(element, 'indicator-flash');
        return;
      }
      case 'win': {
        const table = this.root.querySelector<HTMLElement>('.table');
        if (table) {
          const animation = winPulse(table);
          if (animation) this.flights.track(animation);
        }
        return;
      }
    }
  }

  /** Freezes the movement while the game is paused. */
  pauseMotion(): void {
    this.flights.pause();
  }

  resumeMotion(): void {
    this.flights.resume();
  }

  // ---- Motion ----------------------------------------------------------------

  private seatName(seat: number): string {
    return seat === HUMAN ? this.t.you : this.t.botNames[seat - 1];
  }

  private seat(seat: number, area: string): HTMLElement {
    const r = this.game.round;
    const name = this.seatName(seat);
    const active = r.turn === seat && r.phase !== 'roundOver';
    return h(
      'div',
      { class: `seat ${area}${active ? ' active' : ''}` },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, name[0]),
      h('div', { class: 'name' }, name),
      // Points and tile count share a line so the seat is no taller than before scoring.
      h(
        'div',
        { class: 'meta' },
        h('span', { class: 'points' }, this.t.points(this.game.match.points[seat])),
        ' · ',
        h('span', { class: 'count' }, this.t.tiles(r.hands[seat].length)),
      ),
    );
  }

  /** Each discard pile sits in the corner between the seat that threw it and the seat that may take it. */
  private discardPile(seat: number, area: string): HTMLElement {
    const r = this.game.round;
    const top = r.discards[seat].at(-1);
    const face = top ? this.tile(top) : null;
    if (seat === previousSeat(HUMAN)) {
      const takeable = canTakeDiscard(r, HUMAN);
      const label = top ? this.t.takeDiscard(this.describe(top)) : this.t.emptyDiscard;
      // An empty pile stays a quiet outline: it is a target only while it is
      // live, otherwise three empty boxes are just noise on the table.
      return h('button', { class: `discard ${area}${takeable ? ' takeable' : ''}${top ? '' : ' empty'}`, 'data-action': 'take', 'data-key': 'take', disabled: !takeable, 'aria-label': label }, face);
    }
    if (seat === HUMAN) {
      const active = this.game.humanMustDiscard;
      const hint = active && !top ? h('span', { class: 'hint' }, h('span', { 'aria-hidden': 'true' }, '↓'), this.t.discardHere) : null;
      const tour = this.tourStep()?.target === 'discard' ? ' tour' : '';
      return h('button', { class: `discard ${area}${active ? ' target' : ''}${tour}${top ? '' : ' empty'}`, 'data-action': 'discard', 'data-drop': 'discard', 'data-key': 'discard', disabled: !active, 'aria-label': this.t.discardHere }, face, hint);
    }
    return h('div', { class: `discard ${area}${top ? '' : ' empty'}` }, face);
  }

  private center(): HTMLElement {
    const r = this.game.round;
    const t = this.t;
    const finishing = this.game.humanMustDiscard;
    // The hand ends when the pile runs out: the last tiles are worth a signal.
    const low = r.pile.length <= PILE_LOW;
    // The finish zone only exists while a tile is held: a permanent, disabled
    // circle in the middle of the table is noise that promises a move the
    // player cannot make.
    const canTryFinish = finishing && this.game.selected !== null;
    return h(
      'div',
      { class: 'center' },
      h(
        'button',
        {
          class: `pile${low ? ' low' : ''}${this.tourStep()?.target === 'pile' ? ' tour' : ''}`,
          'data-action': 'draw',
          'data-key': 'draw',
          disabled: !canDraw(r, HUMAN),
          'aria-label': `${t.pile}: ${r.pile.length}${low ? ` (${t.pileLow})` : ''}`,
        },
        h('span', { class: 'tile back' }),
        h('span', { class: 'pile-count' }, String(r.pile.length)),
      ),
      // With the Show button the caption becomes a tall tap target; landscape puts it beside the tile.
      h('div', { class: `indicator${canShowIndicator(r, HUMAN) ? ' has-action' : ''}` }, this.tile(r.indicator), this.indicatorCaption()),
      canTryFinish
        ? h('button', { class: 'finish target', 'data-action': 'finish', 'data-drop': 'finish', 'data-key': 'finish' }, t.finish)
        : null,
    );
  }

  /** "Gösterge", a Show button while the player may show it, or who showed it. */
  private indicatorCaption(): HTMLElement {
    const r = this.game.round;
    const t = this.t;
    if (r.indicatorShownBy !== null) {
      const text = r.indicatorShownBy === HUMAN ? t.indicatorShownByYou : t.indicatorShownBy(this.seatName(r.indicatorShownBy));
      return h('span', { class: 'caption shown' }, text);
    }
    if (canShowIndicator(r, HUMAN)) {
      return h('button', { class: 'chip show', 'data-action': 'show-indicator', 'data-key': 'show-indicator', 'aria-label': t.showIndicatorLabel, title: t.showIndicatorLabel }, t.showIndicator);
    }
    return h('span', { class: 'caption' }, t.indicator);
  }

  /** The hand's clock: minutes and seconds, without the paused time. */
  private clockText(): string {
    const seconds = Math.floor(this.game.handElapsedMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return `${minutes}:${String(rest).padStart(2, '0')}`;
  }

  /** Updates only the clock; the tick must not redraw the whole table. */
  updateClock(): void {
    const clock = this.root.querySelector<HTMLElement>('.clock');
    if (clock) clock.textContent = this.clockText();
  }

  /**
   * What the first-hand guide asks of the player right now, and what on the table to light up for it.
   * Null when the guide is over, when it is not the player's move, or when the step has nothing to say
   * (a tile held for the last throw is the finish prompt's business).
   */
  private tourStep(): { text: 'tourPick' | 'tourDrop' | 'tourDraw' | 'tourGoal'; target: 'rack' | 'discard' | 'pile' } | null {
    const { tour, round: r, selected } = this.game;
    if (tour === null || r.turn !== HUMAN) return null;
    if (r.phase === 'draw') return { text: 'tourDraw', target: 'pile' };
    if (tour === 0) return selected !== null ? { text: 'tourDrop', target: 'discard' } : { text: 'tourPick', target: 'rack' };
    if (tour === 2 && selected === null) return { text: 'tourGoal', target: 'rack' };
    return null;
  }

  private statusText(): string {
    const { round: r, notice } = this.game;
    const t = this.t;
    if (r.phase === 'roundOver') return '';
    if (notice?.kind === 'invalidFinish') return t.invalidFinish;
    if (notice?.kind === 'indicatorShown') return notice.seat === HUMAN ? t.youShowedIndicator : t.indicatorNotice(this.seatName(notice.seat));
    if (notice?.kind === 'noAd') return t.noAd;
    if (this.game.hintTileId !== null) return t.hintShown(this.game.hintAway);
    const tour = this.tourStep();
    if (tour) return t[tour.text];
    if (r.turn === HUMAN) {
      if (r.phase === 'draw') return t.drawPrompt;
      // The finish zone only exists while a tile is held, so the prompt follows
      // the board instead of advertising a move that is not on screen.
      return this.game.selected !== null ? t.finishPrompt : t.discardPrompt;
    }
    return t.waiting(this.seatName(r.turn));
  }

  private toolbar(): HTMLElement {
    const t = this.t;
    const { match } = this.game;
    return h(
      'div',
      { class: 'toolbar' },
      h(
        'div',
        { class: 'tools' },
        h(
          'details',
          { class: 'menu' },
          h('summary', { class: 'chip', 'data-key': 'arrange' }, t.arrange),
          h(
            'div',
            { class: 'menu-list' },
            h('button', { class: 'chip', 'data-action': 'sort-melds', 'data-key': 'sort-melds' }, t.sortMelds),
            h('button', { class: 'chip', 'data-action': 'sort-runs', 'data-key': 'sort-runs' }, t.sortRuns),
            h('button', { class: 'chip', 'data-action': 'sort-pairs', 'data-key': 'sort-pairs' }, t.sortPairs),
            h('button', { class: 'chip', 'data-action': 'clear-arrange', 'data-key': 'clear-arrange' }, t.clearArrange),
          ),
        ),
      ),
      h(
        'div',
        { class: 'tools' },
        h('div', { class: 'hand-value', title: t.handValueHint }, h('b', {}, String(this.game.handValue)), h('span', { class: 'unit' }, t.handValueShort)),
      ),
      // How many complete sets and runs the hand already holds.
      h(
        'div',
        { class: 'tools' },
        h(
          'div',
          { class: `meld-count${this.game.melds.length ? ' has' : ''}`, title: t.meldHint },
          '✓ ',
          h('b', {}, String(this.game.melds.length)),
        ),
      ),
      // The menu: a new match, the settings, the numbers.
      h('button', { class: 'chip help', 'data-action': 'open-menu', 'data-key': 'open-menu', 'aria-label': t.menuLabel, title: t.menuLabel }, '☰'),
      // While the result is up the hand counter already includes it; show the hand it was.
      h(
        'div',
        { class: 'score' },
        this.game.dailyActive
          ? t.dailyBadge
          : t.yourPoints(match.points[HUMAN], this.game.round.phase === 'roundOver' ? match.hands : match.hands + 1),
      ),
    );
  }

  /**
   * The rack shows only the tiles that are on it. Free slots stay invisible and
   * group breaks are thin gaps, so the eye reads "one run, one set" instead of
   * a grid of empty boxes.
   */
  private rack(): HTMLElement {
    const hand = this.game.round.hands[HUMAN];
    const byId = new Map(hand.map((tile) => [tile.id, tile]));
    const children: Child[] = [];
    // Only the used part of the rack is drawn. The trailing empty slots used to
    // be rendered as invisible cells, which still took a full tile width each
    // and pushed the hand off the bottom of the screen.
    const used = this.rackSlots();
    const drawn = new Set<number>();
    for (let slot = 0; slot < used; slot++) {
      const id = this.game.rack[slot];
      if (id === GROUP_BREAK) {
        children.push(h('div', { class: 'slot gap', 'data-drop': 'slot', 'data-slot': slot }));
        continue;
      }
      if (id === null) {
        // Invisible drop space, so a tile can still be parked here.
        children.push(h('div', { class: 'slot empty', 'data-drop': 'slot', 'data-slot': slot }));
        continue;
      }
      const tile = byId.get(id);
      // The deal cascades: each tile lands a beat after the one before it.
      if (tile) {
        drawn.add(id);
        children.push(this.tile(tile, true, slot));
      }
    }
    // A tile in the hand but not on the rack still has to be seen.
    for (const tile of hand) {
      if (!drawn.has(tile.id)) children.push(this.tile(tile, true, used));
    }
    return h('div', { class: `rack${this.tourStep()?.target === 'rack' ? ' tour' : ''}` }, ...children);
  }

  private tile(tile: Tile, onRack = false, order = 0): HTMLElement {
    const g = this.game;
    const fake = tile.kind === 'fake';
    const wild = resolve(tile, g.round.okey).wild;
    const selected = onRack && g.selected === tile.id;
    const fresh = onRack && g.lastDrawn === tile.id;
    const melded = onRack && this.meldedIds.has(tile.id);
    const hinted = onRack && g.hintTileId === tile.id;
    const cls = [
      'tile',
      fake && 'fake',
      wild && 'wild',
      melded && 'melded',
      hinted && 'hinted',
      selected && 'selected',
      fresh && 'fresh',
      g.dealing && 'dealing',
      g.discardingId === tile.id && 'discarding',
    ]
      .filter(Boolean)
      .join(' ');
    const body = [
      h('span', { class: 'value' }, fake ? '★' : String(tile.value)),
      h('span', { class: 'mark', 'aria-hidden': 'true' }, fake ? '' : COLOR_MARKS[tile.color]),
    ];
    const attrs: Attrs = { class: cls, 'data-color': fake ? undefined : tile.color, 'aria-label': this.describe(tile) };
    if (!onRack) return h('span', { ...attrs, role: 'img' }, ...body);
    return h('button', { ...attrs, style: `--i:${order}`, 'data-tile-id': tile.id, 'data-key': `tile-${tile.id}`, 'aria-pressed': String(selected) }, ...body);
  }

  private describe(tile: Tile): string {
    if (tile.kind === 'fake') return this.t.fakeOkey;
    const wild = resolve(tile, this.game.round.okey).wild;
    return `${this.t.colors[tile.color]} ${tile.value}${wild ? ` (${this.t.okey})` : ''}`;
  }

  /** The one-time rules card. It can be reopened from the menu. */
  private coach(): HTMLElement {
    const t = this.t;
    const points = [t.coachDraw, t.coachDiscard, t.coachSets, t.coachOkey, t.coachMeld];
    return h(
      'div',
      { class: 'modal-backdrop' },
      h(
        'div',
        { class: 'modal coach', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'coach-title' },
        h(
          'div',
          { class: 'modal-body' },
          h('h2', { id: 'coach-title' }, t.coachTitle),
          h('ul', { class: 'coach-list' }, ...points.map((point) => h('li', {}, point))),
          ...this.settingsSection(),
        ),
        h('button', { class: 'primary', 'data-action': 'close-coach', 'data-key': 'close-coach' }, t.coachStart),
      ),
    );
  }

  /**
   * The menu: everything the player reaches for outside a turn. A new match,
   * the table settings and the running numbers, in one place.
   */
  private menu(): HTMLElement {
    const t = this.t;
    const { stats } = this.game;
    return h(
      'div',
      { class: 'modal-backdrop' },
      h(
        'div',
        { class: 'modal coach menu', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'menu-title' },
        h(
          'div',
          { class: 'modal-body' },
          h('h2', { id: 'menu-title' }, t.menu),
          this.dailyButton(),
          h(
            'button',
            {
              class: 'chip new-match',
              'data-action': 'new-match',
              'data-key': 'new-match',
              title: t.newMatchHint,
              // The match is set aside while the daily deal is played.
              disabled: this.game.dailyActive,
            },
            t.newMatch,
          ),
          ...this.settingsSection(),
          // The running numbers.
          h('p', { class: 'lifetime' }, t.lifetime(stats.won, stats.played, stats.matchesWon, stats.matchesPlayed)),
          h('button', { class: 'chip', 'data-action': 'open-stats', 'data-key': 'open-stats' }, t.statsTitle),
          h('button', { class: 'chip', 'data-action': 'open-coach', 'data-key': 'open-coach' }, t.coachHelp),
        ),
        h('button', { class: 'primary', 'data-action': 'close-menu', 'data-key': 'close-menu' }, t.closeMenu),
      ),
    );
  }

  /** The daily deal: play it, carry on with it, or see how today's went. */
  private dailyButton(): HTMLElement {
    const t = this.t;
    const { daily, dailyActive, dailyDoneToday } = this.game;
    const label = dailyActive ? t.dailyContinue : dailyDoneToday ? (daily.lastWon ? t.dailyDoneWon : t.dailyDoneLost) : t.dailyPlay;
    return h(
      'button',
      {
        class: 'chip daily',
        'data-action': 'daily',
        'data-key': 'daily',
        title: t.dailyHint,
        disabled: dailyDoneToday && !dailyActive,
      },
      label,
    );
  }

  /** Everything the game has counted, in one place. */
  private statsModal(): HTMLElement {
    const t = this.t;
    const { stats, daily } = this.game;
    const rate = stats.played > 0 ? `${Math.round((stats.won / stats.played) * 100)}%` : '–';
    const rows: [string, string][] = [
      [t.statHandsWon, `${stats.won} / ${stats.played}`],
      [t.statWinRate, rate],
      [t.statMatchesWon, `${stats.matchesWon} / ${stats.matchesPlayed}`],
      [t.statStreak, String(stats.streak)],
      [t.statBestStreak, String(stats.bestStreak)],
      [t.statPairs, String(stats.pairsWon)],
      [t.statOkey, String(stats.okeyWon)],
      [t.statFastest, stats.fastestWin > 0 ? t.statTurns(stats.fastestWin) : '–'],
      [t.statDrawn, String(stats.drawn)],
      [t.statDailyWon, `${daily.won} / ${daily.played}`],
      [t.statDailyStreak, String(daily.streak)],
      [t.statDailyBest, String(daily.best)],
    ];
    return h(
      'div',
      { class: 'modal-backdrop' },
      h(
        'div',
        { class: 'modal coach menu', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'stats-title' },
        h(
          'div',
          { class: 'modal-body' },
          h('h2', { id: 'stats-title' }, t.statsTitle),
          h(
            'dl',
            { class: 'stats' },
            ...rows.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)]),
          ),
        ),
        h('button', { class: 'primary', 'data-action': 'close-stats', 'data-key': 'close-stats' }, t.statsBack),
      ),
    );
  }

  /** The table settings, shared by the rules card and the menu. */
  private settingsSection(): HTMLElement[] {
    const t = this.t;
    const levels: Difficulty[] = ['easy', 'normal', 'hard'];
    return [
      // How sharp the computer opponents are.
      h(
        'div',
        { class: 'difficulty' },
        h('span', { class: 'label' }, t.difficultyLabel),
        ...levels.map((level) =>
          h(
            'button',
            {
              class: `chip${this.game.difficulty === level ? ' on' : ''}`,
              'data-action': 'difficulty',
              'data-level': level,
              'data-key': `difficulty-${level}`,
              'aria-pressed': String(this.game.difficulty === level),
            },
            t.difficulty[level],
          ),
        ),
      ),
      // How long the opponents take over a move.
      h(
        'div',
        { class: 'difficulty' },
        h('span', { class: 'label' }, t.paceLabel),
        ...(['relaxed', 'quick'] as const).map((pace) =>
          h(
            'button',
            {
              class: `chip${this.game.botPace === pace ? ' on' : ''}`,
              'data-action': 'bot-pace',
              'data-pace': pace,
              'data-key': `pace-${pace}`,
              'aria-pressed': String(this.game.botPace === pace),
            },
            t.pace[pace],
          ),
        ),
      ),
      // The colours of the tiles: the standard set, or one made to tell apart for colour-blind players.
      h(
        'div',
        { class: 'difficulty' },
        h('span', { class: 'label' }, t.paletteLabel),
        ...(['standard', 'colorblind'] as const).map((palette) =>
          h(
            'button',
            {
              class: `chip${this.game.palette === palette ? ' on' : ''}`,
              'data-action': 'palette',
              'data-palette': palette,
              'data-key': `palette-${palette}`,
              'aria-pressed': String(this.game.palette === palette),
            },
            t.palette[palette],
          ),
        ),
      ),
      // How long a match runs: it applies to the next match.
      h(
        'div',
        { class: 'difficulty' },
        h('span', { class: 'label' }, t.matchLengthLabel),
        ...MATCH_LENGTHS.map(([id, start]) =>
          h(
            'button',
            {
              class: `chip${this.game.matchStart === start ? ' on' : ''}`,
              'data-action': 'match-length',
              'data-start': String(start),
              'data-key': `match-${id}`,
              'aria-pressed': String(this.game.matchStart === start),
            },
            t.matchLength[id],
          ),
        ),
      ),
      // The colored okey: a red or black indicator makes the okey count double.
      h(
        'div',
        { class: 'difficulty' },
        h('span', { class: 'label' }, t.coloredOkeyLabel),
        h(
          'button',
          {
            class: `chip${this.game.coloredOkey ? ' on' : ''}`,
            'data-action': 'colored-okey',
            'data-key': 'colored-okey',
            'aria-pressed': String(this.game.coloredOkey),
          },
          this.game.coloredOkey ? t.on : t.off,
        ),
      ),
      // A hand finished with all its tiles in one colour.
      h(
        'div',
        { class: 'difficulty' },
        h('span', { class: 'label' }, t.singleColorLabel),
        h(
          'button',
          {
            class: `chip${this.game.singleColor ? ' on' : ''}`,
            'data-action': 'single-color',
            'data-key': 'single-color',
            'aria-pressed': String(this.game.singleColor),
          },
          this.game.singleColor ? t.on : t.off,
        ),
      ),
    ];
  }

  /** The daily deal's result: a win or not, the day streak, and the way back to the match. */
  private dailyResultModal(): HTMLElement {
    const { round: r, daily } = this.game;
    const t = this.t;
    const title = r.winner === null ? t.drawnRound : r.winner === HUMAN ? t.youWon : t.someoneWon(this.seatName(r.winner));
    const detail = r.winKind ? t.finishedWith(r.winKind === 'pairs', finishedWithOkey(r)) : '';
    return h(
      'div',
      { class: 'modal-backdrop' },
      h(
        'div',
        { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'result-title' },
        h(
          'div',
          { class: 'modal-body' },
          h('p', { class: 'match-over' }, t.dailyBadge),
          h('h2', { id: 'result-title' }, title),
          detail && h('p', { class: 'detail' }, detail),
          r.winner !== null && h('div', { class: 'hand' }, ...this.winningHand(r.winner)),
          h('p', { class: 'lifetime' }, t.dailyStreakLine(daily.streak, daily.best)),
          h('p', { class: 'rule' }, t.dailyTomorrow),
        ),
        h('button', { class: 'primary', 'data-action': 'next-hand', 'data-key': 'next-hand' }, t.dailyBack),
      ),
    );
  }

  private resultModal(): HTMLElement {
    if (this.game.dailyActive) return this.dailyResultModal();
    const { round: r, stats, match, matchOver, seed } = this.game;
    const t = this.t;
    const title = r.winner === null ? t.drawnRound : r.winner === HUMAN ? t.youWon : t.someoneWon(this.seatName(r.winner));
    const detail = r.winKind ? t.finishedWith(r.winKind === 'pairs', finishedWithOkey(r)) : '';
    const leaders = matchLeaders(match);
    const others = this.joinNames(leaders.filter((seat) => seat !== HUMAN).map((seat) => this.seatName(seat)));
    const matchTitle = !leaders.includes(HUMAN) ? t.matchOverOther(others) : others ? t.matchOverYouAnd(others) : t.matchOverYou;
    // Header and body scroll on short screens; the button below always stays visible.
    return h(
      'div',
      { class: 'modal-backdrop' },
      h(
        'div',
        { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'result-title' },
        h(
          'div',
          { class: 'modal-body' },
          matchOver && h('p', { class: 'match-over' }, matchTitle),
          h('h2', { id: 'result-title' }, title),
          detail && h('p', { class: 'detail' }, detail),
          // A hand finished in one colour is worth double, so it is worth saying.
          isSingleColorHand(r) && h('p', { class: 'single-color' }, t.singleColorDone),
          r.winner !== null && h('div', { class: 'hand' }, ...this.winningHand(r.winner)),
          this.scoreTable(matchOver ? leaders : []),
          h('p', { class: 'rule' }, t.matchRule(START_POINTS)),
          h('p', { class: 'lifetime' }, t.lifetime(stats.won, stats.played, stats.matchesWon, stats.matchesPlayed)),
          // The seed makes the deal reproducible: the hand can be checked, not trusted.
          seed !== null && h('p', { class: 'seed' }, `${t.handSeed}: ${seed}`),
        ),
        h('button', { class: 'primary', 'data-action': 'next-hand', 'data-key': 'next-hand' }, matchOver ? t.newMatch : t.nextHand),
      ),
    );
  }

  /** Each player's loss this hand and running total; the hand's winner and match leaders are marked. */
  private scoreTable(leaders: number[]): HTMLElement {
    const { round: r, match, lastPenalties } = this.game;
    const [player, hand, points] = this.t.scoreHeader;
    const rows = Array.from({ length: SEATS }, (_, seat) => {
      const lost = lastPenalties?.[seat] ?? 0;
      const cls = [seat === r.winner && 'winner', leaders.includes(seat) && 'leader', match.points[seat] <= 0 && 'out'].filter(Boolean).join(' ');
      return h(
        'tr',
        { class: cls || undefined },
        h('th', { scope: 'row' }, this.seatName(seat)),
        h('td', {}, lost > 0 ? `−${lost}` : '0'),
        h('td', {}, String(match.points[seat])),
      );
    });
    return h(
      'table',
      { class: 'scores' },
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, player), h('th', { scope: 'col' }, hand), h('th', { scope: 'col' }, points))),
      h('tbody', {}, ...rows),
    );
  }

  private joinNames(names: string[]): string {
    return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${this.t.and} ${names.at(-1)}`;
  }

  /** The winner's tiles split into the melds or pairs that make it a win, each wild in place. */
  private winningHand(seat: number): HTMLElement[] {
    const r = this.game.round;
    const groups = winningGroups(r.hands[seat], r.okey)?.groups ?? this.looseGroups(r.hands[seat]);
    return groups.map((group) => h('span', { class: 'meld' }, ...group.map((tile) => this.tile(tile))));
  }

  /**
   * The hand did not win (the pile ran out). It is shown in rows of seven so a
   * long row cannot push the dialog off the screen.
   */
  private looseGroups(hand: readonly Tile[]): Tile[][] {
    const groups: Tile[][] = [];
    for (let i = 0; i < hand.length; i += 7) groups.push(hand.slice(i, i + 7));
    return groups;
  }

  // ---- Input ------------------------------------------------------------------

  private onClick(e: MouseEvent): void {
    if (performance.now() < this.ignoreClicksUntil) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-action], [data-tile-id]');
    if (!target) return;
    const g = this.game;
    if (target.dataset.tileId !== undefined) {
      g.toggleSelect(Number(target.dataset.tileId));
      return;
    }
    switch (target.dataset.action) {
      case 'draw':
        g.humanDraw();
        break;
      case 'take':
        g.humanTakeDiscard();
        break;
      case 'show-indicator':
        g.humanShowIndicator();
        break;
      case 'discard':
        if (g.selected !== null) g.humanDiscard(g.selected);
        break;
      case 'finish':
        if (g.selected !== null) g.humanFinish(g.selected);
        break;
      case 'sort-runs':
        g.sortRuns();
        this.closeMenu();
        break;
      case 'sort-pairs':
        g.sortPairs();
        this.closeMenu();
        break;
      case 'sort-melds':
        g.sortMelds();
        this.closeMenu();
        break;
      case 'clear-arrange':
        g.clearArrange();
        this.closeMenu();
        break;
      case 'close-coach':
        g.closeCoach();
        break;
      case 'open-menu':
        g.openMenu();
        break;
      case 'close-menu':
        g.closeMenu();
        break;
      case 'daily':
        g.startDaily();
        break;
      case 'open-stats':
        g.openStats();
        break;
      case 'close-stats':
        g.closeStats();
        break;
      case 'new-match':
        g.newMatch();
        break;
      case 'open-coach':
        g.closeMenu();
        g.openCoach();
        break;
      case 'hint':
        void g.requestHint();
        break;
      case 'difficulty':
        g.setDifficulty(target.dataset.level as Difficulty);
        break;
      case 'palette':
        g.setPalette(target.dataset.palette === 'colorblind' ? 'colorblind' : 'standard');
        break;
      case 'bot-pace':
        g.setBotPace(target.dataset.pace === 'quick' ? 'quick' : 'relaxed');
        break;
      case 'match-length':
        g.setMatchStart(Number(target.dataset.start));
        break;
      case 'colored-okey':
        g.setColoredOkey(!g.coloredOkey);
        break;
      case 'single-color':
        g.setSingleColor(!g.singleColor);
        break;
      case 'next-hand':
        void g.nextHand();
        break;
    }
  }

  private closeMenu(): void {
    this.root.querySelectorAll<HTMLDetailsElement>('details.menu[open]').forEach((d) => {
      d.open = false;
    });
  }

  private onKey(e: KeyboardEvent): void {
    const g = this.game;
    // Never preventDefault on Escape: Playables relies on it.
    if (e.key === 'Escape') {
      if (g.round.phase === 'roundOver') void g.nextHand();
      return;
    }
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    if (!keys.includes(e.key)) return;
    if (g.round.phase === 'roundOver') return;
    const rows = this.rackRows();
    if (rows.length === 0) return;
    e.preventDefault();

    // The rack wraps into rows, so the arrows follow what the eye sees.
    const current = g.selected;
    let row = 0;
    let column = 0;
    if (current !== null) {
      const found = rows.findIndex((ids) => ids.includes(current));
      if (found !== -1) {
        row = found;
        column = rows[found].indexOf(current);
      }
    }
    let nextRow = row;
    let nextColumn = column;
    if (e.key === 'ArrowRight') {
      nextColumn = column + 1;
      if (nextColumn >= rows[row].length) {
        nextRow = (row + 1) % rows.length;
        nextColumn = 0;
      }
    } else if (e.key === 'ArrowLeft') {
      nextColumn = column - 1;
      if (nextColumn < 0) {
        nextRow = (row - 1 + rows.length) % rows.length;
        nextColumn = rows[nextRow].length - 1;
      }
    } else if (e.key === 'ArrowDown') {
      nextRow = (row + 1) % rows.length;
      nextColumn = Math.min(column, rows[nextRow].length - 1);
    } else {
      nextRow = (row - 1 + rows.length) % rows.length;
      nextColumn = Math.min(column, rows[nextRow].length - 1);
    }
    const id = rows[nextRow][nextColumn];
    g.select(id);
    this.root.querySelector<HTMLElement>(`[data-key="tile-${id}"]`)?.focus({ preventScroll: true });
  }

  /** The rack's tiles grouped by the row they are drawn on. */
  private rackRows(): number[][] {
    const rows: number[][] = [];
    let lastTop = -1;
    for (const el of this.root.querySelectorAll<HTMLElement>('.rack [data-tile-id]')) {
      const top = el.offsetTop;
      if (top !== lastTop) {
        rows.push([]);
        lastTop = top;
      }
      rows[rows.length - 1].push(Number(el.dataset.tileId));
    }
    return rows;
  }

  private onPointerDown(e: PointerEvent): void {
    if (e.button !== 0 || this.drag) return;
    const source = (e.target as HTMLElement).closest<HTMLElement>('.rack [data-tile-id]');
    if (!source) return;
    source.setPointerCapture(e.pointerId);
    this.drag = { tileId: Number(source.dataset.tileId), pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, source, ghost: null, hover: null };
  }

  private onPointerMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.ghost) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
      d.ghost = d.source.cloneNode(true) as HTMLElement;
      d.ghost.classList.remove('selected', 'fresh');
      d.ghost.classList.add('ghost');
      d.ghost.removeAttribute('data-key');
      this.root.append(d.ghost);
      d.source.classList.add('drag-source');
    }
    d.ghost.style.transform = `translate(${e.clientX - d.ghost.offsetWidth / 2}px, ${e.clientY - d.ghost.offsetHeight * 0.6}px) scale(1.08)`;
    const drop = this.dropTargetAt(e.clientX, e.clientY);
    if (drop !== d.hover) {
      d.hover?.classList.remove('hover');
      drop?.classList.add('hover');
      d.hover = drop;
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const dragged = d.ghost !== null;
    const drop = dragged ? this.dropTargetAt(e.clientX, e.clientY) : null;
    if (dragged) this.ignoreClicksUntil = performance.now() + CLICK_AFTER_DRAG_MS;
    this.endDrag();
    if (!drop) return;
    const g = this.game;
    switch (drop.dataset.drop) {
      case 'slot':
        g.moveInRack(d.tileId, Number(drop.dataset.slot));
        break;
      case 'discard':
        g.humanDiscard(d.tileId);
        break;
      case 'finish':
        g.humanFinish(d.tileId);
        break;
    }
  }

  private endDrag(): void {
    const d = this.drag;
    if (!d) return;
    d.ghost?.remove();
    d.hover?.classList.remove('hover');
    d.source.classList.remove('drag-source');
    this.drag = null;
    if (this.dirty) this.render();
  }

  private dropTargetAt(x: number, y: number): HTMLElement | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.closest<HTMLElement>('[data-drop]') ?? null;
  }
}
