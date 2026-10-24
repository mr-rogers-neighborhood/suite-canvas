/**
 * The press that becomes a peer's drag ghost.
 *
 * A press is not a drag. ICE moves the object on the first frame of travel, but
 * a click that never moves must publish nothing — otherwise every peer sees a
 * ghost flash on every selection. This module holds the one decision: the box a
 * card started in, and whether the live box has left it.
 *
 * It publishes in the plane's units (ICE world, which is the View's plane), not
 * the owning Board's, because that is the coordinate a peer replays the ghost
 * in. `dragSample` in `icePresence` does the encoding; this is only the gate.
 */

import type { Rect } from "@suite/scene";
import type { DraggingState } from "../collab/presence";
import { dragSample } from "./icePresence";

/** Below this much travel the press is still a click (world units). */
export const DRAG_PRESENCE_EPSILON = 0.5;

export interface PresencePress {
  readonly cardId: string;
  /** The plane the gesture runs on: the View, whose plane ICE's world is. */
  readonly planeId: string;
  /** The card's box at pointer-down. */
  readonly start: Rect;
}

function finiteRect(rect: Rect | null | undefined): rect is Rect {
  return (
    rect !== null &&
    rect !== undefined &&
    [rect.x, rect.y, rect.width, rect.height].every((value) => Number.isFinite(value))
  );
}

/** Start tracking a press, or null when it cannot be one (no usable box or ids). */
export function beginPresencePress(input: {
  readonly cardId: string;
  readonly planeId: string;
  readonly box: Rect | null | undefined;
}): PresencePress | null {
  if (input.cardId.length === 0 || input.planeId.length === 0) return null;
  if (!finiteRect(input.box)) return null;
  return { cardId: input.cardId, planeId: input.planeId, start: input.box };
}

/**
 * The drag sample for a live press, or null while the card still sits where it
 * was pressed. A card that moved and came back is still a click.
 *
 * Only travel counts: a resize changes the box without moving it, and resize
 * presence is not published here.
 */
export function presenceDragFor(
  press: PresencePress,
  box: Rect | null | undefined,
  members: readonly string[] = [],
): DraggingState | null {
  if (!finiteRect(box)) return null;
  const dx = box.x - press.start.x;
  const dy = box.y - press.start.y;
  if (Math.hypot(dx, dy) < DRAG_PRESENCE_EPSILON) return null;
  return dragSample(press.cardId, press.planeId, box, members);
}
