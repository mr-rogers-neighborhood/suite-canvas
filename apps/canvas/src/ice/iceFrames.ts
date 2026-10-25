/**
 * The depth maths: where a crossing link is drawn, and where it is cut.
 *
 * A link belongs to the plane of its ends (`edgeFrameOf`), but the camera can be
 * *inside* a Board on that plane. Standing there, a link that reaches out of the
 * frame is behind a wall: drawn on its own plane it is simply not there, and the
 * one thing the desk owes the reader is the sight of it leaving. So a link whose
 * frame is an ancestor of the entered Board is re-drawn in the entered Board and
 * cut at its own rect — the wall it leaves by.
 *
 * Everything here is pure: a Board tree, a path of entered ids and two points
 * in, one frame and a cut segment out. No ICE, no document, no DOM — which is
 * what makes "inside the frame", "outside it", "straight through it" and
 * "touching the wall" assertions rather than screenshots.
 */

import { type Board, boardIsDescendant, boardWorldRect, type Point, type Rect } from "@suite/graph";

/**
 * How close to the frame's boundary a parameter has to be before a cut counts
 * as "it was already there". A wall anchor is arithmetic on the rect, so it can
 * land a rounding error outside; cutting that end would put a through tick on a
 * wall the link never actually crossed.
 */
const TOUCH_EPSILON = 1e-9;

/** A segment after being cut to a rect, and which ends were cut. */
export interface SegmentClip {
  readonly from: Point;
  readonly to: Point;
  /** The source end was outside the rect and now lies on its boundary. */
  readonly clippedSource: boolean;
  /** The target end was outside the rect and now lies on its boundary. */
  readonly clippedTarget: boolean;
}

/** Which end of a drawn link was cut at a wall. */
export type ThroughEnd = "source" | "target";

/** A world point in a frame's own coordinates: the frame's origin taken away. */
export function frameLocalPoint(point: Point, frameOrigin: { x: number; y: number }): Point {
  return { x: point.x - frameOrigin.x, y: point.y - frameOrigin.y };
}

/**
 * A stored Board rect as its inside frame sees it: a child's coordinates are
 * the placement it holds, so the wall it stands behind starts at the origin.
 */
export function frameLocalRect(rect: Rect): Rect {
  return { x: 0, y: 0, width: rect.width, height: rect.height };
}

function containsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

function pointAt(from: Point, to: Point, t: number): Point {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/**
 * The part of `from → to` that lies inside `rect` (Liang–Barsky), or `null` when
 * the segment misses the rect entirely.
 *
 * The cut ends are the ones that were outside: a segment that starts inside and
 * leaves is cut at the target only, one that crosses the rect twice is cut at
 * both, and one that touches a corner answers a degenerate segment (the touch
 * point) rather than nothing — the caller decides whether that is worth drawing.
 * A segment wholly inside comes back untouched, so a link that never crosses a
 * wall is the same object whether this ran or not.
 */
export function clipToRect(from: Point, to: Point, rect: Rect): SegmentClip | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // A degenerate segment has no direction to cut: it is on the frame or it is not.
  if (Math.abs(dx) <= TOUCH_EPSILON && Math.abs(dy) <= TOUCH_EPSILON) {
    if (!containsPoint(rect, from)) return null;
    return { from: { ...from }, to: { ...to }, clippedSource: false, clippedTarget: false };
  }

  // One row per rect edge: p is the direction's component against the edge's
  // inward normal, q how far inside the start already is.
  const edges: readonly (readonly [number, number])[] = [
    [-dx, from.x - rect.x],
    [dx, rect.x + rect.width - from.x],
    [-dy, from.y - rect.y],
    [dy, rect.y + rect.height - from.y],
  ];

  let enter = 0;
  let leave = 1;
  for (const [p, q] of edges) {
    if (p === 0) {
      // Parallel to this edge: outside it means the whole segment is outside.
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > leave) return null;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return null;
      if (t < leave) leave = t;
    }
  }
  if (enter > leave) return null;

  const startCut = enter > TOUCH_EPSILON;
  const endCut = leave < 1 - TOUCH_EPSILON;
  return {
    // An end that was already inside keeps its exact coordinates: `pointAt(0)`
    // would round, and a wall anchor that came from arithmetic must stay one.
    from: startCut ? pointAt(from, to, enter) : { ...from },
    to: endCut ? pointAt(from, to, leave) : { ...to },
    clippedSource: startCut,
    clippedTarget: endCut,
  };
}

/** The frame one link is drawn in, and the wall it is cut at when it is not its own. */
export interface LinkDrawFrame {
  /** The Board whose inside frame holds the object (the View root has no frame). */
  readonly boardId: string;
  /** The entered frame's own rect, frame-local, when the link is cut at a wall; else `null`. */
  readonly clip: Rect | null;
  /** True when this is the entered Board's drawing of a link that belongs higher up. */
  readonly crossed: boolean;
}

export interface LinkDrawFrameInput {
  /** The frame the link's two ends share (`edgeFrameOf`'s lowest common ancestor). */
  readonly frame: string;
  /** The Boards the camera is inside, outermost first; empty on the View's plane. */
  readonly entered: readonly string[];
  readonly boards: readonly Board[];
}

/**
 * Which frame a link is drawn in, given the Boards entered.
 *
 * On the plane, or inside the link's own frame, the answer is the link's frame —
 * nothing about the drawing changes. Inside a Board *above* it in the tree, the
 * answer is that Board: the link is drawn there and cut at its rect, so the
 * reader sees where it leaves. A frame the camera is not under is never
 * re-drawn: a link inside a Board the camera has not entered is already where
 * it belongs.
 */
export function linkDrawFrame(input: LinkDrawFrameInput): LinkDrawFrame {
  const { frame, entered, boards } = input;
  const deepest = entered[entered.length - 1];
  if (deepest === undefined || deepest === frame) {
    return { boardId: frame, clip: null, crossed: false };
  }
  // `frame` is an ancestor of the entered Board — and only then. The View root
  // is an id `boardPath` starts with, so it answers here too.
  if (!boardIsDescendant(boards, deepest, frame)) {
    return { boardId: frame, clip: null, crossed: false };
  }
  const enteredRect = boardWorldRect(boards, deepest);
  if (enteredRect === undefined) return { boardId: frame, clip: null, crossed: false };
  return { boardId: deepest, clip: frameLocalRect(enteredRect), crossed: true };
}

/** The ends of a cut segment, in the order the trace keeps them. */
export function throughEndsOf(clip: SegmentClip): ThroughEnd[] {
  const ends: ThroughEnd[] = [];
  if (clip.clippedSource) ends.push("source");
  if (clip.clippedTarget) ends.push("target");
  return ends;
}

/**
 * True when the cut left nothing to draw: both ends were cut and landed on the
 * same point. That is what a link leaving a Board's own wall looks like from
 * inside it — it starts at the wall and is immediately outside — and drawing a
 * zero-length link there would put a tick on a wall the link does not cross.
 */
export function degenerateClip(clip: SegmentClip): boolean {
  if (!clip.clippedSource || !clip.clippedTarget) return false;
  return Math.hypot(clip.to.x - clip.from.x, clip.to.y - clip.from.y) <= 1e-6;
}
