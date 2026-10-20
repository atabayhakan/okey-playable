import { HUMAN, type Controller } from '../app/controller';
import { RACK_SLOTS } from '../app/rack';
import { canDraw, canShowIndicator, canTakeDiscard, previousSeat, SEATS } from '../core/game';
import { winningGroups } from '../core/hand';
import { finishedWithOkey, matchLeaders, START_POINTS } from '../core/scoring';
import { resolve, type Color, type Tile } from '../core/tile';
import type { Strings } from '../i18n';

const DRAG_THRESHOLD_PX = 6;
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
  }

  render(): void {
    // Re-rendering mid-drag would destroy the dragged tile; catch up when it ends.
    if (this.drag) {
      this.dirty = true;
      return;
    }
    this.dirty = false;
    const focusedKey = (document.activeElement as HTMLElement | null)?.dataset?.key;
    const modal = this.game.round.phase === 'roundOver' ? this.resultModal() : null;
    this.root.replaceChildren(this.table(), ...(modal ? [modal] : []));
    this.fit();
    if (modal) {
      modal.querySelector<HTMLElement>('[data-action="next-hand"]')?.focus({ preventScroll: true });
    } else if (focusedKey) {
      const el = this.root.querySelector<HTMLButtonElement>(`[data-key="${focusedKey}"]`);
      if (el && !el.disabled) el.focus({ preventScroll: true });
    }
  }

  // ---- Layout ---------------------------------------------------------------

  /** Size tiles to the viewport: a 2x15 rack in landscape, 3x10 in portrait. */
  private fit(): void {
    const width = this.root.clientWidth;
    const height = this.root.clientHeight;
    if (!width || !height) return;
    const portrait = height > width;
    const cols = portrait ? 10 : 15;
    const rows = RACK_SLOTS / cols;
    const rackUnits = rows * 1.38 * 1.06 + 0.4;
    const byWidth = (width - 16) / (cols * 1.06 + 0.5);
    const byHeight = (height * (portrait ? 0.32 : 0.36)) / rackUnits;
    const tileW = clamp(Math.floor(Math.min(byWidth, byHeight)), 16, 64);
    const boardHeight = height - tileW * rackUnits - 72;
    const boardTileW = clamp(Math.floor(boardHeight / 6), 14, tileW);
    this.root.style.setProperty('--tile-w', `${tileW}px`);
    this.root.style.setProperty('--btw', `${boardTileW}px`);
    this.root.style.setProperty('--cols', String(cols));
    this.root.dataset.orientation = portrait ? 'portrait' : 'landscape';
  }

  // ---- Building blocks --------------------------------------------------------

  private table(): HTMLElement {
    return h(
      'div',
      { class: 'table' },
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
        h('div', { class: `status${this.game.notice ? ` notice ${this.game.notice.kind}` : ''}`, role: 'status', 'aria-live': 'polite' }, this.statusText()),
        this.discardPile(0, 'br'),
      ),
      this.toolbar(),
      this.rack(),
    );
  }

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
      return h('button', { class: `discard ${area}${takeable ? ' takeable' : ''}`, 'data-action': 'take', 'data-key': 'take', disabled: !takeable, 'aria-label': label }, face);
    }
    if (seat === HUMAN) {
      const active = this.game.humanMustDiscard;
      return h('button', { class: `discard ${area}${active ? ' target' : ''}`, 'data-action': 'discard', 'data-drop': 'discard', 'data-key': 'discard', disabled: !active, 'aria-label': this.t.discardHere }, face);
    }
    return h('div', { class: `discard ${area}` }, face);
  }

  private center(): HTMLElement {
    const r = this.game.round;
    const t = this.t;
    const finishing = this.game.humanMustDiscard;
    return h(
      'div',
      { class: 'center' },
      h(
        'button',
        { class: 'pile', 'data-action': 'draw', 'data-key': 'draw', disabled: !canDraw(r, HUMAN), 'aria-label': `${t.pile}: ${r.pile.length}` },
        h('span', { class: 'tile back' }),
        h('span', { class: 'pile-count' }, String(r.pile.length)),
      ),
      h('div', { class: 'indicator' }, this.tile(r.indicator), this.indicatorCaption()),
      h('button', { class: `finish${finishing ? ' target' : ''}`, 'data-action': 'finish', 'data-drop': 'finish', 'data-key': 'finish', disabled: !finishing }, t.finish),
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

  private statusText(): string {
    const { round: r, notice } = this.game;
    const t = this.t;
    if (r.phase === 'roundOver') return '';
    if (notice?.kind === 'invalidFinish') return t.invalidFinish;
    if (notice?.kind === 'indicatorShown') return notice.seat === HUMAN ? t.youShowedIndicator : t.indicatorNotice(this.seatName(notice.seat));
    if (r.turn === HUMAN) return r.phase === 'draw' ? t.drawPrompt : t.discardPrompt;
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
        h('button', { class: 'chip', 'data-action': 'sort-runs', 'data-key': 'sort-runs' }, t.sortRuns),
        h('button', { class: 'chip', 'data-action': 'sort-pairs', 'data-key': 'sort-pairs' }, t.sortPairs),
      ),
      // While the result is up the hand counter already includes it; show the hand it was.
      h('div', { class: 'score' }, t.yourPoints(match.points[HUMAN], this.game.round.phase === 'roundOver' ? match.hands : match.hands + 1)),
    );
  }

  private rack(): HTMLElement {
    const byId = new Map(this.game.round.hands[HUMAN].map((tile) => [tile.id, tile]));
    return h(
      'div',
      { class: 'rack' },
      ...this.game.rack.map((id, slot) => {
        const tile = id === null ? undefined : byId.get(id);
        return h('div', { class: 'slot', 'data-drop': 'slot', 'data-slot': slot }, tile && this.tile(tile, true));
      }),
    );
  }

  private tile(tile: Tile, onRack = false): HTMLElement {
    const g = this.game;
    const fake = tile.kind === 'fake';
    const wild = resolve(tile, g.round.okey).wild;
    const selected = onRack && g.selected === tile.id;
    const cls = ['tile', fake && 'fake', wild && 'wild', selected && 'selected', onRack && g.lastDrawn === tile.id && 'fresh'].filter(Boolean).join(' ');
    const body = [
      h('span', { class: 'value' }, fake ? '★' : String(tile.value)),
      h('span', { class: 'mark', 'aria-hidden': 'true' }, fake ? '' : COLOR_MARKS[tile.color]),
    ];
    const attrs: Attrs = { class: cls, 'data-color': fake ? undefined : tile.color, 'aria-label': this.describe(tile) };
    if (!onRack) return h('span', { ...attrs, role: 'img' }, ...body);
    return h('button', { ...attrs, 'data-tile-id': tile.id, 'data-key': `tile-${tile.id}`, 'aria-pressed': String(selected) }, ...body);
  }

  private describe(tile: Tile): string {
    if (tile.kind === 'fake') return this.t.fakeOkey;
    const wild = resolve(tile, this.game.round.okey).wild;
    return `${this.t.colors[tile.color]} ${tile.value}${wild ? ` (${this.t.okey})` : ''}`;
  }

  private resultModal(): HTMLElement {
    const { round: r, stats, match, matchOver } = this.game;
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
          r.winner !== null && h('div', { class: 'hand' }, ...this.winningHand(r.winner)),
          this.scoreTable(matchOver ? leaders : []),
          h('p', { class: 'rule' }, t.matchRule(START_POINTS)),
          h('p', { class: 'lifetime' }, t.lifetime(stats.won, stats.played, stats.matchesWon, stats.matchesPlayed)),
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
    const groups = winningGroups(r.hands[seat], r.okey)?.groups ?? [r.hands[seat]];
    return groups.map((group) => h('span', { class: 'meld' }, ...group.map((tile) => this.tile(tile))));
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
        break;
      case 'sort-pairs':
        g.sortPairs();
        break;
      case 'next-hand':
        void g.nextHand();
        break;
    }
  }

  private onKey(e: KeyboardEvent): void {
    const g = this.game;
    // Never preventDefault on Escape: Playables relies on it.
    if (e.key === 'Escape') {
      if (g.round.phase === 'roundOver') void g.nextHand();
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (g.round.phase === 'roundOver') return;
    const ids = g.rack.filter((id): id is number => id !== null);
    if (ids.length === 0) return;
    e.preventDefault();
    const i = g.selected === null ? -1 : ids.indexOf(g.selected);
    const next = e.key === 'ArrowRight' ? (i + 1) % ids.length : i <= 0 ? ids.length - 1 : i - 1;
    g.select(ids[next]);
    this.root.querySelector<HTMLElement>(`[data-key="tile-${ids[next]}"]`)?.focus({ preventScroll: true });
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
