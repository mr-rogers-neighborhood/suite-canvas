import type { Connector } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  beginLinkDrag,
  boardAnchors,
  connectorAnchors,
  connectorAt,
  connectSample,
  endLinkDrag,
  LINK_HOTSPOT_PX,
  type LinkDragState,
  linkHotspotRadius,
  linkMinTravel,
  moveLinkDrag,
  nearestConnector,
} from "./iceLinkDrag";

const RECT = { x: 100, y: 50, width: 200, height: 100 };

const CONNECTORS: Connector[] = [
  { id: "north", x: 0.5, y: 0 },
  { id: "east", x: 1, y: 0.5 },
  { id: "south", x: 0.5, y: 1 },
  { id: "west", x: 0, y: 0.5 },
];

const anchors = () => connectorAnchors(CONNECTORS, RECT);

describe("connectorAnchors", () => {
  it("maps fractions onto the card's world box", () => {
    expect(anchors()).toEqual([
      { connectorId: "north", point: { x: 200, y: 50 } },
      { connectorId: "east", point: { x: 300, y: 100 } },
      { connectorId: "south", point: { x: 200, y: 150 } },
      { connectorId: "west", point: { x: 100, y: 100 } },
    ]);
  });

  it("clamps a connector that drifted out of its box", () => {
    const [anchor] = connectorAnchors([{ id: "odd", x: 1.4, y: -0.2 }], RECT);
    expect(anchor?.point).toEqual({ x: 300, y: 50 });
  });

  it("has no anchors without a usable box", () => {
    expect(connectorAnchors(CONNECTORS, null)).toEqual([]);
    expect(connectorAnchors(CONNECTORS, { x: Number.NaN, y: 0, width: 10, height: 10 })).toEqual(
      [],
    );
  });
});

describe("hotspots", () => {
  it("keeps the press radius ten screen pixels at any zoom", () => {
    expect(linkHotspotRadius(1)).toBe(LINK_HOTSPOT_PX);
    expect(linkHotspotRadius(2)).toBe(LINK_HOTSPOT_PX / 2);
    expect(linkHotspotRadius(0)).toBe(LINK_HOTSPOT_PX);
    expect(linkMinTravel(4)).toBe(1);
  });

  it("finds the connector under a press and nothing outside the radius", () => {
    expect(connectorAt(anchors(), { x: 302, y: 101 }, 10)?.connectorId).toBe("east");
    expect(connectorAt(anchors(), { x: 320, y: 101 }, 10)).toBeNull();
  });

  it("snaps a drop to the nearest connector", () => {
    expect(nearestConnector(anchors(), { x: 190, y: 55 })?.connectorId).toBe("north");
    expect(nearestConnector([], { x: 0, y: 0 })).toBeNull();
    expect(nearestConnector(anchors(), null)).toBeNull();
  });
});

describe("the link drag", () => {
  const start = (): LinkDragState => {
    const state = beginLinkDrag({
      boardId: "view-1",
      id: "card-a",
      connectorId: "east",
      anchor: { x: 300, y: 100 },
      pointer: { x: 300, y: 100 },
      minTravel: 4,
    });
    if (state === null) throw new Error("a press on a connector must start a drag");
    return state;
  };

  it("starts from a connector, and refuses a press with no anchor", () => {
    expect(start()).toMatchObject({
      source: { kind: "card", id: "card-a", connectorId: "east" },
      target: null,
    });
    expect(
      beginLinkDrag({
        boardId: "view-1",
        id: "card-a",
        connectorId: "east",
        anchor: null,
        pointer: { x: 0, y: 0 },
      }),
    ).toBeNull();
    expect(
      beginLinkDrag({
        boardId: "view-1",
        id: "card-a",
        connectorId: "",
        anchor: { x: 0, y: 0 },
        pointer: { x: 0, y: 0 },
      }),
    ).toBeNull();
  });

  it("tracks the pointer and the connector it is aimed at", () => {
    const state = moveLinkDrag(
      start(),
      { x: 500, y: 200 },
      {
        kind: "card",
        id: "card-b",
        connectorId: "west",
        point: { x: 500, y: 200 },
      },
    );
    expect(state.pointer).toEqual({ x: 500, y: 200 });
    expect(state.target?.id).toBe("card-b");
  });

  it("never targets the card it started from", () => {
    const state = moveLinkDrag(
      start(),
      { x: 520, y: 200 },
      {
        kind: "card",
        id: "card-a",
        connectorId: "north",
        point: { x: 520, y: 200 },
      },
    );
    expect(state.target).toBeNull();
  });

  it("commits one edge when it lands on another card", () => {
    const state = moveLinkDrag(
      start(),
      { x: 500, y: 200 },
      {
        kind: "card",
        id: "card-b",
        connectorId: "west",
        point: { x: 500, y: 200 },
      },
    );
    expect(endLinkDrag(state)).toEqual({
      kind: "edge-create",
      boardId: "view-1",
      source: { cardId: "card-a", connectorId: "east" },
      target: { cardId: "card-b", connectorId: "west" },
    });
  });

  it("commits nothing without a target, on itself, or on a click", () => {
    expect(endLinkDrag(null)).toBeNull();
    expect(endLinkDrag(start())).toBeNull();

    const self = moveLinkDrag(
      start(),
      { x: 520, y: 200 },
      {
        kind: "card",
        id: "card-a",
        connectorId: "north",
        point: { x: 520, y: 200 },
      },
    );
    expect(endLinkDrag(self)).toBeNull();

    const tiny = moveLinkDrag(
      start(),
      { x: 301, y: 100 },
      {
        kind: "card",
        id: "card-b",
        connectorId: "west",
        point: { x: 301, y: 100 },
      },
    );
    expect(endLinkDrag(tiny)).toBeNull();
  });

  it("publishes the gesture a peer draws, snap included", () => {
    const state = moveLinkDrag(
      start(),
      { x: 500, y: 200 },
      {
        kind: "card",
        id: "card-b",
        connectorId: "west",
        point: { x: 500, y: 200 },
      },
    );
    expect(connectSample(state)).toEqual({
      nodeId: "card-a",
      connectorId: "east",
      anchorEnd: "source",
      position: { x: 500, y: 200 },
      target: { nodeId: "card-b", connectorId: "west" },
    });
    const free = connectSample(start());
    expect(free).not.toHaveProperty("target");
  });
});

describe("a link that ends on a Board", () => {
  const FRAME = { x: 100, y: 50, width: 400, height: 200 };

  it("offers the four wall midpoints instead of connectors", () => {
    expect(boardAnchors(FRAME).map((anchor) => [anchor.connectorId, anchor.point])).toEqual([
      ["side:north", { x: 300, y: 50 }],
      ["side:east", { x: 500, y: 150 }],
      ["side:south", { x: 300, y: 250 }],
      ["side:west", { x: 100, y: 150 }],
    ]);
    expect(boardAnchors(null)).toEqual([]);
  });

  it("starts from a wall and commits the frame as the end", () => {
    const state = beginLinkDrag({
      boardId: "view-1",
      id: "board-a",
      kind: "board",
      connectorId: "side:east",
      anchor: { x: 500, y: 150 },
      pointer: { x: 500, y: 150 },
      minTravel: 4,
    });
    expect(state).not.toBeNull();
    if (state === null) throw new Error("a press on a wall must start a drag");
    expect(state.source).toEqual({
      kind: "board",
      id: "board-a",
      point: { x: 500, y: 150 },
    });

    const aimed = moveLinkDrag(
      state,
      { x: 700, y: 150 },
      {
        kind: "card",
        id: "card-b",
        connectorId: "west",
        point: { x: 700, y: 150 },
      },
    );
    expect(endLinkDrag(aimed)).toEqual({
      kind: "edge-create",
      boardId: "view-1",
      source: { cardId: "board-a", kind: "board" },
      target: { cardId: "card-b", connectorId: "west" },
    });
  });

  it("links two frames, and never a frame to itself", () => {
    const state = beginLinkDrag({
      boardId: "view-1",
      id: "board-a",
      kind: "board",
      connectorId: "side:east",
      anchor: { x: 500, y: 150 },
      pointer: { x: 500, y: 150 },
      minTravel: 4,
    });
    if (state === null) throw new Error("a press on a wall must start a drag");
    const boardEnd = { kind: "board" as const, id: "board-b", point: { x: 900, y: 150 } };
    expect(endLinkDrag(moveLinkDrag(state, { x: 900, y: 150 }, boardEnd))).toEqual({
      kind: "edge-create",
      boardId: "view-1",
      source: { cardId: "board-a", kind: "board" },
      target: { cardId: "board-b", kind: "board" },
    });

    const self = { kind: "board" as const, id: "board-a", point: { x: 400, y: 150 } };
    expect(moveLinkDrag(state, { x: 400, y: 150 }, self).target).toBeNull();
  });

  it("does not require a connector on a Board end", () => {
    expect(
      beginLinkDrag({
        boardId: "view-1",
        id: "board-a",
        kind: "board",
        anchor: { x: 500, y: 150 },
        pointer: { x: 500, y: 150 },
      }),
    ).not.toBeNull();
  });
});
