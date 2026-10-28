import { describe, expect, it } from "vitest";
import {
  clampRadius,
  cornerInset,
  edgePoint,
  isCornerSlot,
  isSilhouetteCorrection,
  type Silhouette,
} from "./silhouette";

/**
 * The silhouette contract (ADR-0071).
 *
 * Three properties carry it, and each fails loudly if the maths drifts:
 * the common case (a side midpoint) never moves, a corner lands *on* the arc, and a
 * radius of zero is the identity — so a board that never rounds anything pays nothing.
 */

const card = (radius: number): Silhouette => ({ width: 320, height: 200, radius });

/** Distance from a point to the corner's arc centre, in pixels: `r` means "on the arc". */
function distanceToCornerCentre(shape: Silhouette, point: { x: number; y: number }): number {
  const r = clampRadius(shape);
  const px = point.x * shape.width;
  const py = point.y * shape.height;
  // The nearest corner centre is the one the point is closest to.
  const cx = px <= shape.width / 2 ? r : shape.width - r;
  const cy = py <= shape.height / 2 ? r : shape.height - r;
  return Math.hypot(px - cx, py - cy);
}

describe("the silhouette contract", () => {
  it("leaves every side midpoint exactly where it was", () => {
    for (const radius of [0, 4, 12, 28, 999]) {
      const shape = card(radius);
      for (const midpoint of [
        { x: 0.5, y: 0 },
        { x: 1, y: 0.5 },
        { x: 0.5, y: 1 },
        { x: 0, y: 0.5 },
      ]) {
        expect(edgePoint(shape, midpoint)).toEqual(midpoint);
      }
    }
  });

  it("puts a box corner exactly on the painted arc", () => {
    const shape = card(28);
    const corner = edgePoint(shape, { x: 0, y: 0 });

    // "On the arc" is a distance, not a pair of numbers: the dot must be as far from
    // the corner's centre as the radius is, whichever way the arithmetic got there.
    expect(distanceToCornerCentre(shape, corner)).toBeCloseTo(28, 6);
    // And inside the box, on the diagonal: a rounded corner pulls *in*, never out.
    // Compared in pixels, since one normalised unit is not one pixel on a 320×200 card.
    expect(corner.x).toBeGreaterThan(0);
    expect(corner.y).toBeGreaterThan(0);
    expect(corner.x * shape.width).toBeCloseTo(corner.y * shape.height, 9);
  });

  it("pulls a corner in by exactly r - r/√2 along the diagonal", () => {
    const shape = card(16);
    const corner = edgePoint(shape, { x: 0, y: 0 });

    // The classic value, measured rather than assumed: 16 - 16/√2 ≈ 4.69px on each axis.
    const inset = cornerInset(16);
    expect(inset).toBeCloseTo(4.686, 3);
    expect(corner.x * shape.width).toBeCloseTo(inset, 6);
    expect(corner.y * shape.height).toBeCloseTo(inset, 6);
  });

  it("is the identity at radius 0", () => {
    const square = { x: 0, y: 0 };
    expect(edgePoint(card(0), square)).toEqual(square);
    expect(edgePoint({ width: 320, height: 200, radius: 0 }, { x: 1, y: 1 })).toEqual({
      x: 1,
      y: 1,
    });
  });

  it("degenerates to a pill past half the short side", () => {
    // CSS silently scales every radius down to fit; doing it here is what keeps the
    // painted edge and the measured edge the same edge.
    const capsule: Silhouette = { width: 320, height: 200, radius: 400 };
    expect(clampRadius(capsule)).toBe(100);

    const left = edgePoint(capsule, { x: 0, y: 0 });
    const right = edgePoint(capsule, { x: 1, y: 1 });

    // A stadium's caps are semicircles of r = height/2, so a box corner lands on the
    // 45° point of its cap: r - r/√2 ≈ 29.29px in from each edge, not at the cap's centre.
    const capInset = 100 - 100 / Math.SQRT2;
    expect(left.x * capsule.width).toBeCloseTo(capInset, 6);
    expect(left.y * capsule.height).toBeCloseTo(capInset, 6);
    expect(right.x * capsule.width).toBeCloseTo(320 - capInset, 6);
    expect(right.y * capsule.height).toBeCloseTo(200 - capInset, 6);
    // Both stay on their cap: distance from the cap centre is the clamped radius.
    for (const point of [left, right]) {
      expect(distanceToCornerCentre(capsule, point)).toBeCloseTo(100, 6);
    }
  });

  it("treats a negative or unreadable radius as no radius", () => {
    expect(clampRadius({ width: 320, height: 200, radius: -8 })).toBe(0);
    expect(clampRadius({ width: 320, height: 200, radius: Number.NaN })).toBe(0);
    expect(edgePoint(card(-8), { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("leaves a point the paint already covers alone", () => {
    // A dot dropped 2px inside the corner is still on the card, so there is nothing to
    // correct: pulling it onto the arc would move it *outward*.
    const shape = card(28);
    const inside = { x: 20 / shape.width, y: 20 / shape.height };

    expect(edgePoint(shape, inside)).toEqual(inside);
  });

  it("corrects a point near a corner onto the arc rather than along the diagonal", () => {
    const shape = card(28);
    // Along the top edge, 10px from the left: inside the corner region but not on it.
    const near = { x: 10 / shape.width, y: 0 };
    const corrected = edgePoint(shape, near);

    expect(distanceToCornerCentre(shape, corrected)).toBeCloseTo(28, 6);
    // It stays on the top edge's side of the corner, so the dot does not slide round
    // the curve to somewhere the reader did not aim.
    expect(corrected.x).toBeGreaterThan(near.x);
    expect(corrected.y).toBeGreaterThanOrEqual(0);
  });

  it("clamps input so a hand-edited position cannot leave the box", () => {
    // On a square card the clamp is all that happens, so it is visible on its own.
    expect(edgePoint({ width: 100, height: 100, radius: 0 }, { x: 1.4, y: -0.2 })).toEqual({
      x: 1,
      y: 0,
    });
    // With a radius the clamped point is a corner, so it is then corrected like any other.
    expect(distanceToCornerCentre(card(12), edgePoint(card(12), { x: 1.4, y: -0.2 }))).toBeCloseTo(
      12,
      6,
    );
  });

  it("names the four corner slots and nothing else", () => {
    expect(isCornerSlot({ x: 0, y: 0 })).toBe(true);
    expect(isCornerSlot({ x: 1, y: 1 })).toBe(true);
    expect(isCornerSlot({ x: 0.5, y: 0 })).toBe(false);
    expect(isCornerSlot({ x: 0.3, y: 0.7 })).toBe(false);
  });

  it("reports a correction only when one is worth measuring", () => {
    // Below half a pixel nobody can see it, and a badge is not worth a re-measure.
    expect(isSilhouetteCorrection(card(1), { x: 0, y: 0 })).toBe(false);
    expect(isSilhouetteCorrection(card(28), { x: 0, y: 0 })).toBe(true);
    expect(isSilhouetteCorrection(card(0), { x: 0, y: 0 })).toBe(false);
  });
});

/**
 * A silhouette that is not a box has no radius to correct against, so the dot has to
 * land on the outline itself. The diamond is the strict case: all four of the slots a
 * fresh card starts with are *outside* the paint.
 */
describe("a polygon silhouette", () => {
  const diamond: Silhouette = { width: 320, height: 200, radius: 0, shape: "diamond" };

  it("pulls a box corner onto the diamond's edge", () => {
    // The corner is the far side of a triangle whose hypotenuse is the diamond's edge, so
    // the ray from the centre meets that edge exactly halfway along it.
    expect(edgePoint(diamond, { x: 0, y: 0 })).toEqual({ x: 0.25, y: 0.25 });
    expect(edgePoint(diamond, { x: 1, y: 1 })).toEqual({ x: 0.75, y: 0.75 });
    expect(edgePoint(diamond, { x: 1, y: 0 })).toEqual({ x: 0.75, y: 0.25 });
  });

  it("leaves the vertices where they are", () => {
    // A diamond's side midpoints *are* its vertices, so those dots do not move at all.
    for (const vertex of [
      { x: 0.5, y: 0 },
      { x: 1, y: 0.5 },
      { x: 0.5, y: 1 },
      { x: 0, y: 0.5 },
    ]) {
      expect(edgePoint(diamond, vertex)).toEqual(vertex);
    }
  });

  it("keeps the direction the reader dropped the dot in", () => {
    // The corrected point is on the ray from the centre, so a dot dropped toward ten
    // o'clock stays toward ten o'clock instead of sliding to a nearer edge.
    const dropped = { x: 0.1, y: 0.2 };
    const corrected = edgePoint(diamond, dropped);
    expect((corrected.x - 0.5) / (dropped.x - 0.5)).toBeCloseTo(
      (corrected.y - 0.5) / (dropped.y - 0.5),
      6,
    );
  });

  it("keeps a hexagon's flat top and its slanted corners", () => {
    const hexagon: Silhouette = { width: 300, height: 200, radius: 0, shape: "hexagon" };
    // The top edge runs from 25% to 75%, so a third of the way along it is on the paint.
    expect(edgePoint(hexagon, { x: 0.4, y: 0 })).toEqual({ x: 0.4, y: 0 });
    // A box corner is outside the slanted edge and comes back onto it.
    const corner = edgePoint(hexagon, { x: 0, y: 0 });
    expect(corner.x).toBeGreaterThan(0);
    expect(corner.y).toBeGreaterThan(0);
    expect(corner.x).toBeCloseTo(corner.y, 6);
  });

  it("reports a correction for a polygon even with no radius", () => {
    expect(isSilhouetteCorrection({ ...diamond, radius: 0 }, { x: 0, y: 0 })).toBe(true);
  });

  it("is the identity for a rectangle", () => {
    const rect: Silhouette = { width: 320, height: 200, radius: 0, shape: "rect" };
    expect(edgePoint(rect, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(edgePoint(rect, { x: 1, y: 1 })).toEqual({ x: 1, y: 1 });
  });
});
