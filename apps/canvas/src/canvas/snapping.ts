/**
 * Alignment snapping for a card being dragged.
 *
 * A card's left, centre and right (and top, middle and bottom) are compared
 * with the same three lines of every other card on the board. The closest pair
 * inside `SNAP_THRESHOLD` flow units wins, the position moves by that
 * difference, and the caller draws the guide the match implies.
 *
 * Pure geometry, no React Flow and no document: the drag gesture feeds it the
 * pointer position and the board's other boxes, so the rule the guide shows is
 * the rule the drop commits. Multi-card drags are deliberately excluded by the
 * caller, because snapping a group to one member's edge would move the other
 * members apart.
 */

export interface SnapPoint {
  x: number;
  y: number;
}

export interface SnapSize {
  width: number;
  height: number;
}

/** A box in flow units, the unit every board coordinate uses. */
export interface SnapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SnapAxis = "x" | "y";

/** A line to draw: `at` is the shared coordinate, `start`..`end` its extent. */
export interface SnapGuide {
  axis: SnapAxis;
  at: number;
  start: number;
  end: number;
}

export interface SnapResult {
  position: SnapPoint;
  guides: SnapGuide[];
}

/** How close an edge or centre has to be before it snaps, in flow units. */
export const SNAP_THRESHOLD = 6;

/** How far a guide runs past the boxes it joins, so the line reads as a guide. */
const GUIDE_OVERHANG = 12;

/** Tolerance for "the same coordinate" after a float comparison. */
const EPSILON = 0.5;

function spans(rect: SnapRect, axis: SnapAxis): [number, number, number] {
  return axis === "x"
    ? [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
    : [rect.y, rect.y + rect.height / 2, rect.y + rect.height];
}

function crossStart(rect: SnapRect, axis: SnapAxis): number {
  return axis === "x" ? rect.y : rect.x;
}

function crossEnd(rect: SnapRect, axis: SnapAxis): number {
  return axis === "x" ? rect.y + rect.height : rect.x + rect.width;
}

interface AxisSnap {
  delta: number;
  at: number;
}

/** The smallest move on one axis that puts a moving line on an other's line. */
function closestSnap(
  moving: readonly number[],
  others: readonly SnapRect[],
  axis: SnapAxis,
  threshold: number,
): AxisSnap | null {
  let best: AxisSnap | null = null;
  for (const other of others) {
    for (const at of spans(other, axis)) {
      for (const own of moving) {
        const delta = at - own;
        if (Math.abs(delta) > threshold) continue;
        // A tie keeps the first found, so the result cannot depend on Map order
        // in a way the reader would notice as a flicker.
        if (!best || Math.abs(delta) < Math.abs(best.delta)) best = { delta, at };
      }
    }
  }
  return best;
}

/**
 * One guide per axis, spanning the moving box and every box that shares the
 * matched line. Several boxes on the same line therefore read as one guide
 * instead of a stack of overlapping ones.
 */
function guideFor(
  axis: SnapAxis,
  at: number,
  moving: SnapRect,
  others: readonly SnapRect[],
): SnapGuide | null {
  const matched = others.filter((other) =>
    spans(other, axis).some((value) => Math.abs(value - at) < EPSILON),
  );
  if (matched.length === 0) return null;
  const boxes = [moving, ...matched];
  const start = Math.min(...boxes.map((box) => crossStart(box, axis)));
  const end = Math.max(...boxes.map((box) => crossEnd(box, axis)));
  return { axis, at, start: start - GUIDE_OVERHANG, end: end + GUIDE_OVERHANG };
}

/**
 * Snap a dragged box to the nearest edge or centre line of `others`.
 *
 * The returned position is where the card should be painted and committed; the
 * guides are the lines the reader sees while the match holds.
 */
export function snapRect(input: {
  position: SnapPoint;
  size: SnapSize;
  others: readonly SnapRect[];
  threshold?: number | undefined;
}): SnapResult {
  const threshold = input.threshold ?? SNAP_THRESHOLD;
  const moving: SnapRect = {
    x: input.position.x,
    y: input.position.y,
    width: input.size.width,
    height: input.size.height,
  };
  if (input.others.length === 0 || !Number.isFinite(threshold) || threshold <= 0) {
    return { position: { ...input.position }, guides: [] };
  }

  const x = closestSnap(spans(moving, "x"), input.others, "x", threshold);
  const y = closestSnap(spans(moving, "y"), input.others, "y", threshold);
  const snapped: SnapRect = {
    ...moving,
    x: moving.x + (x?.delta ?? 0),
    y: moving.y + (y?.delta ?? 0),
  };

  const guides: SnapGuide[] = [];
  if (x) {
    const guide = guideFor("x", x.at, snapped, input.others);
    if (guide) guides.push(guide);
  }
  if (y) {
    const guide = guideFor("y", y.at, snapped, input.others);
    if (guide) guides.push(guide);
  }

  return { position: { x: snapped.x, y: snapped.y }, guides };
}
