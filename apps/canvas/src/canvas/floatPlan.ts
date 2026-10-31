/**
 * Where pinned cards sit when the shell chrome would cover them.
 *
 * A pin is a card the reader parked over the canvas. It should stay exactly where they
 * put it, so this only ever moves a pin that something else has taken the space of:
 * another pin, or the title bar, dock and inspector as the window narrows.
 *
 * Pure on purpose. The shell asks a question, gets a plan, and applies it; nothing here
 * reads the DOM or a document, so the awkward cases are tests rather than behaviours
 * discovered by dragging a card around.
 *
 * The rule is minimal displacement, not a solved constraint network. Separation is a
 * disjunction (a pin can go left, right, above or below), and a network of intervals has
 * no way to choose a disjunct without a search that outgrows the problem: the answers
 * here are short and the reader is watching.
 */

export interface FloatRect {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FloatBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface FloatPlan {
  readonly rects: readonly FloatRect[];
  /** The pins whose position this plan actually changed. */
  readonly moved: readonly string[];
}

export interface FloatInput {
  /** Pins, in the order the reader pinned them; that order decides who moves. */
  readonly moving: readonly FloatRect[];
  /** Shell chrome. Fixed: a pin moves around it, never the other way. */
  readonly obstacles: readonly FloatRect[];
  /** The area pins may occupy. */
  readonly bounds: FloatBounds;
  readonly gap?: number | undefined;
}

export const DEFAULT_FLOAT_GAP = 8;

/**
 * Whether two boxes are closer than `gap` on both axes.
 *
 * Touching is fine — a pin resting against another is not overlapping it — so the
 * comparison is strict on the edges and loose by the gap.
 */
function overlaps(a: FloatRect, b: FloatRect, gap: number): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** A rect wholly inside the bounds, or as close as the bounds allow when it is bigger. */
function clampToBounds(rect: FloatRect, bounds: FloatBounds): FloatRect {
  const maxX = bounds.x + Math.max(0, bounds.width - rect.width);
  const maxY = bounds.y + Math.max(0, bounds.height - rect.height);
  return {
    ...rect,
    x: clamp(rect.x, bounds.x, Math.max(bounds.x, maxX)),
    y: clamp(rect.y, bounds.y, Math.max(bounds.y, maxY)),
  };
}

function collides(rect: FloatRect, others: readonly FloatRect[], gap: number): boolean {
  return others.some((other) => overlaps(rect, other, gap));
}

/**
 * The nearest free spot for one pin, or null when the area cannot hold it.
 *
 * A search rather than a shove. Pushing a box out of one neighbour can push it into the
 * next, and a loop of small corrections is how a solver ends up either overlapping
 * anyway or spinning. Scanning every position on a grid of the gap is dull, finite, and
 * easy to convince yourself about: if a free spot exists at this granularity, this finds
 * the closest one to where the reader put the card.
 *
 * The scan starts from the pin's own position and keeps a strictly-closer winner, so the
 * same input always settles the same way, and an already-legal pin never moves.
 */
function nearestFree(
  start: FloatRect,
  fixed: readonly FloatRect[],
  bounds: FloatBounds,
  gap: number,
): FloatRect | null {
  // Bounds first: a pin dragged past the edge is out of place even when it collides
  // with nothing, and returning it untouched is how it stayed off-screen.
  const origin = clampToBounds(start, bounds);
  if (!collides(origin, fixed, gap)) return origin;

  const step = Math.max(4, gap);
  const maxX = bounds.x + Math.max(0, bounds.width - start.width);
  const maxY = bounds.y + Math.max(0, bounds.height - start.height);
  let best: FloatRect | null = null;
  let bestCost = Number.POSITIVE_INFINITY;

  for (let y = bounds.y; y <= maxY; y += step) {
    for (let x = bounds.x; x <= maxX; x += step) {
      const candidate = { ...start, x, y };
      if (collides(candidate, fixed, gap)) continue;
      const cost = Math.abs(x - origin.x) + Math.abs(y - origin.y);
      if (cost >= bestCost) continue;
      bestCost = cost;
      best = candidate;
    }
  }
  return best;
}

export function planFloats(input: FloatInput): FloatPlan {
  const gap = input.gap ?? DEFAULT_FLOAT_GAP;
  if (input.moving.length === 0) return { rects: [], moved: [] };

  const fixed: FloatRect[] = [...input.obstacles];
  const placed: FloatRect[] = [];
  for (const pin of input.moving) {
    // An earlier pin keeps its place and becomes an obstacle, so pinning a new card
    // never shuffles the ones the reader has already arranged.
    const settled = nearestFree(pin, fixed, input.bounds, gap);
    const rect = settled ?? clampToBounds(pin, input.bounds);
    placed.push(rect);
    fixed.push(rect);
  }

  const moved = placed
    .filter((rect, index) => {
      const before = input.moving[index];
      return before === undefined || rect.x !== before.x || rect.y !== before.y;
    })
    .map((rect) => rect.id);

  return { rects: placed, moved };
}
