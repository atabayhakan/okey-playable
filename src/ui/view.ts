import { HUMAN, type Controller } from '../app/controller';
import { RACK_SLOTS } from '../app/rack';
import { canDraw, canTakeDiscard, previousSeat } from '../core/game';
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
        h('div', { class: `status${this.game.notice ? ' notice' : ''}`, role: 'status', 'aria-live': 'polite' }, this.statusText()),
        this.discardPile(0, 'br'),
      ),
      this.toolbar(),
      this.rack(),
    );
  }

  private seat(seat: number, area: string): HTMLElement {
    const r = this.game.round;
    const name = this.t.botNames[seat - 1];
    const active = r.turn === seat && r.phase !== 'roundOver';
    return h(
      'div',
      { class: `seat ${area}${active ? ' active' : ''}` },
      h('div', { class: 'avatar', 'aria-hidden': 'true' }, name[0]),
      h('div', { class: 'name' }, name),
      h('div', { class: 'count' }, this.t.tiles(r.hands[seat].length)),
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
      h('div', { class: 'indicator' }, this.tile(r.indicator), h('span', { class: 'caption' }, t.indicator)),
      h('button', { class: `finish${finishing ? ' target' : ''}`, 'data-action': 'finish', 'data-drop': 'finish', 'data-key': 'finish', disabled: !finishing }, t.finish),
    );
  }

  private statusText(): string {
    const { round: r, notice } = this.game;
    if (r.phase === 'roundOver') return '';
    if (notice === 'invalidFinish') return this.t.invalidFinish;
    if (r.turn === HUMAN) return r.phase === 'draw' ? this.t.drawPrompt : this.t.discardPrompt;
    return this.t.waiting(this.t.botNames[r.turn - 1]);
  }

  private toolbar(): HTMLElement {
    const t = this.t;
    return h(
      'div',
      { class: 'toolbar' },
      h(
        'div',
        { class: 'tools' },
        h('button', { class: 'chip', 'data-action': 'sort-runs', 'data-key': 'sort-runs' }, t.sortRuns),
        h('button', { class: 'chip', 'data-action': 'sort-pairs', 'data-key': 'sort-pairs' }, t.sortPairs),
      ),
      h('div', { class: 'score' }, t.stats(this.game.stats.won, this.game.stats.played)),
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
    const { round: r, stats } = this.game;
    const t = this.t;
    const title = r.winner === null ? t.drawnRound : r.winner === HUMAN ? t.youWon : t.someoneWon(t.botNames[r.winner - 1]);
    const detail = r.winKind === 'pairs' ? t.byPairs : r.winKind === 'sets' ? t.bySets : '';
    return h(
      'div',
      { class: 'modal-backdrop' },
      h(
        'div',
        { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'result-title' },
        h('h2', { id: 'result-title' }, title),
        detail && h('p', { class: 'detail' }, detail),
        r.winner !== null && h('div', { class: 'hand' }, ...this.winningHand(r.winner).map((tile) => this.tile(tile))),
        h('p', { class: 'score' }, t.stats(stats.won, stats.played)),
        h('button', { class: 'primary', 'data-action': 'next-hand', 'data-key': 'next-hand' }, t.nextHand),
      ),
    );
  }

  /** The player's own arrangement for the human; sorted for bots. */
  private winningHand(seat: number): Tile[] {
    const hand = this.game.round.hands[seat];
    if (seat !== HUMAN) return hand;
    const byId = new Map(hand.map((tile) => [tile.id, tile]));
    return this.game.rack.flatMap((id) => (id !== null && byId.has(id) ? [byId.get(id)!] : []));
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
