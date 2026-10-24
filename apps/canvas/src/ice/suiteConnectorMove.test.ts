import { describe, expect, it } from "vitest";
import {
  CONNECTOR_MAGNET_PX,
  connectorMagnetRadius,
  connectorMoveTarget,
  magnetizePerimeter,
  projectOntoPerimeter,
} from "./suiteConnectorMove";

const CARD = { x: 100, y: 200, width: 200, height: 100 };

describe("projectOntoPerimeter", () => {
  it("should pin the nearest side and keep the run along it", () => {
    // Just above the card's top edge, three quarters along it.
    expect(projectOntoPerimeter({ x: 250, y: 190 }, CARD)).toEqual({ x: 0.75, y: 0 });
    // Below the bottom edge, a fifth along.
    expect(projectOntoPerimeter({ x: 140, y: 340 }, CARD)).toEqual({ x: 0.2, y: 1 });
    // Left of the card, a third down.
    expect(projectOntoPerimeter({ x: 80, y: 233 }, CARD)).toEqual({ x: 0, y: 0.33 });
    // Right of the card, two thirds down.
    expect(projectOntoPerimeter({ x: 400, y: 266 }, CARD)).toEqual({ x: 1, y: 0.66 });
  });

  it("should never answer a point inside the box", () => {
    const middle = projectOntoPerimeter({ x: 200, y: 250 }, CARD);
    expect(
      middle === null ? null : middle.x === 0 || middle.x === 1 || middle.y === 0 || middle.y === 1,
    ).toBe(true);
  });

  it("should answer null for a card that has no usable box", () => {
    expect(projectOntoPerimeter({ x: 0, y: 0 }, null)).toBeNull();
    expect(
      projectOntoPerimeter({ x: 0, y: 0 }, { x: 0, y: 0, width: Number.NaN, height: 10 }),
    ).toBeNull();
    expect(projectOntoPerimeter({ x: Number.NaN, y: 0 }, CARD)).toBeNull();
  });
});

describe("magnetizePerimeter", () => {
  it("should snap to an anchor the pointer is already close to", () => {
    expect(magnetizePerimeter({ x: 0.48, y: 0.02 }, CARD, 20)).toEqual({ x: 0.5, y: 0 });
    expect(magnetizePerimeter({ x: 1, y: 0.47 }, CARD, 20)).toEqual({ x: 1, y: 0.5 });
  });

  it("should leave a free position free", () => {
    expect(magnetizePerimeter({ x: 0.75, y: 0 }, CARD, 20)).toEqual({ x: 0.75, y: 0 });
  });

  it("should measure the pull in world units, so a corner is further than a side", () => {
    // 40 world units from the top-left corner is out of reach of a 20-unit magnet…
    expect(magnetizePerimeter({ x: 0.2, y: 0 }, CARD, 20)).toEqual({ x: 0.2, y: 0 });
    // …and inside it at 40.
    expect(magnetizePerimeter({ x: 0.1, y: 0 }, CARD, 40)).toEqual({ x: 0, y: 0 });
  });

  it("should ignore a zero radius and a card with no box", () => {
    expect(magnetizePerimeter({ x: 0.5, y: 0 }, CARD, 0)).toEqual({ x: 0.5, y: 0 });
    expect(magnetizePerimeter({ x: 0.5, y: 0 }, null, 20)).toEqual({ x: 0.5, y: 0 });
  });
});

describe("connectorMoveTarget", () => {
  it("should project and then magnetise, in that order", () => {
    expect(connectorMoveTarget({ x: 200, y: 190 }, CARD, 20)).toEqual({ x: 0.5, y: 0 });
    expect(connectorMoveTarget({ x: 250, y: 190 }, CARD, 20)).toEqual({ x: 0.75, y: 0 });
  });
});

describe("connectorMagnetRadius", () => {
  it("should keep a constant screen pull as the camera moves", () => {
    expect(connectorMagnetRadius(1)).toBe(CONNECTOR_MAGNET_PX);
    expect(connectorMagnetRadius(2)).toBe(CONNECTOR_MAGNET_PX / 2);
    expect(connectorMagnetRadius(0)).toBe(CONNECTOR_MAGNET_PX);
    expect(connectorMagnetRadius(Number.NaN)).toBe(CONNECTOR_MAGNET_PX);
  });
});
