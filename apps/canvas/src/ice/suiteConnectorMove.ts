/**
 * Sliding a card's connector along its own perimeter.
 *
 * A connector is the card's data — a 0..1 fraction of its box (`graphSchema`),
 * not an ICE port — so "move the connector" is a projection: take the pointer's
 * world point, find the edge of the card it is nearest, and say where along that
 * edge it lands. Magnets are the same eight anchors the document offers
 * (`CONNECTOR_ANCHORS`), pulled in only when the pointer is already close, which
 * is why a connector placed between two corners stays there instead of jumping.
 *
 * Pure geometry: no DOM, no ICE, and nothing written. The gesture commits once
 * at pointer-up through `planConnectorMove`.
 */

import { CONNECTOR_ANCHORS } from "@suite/graph";
import type { Point, Rect } from "@suite/scene";

/** How close (CSS px) a released connector snaps to one of the card's anchors. */
export const CONNECTOR_MAGNET_PX = 16;

function usableRect(rect: Rect | null | undefined): rect is Rect {
  if (rect === null || rect === undefined) return false;
  return [rect.x, rect.y, rect.width, rect.height].every((value) => Number.isFinite(value));
}

/**
 * The pointer's position on the card's perimeter, as a 0..1 fraction of the box.
 *
 * The nearest side wins and that side's axis is pinned to 0 or 1, so a connector
 * never drifts inside the card: a fraction off the perimeter would draw the dot
 * in the middle of the face and read as a different kind of thing.
 */
export function projectOntoPerimeter(point: Point, rect: Rect | null | undefined): Point | null {
  if (!usableRect(rect)) return null;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const width = rect.width;
  const height = rect.height;
  const px = Math.min(width, Math.max(0, point.x - rect.x));
  const py = Math.min(height, Math.max(0, point.y - rect.y));
  const x = width === 0 ? 0.5 : px / width;
  const y = height === 0 ? 0.5 : py / height;

  const sides = [
    { side: "top" as const, distance: py },
    { side: "bottom" as const, distance: height - py },
    { side: "left" as const, distance: px },
    { side: "right" as const, distance: width - px },
  ].sort((a, b) => a.distance - b.distance);

  switch (sides[0]?.side ?? "top") {
    case "top":
      return { x, y: 0 };
    case "bottom":
      return { x, y: 1 };
    case "left":
      return { x: 0, y };
    default:
      return { x: 1, y };
  }
}

/**
 * The nearest anchor within `radius` world units, or the position unchanged.
 * The distance is measured in world units on the card's box, so a pulled-back
 * camera needs a bigger radius for the same feel — the caller divides screen
 * pixels by the zoom.
 */
export function magnetizePerimeter(
  position: Point,
  rect: Rect | null | undefined,
  radius: number,
): Point {
  if (!usableRect(rect) || !Number.isFinite(radius) || radius <= 0) return position;
  let best: Point | null = null;
  let bestDistance = radius;
  for (const anchor of CONNECTOR_ANCHORS) {
    const distance = Math.hypot(
      (anchor.x - position.x) * rect.width,
      (anchor.y - position.y) * rect.height,
    );
    if (distance > bestDistance) continue;
    best = { x: anchor.x, y: anchor.y };
    bestDistance = distance;
  }
  return best ?? position;
}

/** Where a drag of the connector to `point` lands: the perimeter, magnetised. */
export function connectorMoveTarget(
  point: Point,
  rect: Rect | null | undefined,
  magnetRadius: number,
): Point | null {
  const projected = projectOntoPerimeter(point, rect);
  if (projected === null) return null;
  return magnetizePerimeter(projected, rect, magnetRadius);
}

/** The magnet radius in world units for a camera at `zoom`. */
export function connectorMagnetRadius(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom <= 0) return CONNECTOR_MAGNET_PX;
  return CONNECTOR_MAGNET_PX / zoom;
}
