/**
 * The silhouette contract ([ADR-0071](../../../docs/decisions/0071-style-is-derived-not-configured.md)
 * amendment, "the silhouette is published, not restated").
 *
 * A card is a rounded box, and three different things need to agree about where its
 * edge is: the chrome painted inside it, the dots a reader drags links from, and any
 * decoration drawn *on* its boundary. They drifted the moment a radius became something
 * a reader could change — a fixed 6px header inside a 28px card left a notch, and a
 * corner dot on a pill card sits a third of the short side away from the shape it
 * belongs to.
 *
 * So the radius is clamped, and the edge is derived, in one place and in one unit.
 * Positions are **normalised** (0..1 across the box) because that is what a card stores:
 * a dot's position is document data, and it must survive a resize.
 */

export interface Silhouette {
  width: number;
  height: number;
  /** The radius the surface resolved, in pixels. Clamped only when read. */
  radius: number;
}

export interface NormalisedPoint {
  x: number;
  y: number;
}

/**
 * The largest radius the box can actually paint. Past half the short side a corner arc
 * would overlap its neighbour, and CSS silently scales every radius down to fit; doing
 * it here means the geometry and the paint agree instead of one guessing about the other.
 */
export function clampRadius({ width, height, radius }: Silhouette): number {
  const limit = Math.max(0, Math.min(width, height) / 2);
  if (!Number.isFinite(radius) || radius <= 0) return 0;
  return Math.min(radius, limit);
}

/**
 * How far the painted corner is from the box corner, measured along the diagonal.
 *
 * A quarter-circle of radius `r` meets the two edges tangent at `(r, 0)` and `(0, r)`,
 * so the visible corner sits at `r - r/√2` from the point where the edges would have
 * met. This is the number that makes a corner dot look attached.
 */
export function cornerInset(radius: number): number {
  if (!Number.isFinite(radius) || radius <= 0) return 0;
  return radius - radius / Math.SQRT2;
}

/** The clamp applied to a normalised position, so callers cannot hand us 1.4 or -0.2. */
function unit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Which corner region a pixel point falls in, if any.
 *
 * Corners are named by their sign pair so the four cases share one implementation: a
 * point is in a corner when it is within `r` of both edges that meet there.
 */
function cornerCentre(px: number, py: number, shape: Silhouette, r: number) {
  const left = px < r;
  const right = px > shape.width - r;
  const top = py < r;
  const bottom = py > shape.height - r;
  if ((left && top) || (left && bottom) || (right && top) || (right && bottom)) {
    return { x: left ? r : shape.width - r, y: top ? r : shape.height - r };
  }
  return null;
}

/**
 * Where the painted edge is, for a normalised point on the box border.
 *
 * The answer is in the same unit, so a caller positions with it exactly as it would
 * have positioned with the input. Three properties matter, and each is a test:
 *
 * - **A side midpoint does not move.** The common case is untouched, which is what lets
 *   this be a correction rather than a change of geometry.
 * - **A box corner moves onto the arc**, along the diagonal toward its corner centre —
 *   the shortest way, so the dot stays as close to the corner as the paint allows.
 * - **Radius 0 is the identity**, so nothing that never rounds a card pays for this.
 */
export function edgePoint(shape: Silhouette, position: NormalisedPoint): NormalisedPoint {
  const r = clampRadius(shape);
  const point = { x: unit(position.x), y: unit(position.y) };
  if (r === 0 || shape.width <= 0 || shape.height <= 0) return point;

  const px = point.x * shape.width;
  const py = point.y * shape.height;
  const centre = cornerCentre(px, py, shape, r);
  if (!centre) return point;

  // Straight, not along the diagonal: the direction from the arc's centre through the
  // point is what projects onto the circle, and for a corner point that *is* the
  // diagonal. Doing it this way keeps a dot dropped near (but not on) a corner honest.
  const dx = px - centre.x;
  const dy = py - centre.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return point;
  // Already on or inside the arc: the paint covers this point, so it is not corrected.
  if (distance <= r) return point;

  const onArc = { x: centre.x + (dx / distance) * r, y: centre.y + (dy / distance) * r };
  return { x: onArc.x / shape.width, y: onArc.y / shape.height };
}

/**
 * Whether a normalised position is one of the anchor slots a fresh card starts with.
 * Kept here rather than in the component so "is this dot on a corner?" has one answer:
 * anchor slots are the positions the paint can pull away from.
 */
export function isCornerSlot(position: NormalisedPoint): boolean {
  const corner = (x: number, y: number) => position.x === x && position.y === y;
  return corner(0, 0) || corner(1, 0) || corner(0, 1) || corner(1, 1);
}

/** Whether a correction is visible at all: below a pixel nobody can see it. */
export function isSilhouetteCorrection(
  shape: Silhouette,
  position: NormalisedPoint,
  threshold = 0.5,
): boolean {
  if (clampRadius(shape) === 0) return false;
  const corrected = edgePoint(shape, position);
  return (
    Math.hypot(
      (corrected.x - unit(position.x)) * shape.width,
      (corrected.y - unit(position.y)) * shape.height,
    ) > threshold
  );
}

/**
 * The silhouette a mounted surface actually has.
 *
 * Measured rather than resolved, deliberately: the radius a card ends up with is the
 * end of a ladder — a painted style, a type or kind rule, the reader's preference, the
 * 12px default — and re-deriving that ladder here would be a second implementation of
 * the thing `rules.ts` already owns. The DOM has the single answer, so we read it.
 *
 * `offsetWidth`/`offsetHeight` rather than `getBoundingClientRect`: React Flow scales the
 * viewport, and this must be in the card's own units, which is the unit a radius is in.
 * Returns null when the element cannot be measured (unmounted, or a test environment
 * that lays nothing out), and every caller treats that as "no radius".
 */
export function readSilhouette(element: Element | null | undefined): Silhouette | null {
  if (!element || typeof window === "undefined") return null;
  const box = element as HTMLElement;
  const width = box.offsetWidth;
  const height = box.offsetHeight;
  if (width <= 0 || height <= 0) return null;
  // Size from *this* element, because that is the box a percentage position resolves
  // against. A card has a 1px border and its dots live inside it, so measuring the card
  // and positioning in the layer is a sub-pixel disagreement — invisible until a corner
  // dot has to sit exactly on an arc.
  const style = window.getComputedStyle(box);
  const declared = Number.parseFloat(style.getPropertyValue("--card-radius"));
  // The painted radius is read from the surface when this element only inherits the
  // token: `--card-radius` inherits, `border-radius` does not.
  const surface = box.closest("[data-connector-surface]");
  const painted = Number.parseFloat(
    surface ? window.getComputedStyle(surface).borderTopLeftRadius : style.borderTopLeftRadius,
  );
  const radius = Number.isFinite(declared) ? declared : Number.isFinite(painted) ? painted : 0;
  return { width, height, radius };
}
