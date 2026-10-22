/**
 * Moving a tile from one place to another so the player can follow it.
 *
 * The table is redrawn from scratch on every change, so an element that moves
 * would jump. This measures where it was before the redraw and where it is
 * after it, and animates the difference: the tile itself travels, so there is
 * never a copy and the real thing.
 */

/** How long a tile takes to get where it is going. */
export const FLIGHT_MS = 260;
/** How long the big moments take: a finished meld, the gösterge, a win. */
export const FLASH_MS = 700;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/** True when the player asked for less movement. Everything becomes instant. */
export function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(REDUCED_MOTION).matches === true;
}

/**
 * Keeps track of the running animations so a pause can freeze them. The
 * Playables require everything to stop between onPause and onResume, and a
 * moving tile that keeps moving while the game is paused breaks that.
 */
export class Flights {
  private readonly running = new Set<Animation>();

  constructor(private readonly root: HTMLElement) {}

  track(animation: Animation): void {
    this.running.add(animation);
    const done = () => this.running.delete(animation);
    animation.finished.then(done).catch(done);
  }

  pause(): void {
    for (const animation of this.running) animation.pause();
    this.root.classList.add('paused');
  }

  resume(): void {
    for (const animation of this.running) animation.play();
    this.root.classList.remove('paused');
  }

  get count(): number {
    return this.running.size;
  }
}

/** Where a rectangle sits now, in viewport coordinates. */
export type Rect = { left: number; top: number; width: number; height: number };

export const rectOf = (element: Element | null): Rect | null => {
  if (!element) return null;
  const r = element.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
};

/**
 * Moves an element from one rectangle to another. The element stays where the
 * layout wants it; only the animation makes it look like it travelled.
 */
export function moveTo(element: HTMLElement, from: Rect, to: Rect, duration = FLIGHT_MS): Animation | null {
  if (!from.width || !to.width) return null;
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const scale = from.width / to.width;
  element.classList.add('flying');
  const animation = element.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(${scale})` },
      { transform: 'none' },
    ],
    { duration, easing: 'cubic-bezier(0.22, 0.75, 0.25, 1)' },
  );
  const done = () => element.classList.remove('flying');
  animation.finished.then(done).catch(done);
  return animation;
}

/**
 * Sends a copy of a tile on its way and fades it out. Used when the tile has
 * no place to land, for instance a tile a bot takes into its hidden hand.
 */
export function flyAway(root: HTMLElement, source: HTMLElement, to: Rect, from?: Rect, duration = FLIGHT_MS): Animation | null {
  const start = from ?? rectOf(source);
  if (!start || !start.width) return null;
  const ghost = source.cloneNode(true) as HTMLElement;
  ghost.classList.remove('selected', 'fresh', 'hinted');
  ghost.classList.add('ghost', 'flying');
  ghost.removeAttribute('data-key');
  ghost.removeAttribute('data-tile-id');
  root.append(ghost);
  const x = to.left + to.width / 2 - start.width / 2;
  const y = to.top + to.height / 2 - start.height / 2;
  const animation = ghost.animate(
    [
      { transform: `translate(${start.left}px, ${start.top}px) scale(1)`, opacity: 1 },
      { transform: `translate(${x}px, ${y}px) scale(0.3)`, opacity: 0 },
    ],
    { duration, easing: 'cubic-bezier(0.4, 0, 0.3, 1)' },
  );
  const done = () => ghost.remove();
  animation.finished.then(done).catch(done);
  return animation;
}

/** A short flash on an element: a meld finished, the gösterge was shown. */
export function flash(element: HTMLElement, className: string, duration = FLASH_MS): void {
  element.classList.add(className);
  window.setTimeout(() => element.classList.remove(className), duration);
}
