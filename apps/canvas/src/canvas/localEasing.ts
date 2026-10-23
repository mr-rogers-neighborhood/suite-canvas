/**
 * Render-only easing for the card this client is dragging (A10, §6.4).
 *
 * React Flow owns a local drag: it reports the pointer's position through
 * `onNodesChange` on every pointer sample, and the app commits a placement once,
 * from `onNodeDragStop`. Painting those samples directly is what looked "steppy"
 * under load, so this module damps the *rendered* delta only. The committed
 * placement is never touched: the pointer position is kept as the target and
 * written as the drop position, and nothing here mutates the document.
 *
 * The step is time-based, not per-frame, so 60 Hz and 120 Hz panels converge at
 * the same wall-clock rate and a slow frame does not change the feel.
 * `prefers-reduced-motion` turns the whole thing off; the drag then paints the
 * pointer position directly, as it did before A10.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Milliseconds for the rendered delta to close most of its gap. Deliberately
 * short: the aim is to absorb a missed frame, not to trail the pointer. At 60 Hz
 * (~16.7 ms) this covers roughly three quarters of the remaining distance per
 * frame; at 120 Hz (~8.3 ms) it covers about half, which lands at the same
 * position at the same time.
 */
export const LOCAL_EASE_TAU_MS = 12;

/** Below this distance the rendered position is the target, so the ease stops. */
export const LOCAL_EASE_SNAP_PX = 0.5;

/** Fraction of the remaining distance to cover after `elapsedMs`. */
export function easeAlpha(elapsedMs: number, tau = LOCAL_EASE_TAU_MS): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0 || tau <= 0) return 0;
  return 1 - Math.exp(-elapsedMs / tau);
}

/** One eased step. `settled` means the target was reached exactly. */
export function easeToward(
  current: Point,
  target: Point,
  alpha: number,
): { position: Point; settled: boolean } {
  if (alpha >= 1) return { position: { x: target.x, y: target.y }, settled: true };
  const x = current.x + (target.x - current.x) * alpha;
  const y = current.y + (target.y - current.y) * alpha;
  if (Math.abs(target.x - x) < LOCAL_EASE_SNAP_PX && Math.abs(target.y - y) < LOCAL_EASE_SNAP_PX) {
    return { position: { x: target.x, y: target.y }, settled: true };
  }
  return { position: { x, y }, settled: false };
}

/** True when the viewer asked the OS for reduced motion. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The rendered positions of one drag gesture. A gesture starts at the committed
 * positions (so nothing jumps), follows the pointer as a target, and ends by
 * handing back the pointer targets — the positions to commit.
 */
export class LocalDragEase {
  private rendered = new Map<string, Point>();
  private targets = new Map<string, Point>();
  private lastTick: number | null = null;

  begin(entries: ReadonlyArray<{ id: string; position: Point }>, now = 0): void {
    this.rendered.clear();
    this.targets.clear();
    // The clock starts with the gesture, so the first pointer sample eases by a
    // full frame instead of being swallowed as the baseline.
    this.lastTick = now;
    for (const entry of entries) {
      const point = { x: entry.position.x, y: entry.position.y };
      this.rendered.set(entry.id, point);
      this.targets.set(entry.id, point);
    }
  }

  get active(): boolean {
    return this.rendered.size > 0;
  }

  /** Whether this gesture is easing the given card. */
  tracks(id: string): boolean {
    return this.rendered.has(id);
  }

  renderedAt(id: string): Point | undefined {
    return this.rendered.get(id);
  }

  target(id: string, position: Point): void {
    if (!this.rendered.has(id)) return;
    this.targets.set(id, { x: position.x, y: position.y });
  }

  /** True while any card still has ground to cover. */
  get moving(): boolean {
    for (const [id, target] of this.targets) {
      const current = this.rendered.get(id);
      if (!current) return true;
      if (Math.abs(current.x - target.x) >= LOCAL_EASE_SNAP_PX) return true;
      if (Math.abs(current.y - target.y) >= LOCAL_EASE_SNAP_PX) return true;
    }
    return false;
  }

  /** One animation frame. Returns only the cards whose rendered position moved. */
  step(now: number): Map<string, Point> {
    const elapsed = this.lastTick === null ? 0 : now - this.lastTick;
    this.lastTick = now;
    const alpha = easeAlpha(elapsed);
    const moved = new Map<string, Point>();
    for (const [id, target] of this.targets) {
      const current = this.rendered.get(id) ?? target;
      if (current.x === target.x && current.y === target.y) continue;
      const next = easeToward(current, target, alpha);
      this.rendered.set(id, next.position);
      moved.set(id, next.position);
    }
    return moved;
  }

  /**
   * Ends the gesture: returns the pointer position of every card — the truth to
   * commit — and forgets the gesture, so a second call cannot commit again.
   */
  finish(): Map<string, Point> {
    const committed = new Map<string, Point>();
    for (const [id, target] of this.targets) {
      committed.set(id, { x: target.x, y: target.y });
    }
    this.rendered.clear();
    this.targets.clear();
    this.lastTick = null;
    return committed;
  }
}
