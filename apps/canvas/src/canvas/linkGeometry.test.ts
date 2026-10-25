import type { Card, Placement, Section } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  anchorOnRect,
  endpointAnchor,
  endpointAtPoint,
  endpointConnector,
  endpointRect,
  type LinkScene,
  linkAnchors,
  nearestSideAnchor,
  rectContains,
  segmentCrossesRect,
} from "./linkGeometry";

const BOARD = "board-1";
const OTHER = "board-2";

function placement(overrides: Partial<Placement> = {}): Placement {
  return {
    boardId: BOARD,
    cardId: "card-1",
    x: 0,
    y: 0,
    z: 0,
    createdAt: 0,
    ...overrides,
  };
}

function section(overrides: Partial<Section> = {}): Section {
  return {
    id: "section-1",
    boardId: BOARD,
    title: "Section",
    x: 400,
    y: 0,
    width: 320,
    height: 200,
    z: 0,
    createdAt: 0,
    updatedAt: 0,
    connectors: [
      { id: "s-top", x: 0.5, y: 0 },
      { id: "s-right", x: 1, y: 0.5 },
    ],
    ...overrides,
  };
}

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "card-1",
    primaryTypeId: "note",
    typeIds: ["note"],
    tags: [],
    properties: {},
    connectors: [
      { id: "c-top", x: 0.5, y: 0 },
      { id: "c-right", x: 1, y: 0.5 },
    ],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Card;
}

function scene(overrides: Partial<LinkScene> = {}): LinkScene {
  return {
    placements: [placement()],
    sections: [section()],
    cards: [card()],
    portals: [],
    ...overrides,
  };
}

describe("endpointRect", () => {
  it("uses the placement geometry, defaulting to the card's natural size", () => {
    expect(endpointRect({ kind: "card", id: "card-1" }, BOARD, scene())).toEqual({
      x: 0,
      y: 0,
      width: 288,
      height: 240,
    });
  });

  it("honours a resized placement", () => {
    const resized = scene({ placements: [placement({ width: 400, height: 300 })] });
    expect(endpointRect({ kind: "card", id: "card-1" }, BOARD, resized)).toMatchObject({
      width: 400,
      height: 300,
    });
  });

  it("resolves a section on its own board", () => {
    expect(endpointRect({ kind: "section", id: "section-1" }, BOARD, scene())).toEqual({
      x: 400,
      y: 0,
      width: 320,
      height: 200,
    });
  });

  it("resolves a board to the portal that opens it", () => {
    const withPortal = scene({
      portals: [{ boardId: BOARD, cardId: "card-1", targetBoardId: OTHER }],
    });
    expect(endpointRect({ kind: "board", id: OTHER }, BOARD, withPortal)).toMatchObject({
      x: 0,
      y: 0,
      width: 288,
    });
  });

  it("returns null when a board has no portal pointing at it", () => {
    expect(endpointRect({ kind: "board", id: OTHER }, BOARD, scene())).toBeNull();
  });

  it("returns null for an endpoint placed on another board", () => {
    expect(endpointRect({ kind: "card", id: "card-1" }, OTHER, scene())).toBeNull();
    expect(endpointRect({ kind: "section", id: "section-1" }, OTHER, scene())).toBeNull();
  });
});

describe("endpointConnector", () => {
  it("finds a card connector", () => {
    expect(
      endpointConnector({ kind: "card", id: "card-1", connectorId: "c-right" }, BOARD, scene()),
    ).toMatchObject({ x: 1, y: 0.5 });
  });

  it("finds a section connector", () => {
    expect(
      endpointConnector({ kind: "section", id: "section-1", connectorId: "s-top" }, BOARD, scene()),
    ).toMatchObject({ x: 0.5, y: 0 });
  });

  it("ignores a connector that no longer exists", () => {
    expect(
      endpointConnector({ kind: "card", id: "card-1", connectorId: "gone" }, BOARD, scene()),
    ).toBeUndefined();
  });

  it("resolves a board endpoint's connector on the portal that opens it", () => {
    const withPortal = scene({
      portals: [{ boardId: BOARD, cardId: "card-1", targetBoardId: OTHER }],
    });
    expect(
      endpointConnector({ kind: "board", id: OTHER, connectorId: "c-right" }, BOARD, withPortal),
    ).toMatchObject({ x: 1, y: 0.5 });
  });

  it("has no connector for a board with no portal, or an unknown dot", () => {
    expect(
      endpointConnector({ kind: "board", id: OTHER, connectorId: "c-right" }, BOARD, scene()),
    ).toBeUndefined();
    const withPortal = scene({
      portals: [{ boardId: BOARD, cardId: "card-1", targetBoardId: OTHER }],
    });
    expect(
      endpointConnector({ kind: "board", id: OTHER, connectorId: "gone" }, BOARD, withPortal),
    ).toBeUndefined();
  });
});

describe("anchors", () => {
  it("places a normalised point inside its rect", () => {
    expect(anchorOnRect({ x: 10, y: 20, width: 100, height: 50 }, { x: 0.5, y: 0.5 })).toEqual({
      x: 60,
      y: 45,
    });
  });

  it("clamps a normalised point to the rect", () => {
    expect(anchorOnRect({ x: 0, y: 0, width: 100, height: 100 }, { x: 2, y: -1 })).toEqual({
      x: 100,
      y: 0,
    });
  });

  it("exits through the side facing the other end", () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    expect(nearestSideAnchor(rect, { x: 500, y: 50 })).toEqual({ x: 100, y: 50 });
    expect(nearestSideAnchor(rect, { x: -500, y: 50 })).toEqual({ x: 0, y: 50 });
    expect(nearestSideAnchor(rect, { x: 50, y: 500 })).toEqual({ x: 50, y: 100 });
    expect(nearestSideAnchor(rect, { x: 50, y: -500 })).toEqual({ x: 50, y: 0 });
  });

  it("prefers a connector over the facing side", () => {
    const anchor = endpointAnchor(
      { kind: "card", id: "card-1", connectorId: "c-right" },
      BOARD,
      scene(),
      { x: -100, y: 0 },
    );
    // The connector wins even though the other end is to the left.
    expect(anchor).toEqual({ x: 288, y: 120 });
  });
});

describe("linkAnchors", () => {
  it("resolves both ends of a card to section link", () => {
    const anchors = linkAnchors(
      { source: { kind: "card", id: "card-1" }, target: { kind: "section", id: "section-1" } },
      BOARD,
      scene(),
    );
    expect(anchors).not.toBeNull();
    // The card is left of the section, so the link leaves its right edge.
    expect(anchors?.source.x).toBe(288);
  });

  it("returns null when either end cannot be drawn", () => {
    expect(
      linkAnchors(
        { source: { kind: "card", id: "card-1" }, target: { kind: "board", id: OTHER } },
        BOARD,
        scene(),
      ),
    ).toBeNull();
  });

  it("resolves a board endpoint through its portal", () => {
    const withPortal = scene({
      portals: [{ boardId: BOARD, cardId: "card-1", targetBoardId: OTHER }],
    });
    expect(
      linkAnchors(
        { source: { kind: "board", id: OTHER }, target: { kind: "section", id: "section-1" } },
        BOARD,
        withPortal,
      ),
    ).not.toBeNull();
  });
});

describe("rectContains and endpointAtPoint", () => {
  it("includes the boundary", () => {
    const rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectContains(rect, { x: 0, y: 0 })).toBe(true);
    expect(rectContains(rect, { x: 10, y: 10 })).toBe(true);
    expect(rectContains(rect, { x: 11, y: 5 })).toBe(false);
  });

  it("prefers a card over the section it sits in", () => {
    const overlapping = scene({
      placements: [placement({ x: 450, y: 50 })],
      sections: [section({ x: 400, y: 0, width: 320, height: 200 })],
    });
    expect(endpointAtPoint({ x: 460, y: 60 }, BOARD, overlapping)).toEqual({
      kind: "card",
      id: "card-1",
    });
  });

  it("picks the topmost card when two overlap, matching what the user sees", () => {
    const stacked = scene({
      placements: [
        placement({ cardId: "card-1", x: 0, y: 0, z: 0, createdAt: 10 }),
        placement({ cardId: "portal-1", x: 40, y: 40, z: 1, createdAt: 20 }),
      ],
    });
    expect(endpointAtPoint({ x: 100, y: 100 }, BOARD, stacked)).toEqual({
      kind: "card",
      id: "portal-1",
    });
  });

  it("breaks a paint-order tie by the newer placement", () => {
    const tied = scene({
      placements: [
        placement({ cardId: "card-1", x: 0, y: 0, z: 1, createdAt: 10 }),
        placement({ cardId: "portal-1", x: 40, y: 40, z: 1, createdAt: 20 }),
      ],
    });
    expect(endpointAtPoint({ x: 100, y: 100 }, BOARD, tied)).toEqual({
      kind: "card",
      id: "portal-1",
    });
  });

  it("finds a section when the point is outside every card", () => {
    const loose = scene({ placements: [placement({ x: 0, y: 0 })] });
    expect(endpointAtPoint({ x: 700, y: 150 }, BOARD, loose)).toEqual({
      kind: "section",
      id: "section-1",
    });
  });

  it("returns null on empty canvas", () => {
    expect(endpointAtPoint({ x: 5000, y: 5000 }, BOARD, scene())).toBeNull();
  });

  it("catches a link whose ends or span a box covers", () => {
    const box = { x: 100, y: 100, width: 100, height: 50 };
    // Both ends inside.
    expect(segmentCrossesRect({ x: 110, y: 110 }, { x: 190, y: 140 }, box)).toBe(true);
    // One end inside.
    expect(segmentCrossesRect({ x: 50, y: 50 }, { x: 150, y: 120 }, box)).toBe(true);
    // The span crosses the box with both ends outside.
    expect(segmentCrossesRect({ x: 0, y: 125 }, { x: 400, y: 125 }, box)).toBe(true);
    // A line that passes beside the box is untouched.
    expect(segmentCrossesRect({ x: 0, y: 300 }, { x: 400, y: 300 }, box)).toBe(false);
    expect(segmentCrossesRect({ x: 0, y: 0 }, { x: 90, y: 90 }, box)).toBe(false);
  });
});
