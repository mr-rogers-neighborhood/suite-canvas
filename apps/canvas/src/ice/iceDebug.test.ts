import { describe, expect, it } from "vitest";
import type { PeerPresence } from "../collab/presence";
import {
  buildIceDebugSnapshot,
  EMPTY_OVERLAYS,
  ICE_DEBUG_GLOBAL,
  publishIceDebug,
  readIceOverlays,
} from "./iceDebug";

function peer(patch: Partial<PeerPresence> = {}): PeerPresence {
  return {
    clientId: "peer-1",
    board: "view-root",
    boardOf: null,
    user: { name: "Ada", color: "#f43f5e" },
    pointer: null,
    focus: null,
    dragging: null,
    selection: null,
    selectionBox: null,
    connector: null,
    resizing: null,
    sectionDrag: null,
    sectionResize: null,
    reconnect: null,
    connect: null,
    labelDrag: null,
    ...patch,
  };
}

function box(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("buildIceDebugSnapshot", () => {
  it("rounds placement and drops samples that cannot be drawn", () => {
    const snapshot = buildIceDebugSnapshot({
      at: 1234.6,
      camera: { x: 10, y: 20, zoom: 1 },
      entered: [{ id: "board-start", name: "Start here" }],
      boards: [
        {
          id: "board-start",
          name: "Start here",
          parentBoardId: null,
          depth: 1,
          world: { x: 44, y: 74, width: 816, height: 280 },
        },
      ],
      slots: [
        {
          entity: 1,
          cardId: "card-a",
          boardId: "board-start",
          local: { x: 10.1234, y: 20, width: 100, height: 50 },
          world: { x: 210.9876, y: 120, width: 100, height: 50 },
        },
        {
          entity: 2,
          cardId: "card-b",
          boardId: "board-start",
          local: { x: Number.NaN, y: 0, width: 10, height: 10 },
          world: { x: 0, y: 0, width: 10, height: 10 },
        },
      ],
      edges: [
        {
          edgeId: "edge-1",
          frame: "board-start",
          from: { x: 11.234, y: 12.986 },
          to: { x: 30, y: 40 },
          kind: "references",
          label: null,
          sourceKind: null,
          targetKind: null,
        },
      ],
      overlays: EMPTY_OVERLAYS,
      peers: { "peer-1": peer({ pointer: { x: 5.005, y: 6.004 } }) },
      selection: ["card-a"],
    });

    expect(snapshot.at).toBe(1235);
    expect(snapshot.entered).toEqual([{ id: "board-start", name: "Start here" }]);
    expect(snapshot.slots).toHaveLength(1);
    expect(snapshot.slots[0]?.local).toEqual({ x: 10.12, y: 20, width: 100, height: 50 });
    expect(snapshot.slots[0]?.world.x).toBe(210.99);
    expect(snapshot.edges[0]?.from).toEqual({ x: 11.23, y: 12.99 });
    expect(snapshot.peers[0]).toMatchObject({ name: "Ada", pointer: { x: 5, y: 6 } });
    expect(snapshot.selection).toEqual(["card-a"]);
  });

  it("keeps peers in a stable order so a diff is about them, not the map", () => {
    const snapshot = buildIceDebugSnapshot({
      at: 0,
      camera: null,
      entered: [],
      boards: [],
      slots: [],
      edges: [],
      overlays: EMPTY_OVERLAYS,
      peers: {
        "peer-z": peer({ clientId: "peer-z", user: { name: "Zoe", color: "#000" } }),
        "peer-a": peer({ clientId: "peer-a", user: { name: "Ada", color: "#fff" } }),
      },
      selection: [],
    });
    expect(snapshot.peers.map((entry) => entry.clientId)).toEqual(["peer-a", "peer-z"]);
  });

  it("drops an edge with an unusable end instead of publishing NaN", () => {
    const snapshot = buildIceDebugSnapshot({
      at: 0,
      camera: null,
      entered: [],
      boards: [],
      slots: [],
      edges: [
        {
          edgeId: "bad",
          frame: "view-root",
          from: { x: Number.NaN, y: 0 },
          to: { x: 1, y: 1 },
          kind: "references",
          label: null,
          sourceKind: null,
          targetKind: null,
        },
      ],
      overlays: EMPTY_OVERLAYS,
      peers: {},
      selection: [],
    });
    expect(snapshot.edges).toEqual([]);
  });
});

describe("readIceOverlays", () => {
  it("reports layer geometry relative to the overlay host", () => {
    const host = document.createElement("div");
    host.getBoundingClientRect = () => box(0, 44, 1440, 856);

    const dot = document.createElement("div");
    dot.dataset.testid = "suite-connector-dot";
    dot.getBoundingClientRect = () => box(100, 50, 7, 7);

    const cursor = document.createElement("div");
    cursor.dataset.testid = "ice-presence-cursor";
    cursor.getBoundingClientRect = () => box(300, 200, 40, 18);
    const label = document.createElement("span");
    label.dataset.testid = "ice-presence-cursor-label";
    label.textContent = "Ada · Interviews";
    cursor.append(label);

    const ring = document.createElement("div");
    ring.dataset.testid = "ice-presence-ring";
    ring.getBoundingClientRect = () => box(200, 100, 240, 160);

    const marquee = document.createElement("div");
    marquee.dataset.testid = "ice-presence-marquee";
    marquee.getBoundingClientRect = () => box(10, 60, 80, 40);

    const drag = document.createElementNS("http://www.w3.org/2000/svg", "line");
    drag.setAttribute("data-testid", "suite-connector-drag");
    drag.setAttribute("x1", "120");
    drag.setAttribute("y1", "130");
    drag.setAttribute("x2", "220");
    drag.setAttribute("y2", "230");

    host.append(dot, cursor, ring, marquee, drag);
    document.body.append(host);

    const overlays = readIceOverlays(host);
    // The dot's viewport y (50) is 6 px below the host's top (44).
    expect(overlays.connectorDots).toEqual([{ x: 103.5, y: 9.5 }]);
    expect(overlays.cursors).toEqual([{ x: 300, y: 156, name: "Ada", board: "Interviews" }]);
    expect(overlays.rings).toEqual([{ x: 200, y: 56, width: 240, height: 160 }]);
    expect(overlays.marquee).toEqual({ x: 10, y: 16, width: 80, height: 40 });
    expect(overlays.connectorDrag).toEqual({ from: { x: 120, y: 130 }, to: { x: 220, y: 230 } });
    host.remove();
  });

  it("is empty without a host", () => {
    expect(readIceOverlays(null)).toBe(EMPTY_OVERLAYS);
  });
});

describe("publishIceDebug", () => {
  it("writes the snapshot where the lab runner looks for it", () => {
    const target: Record<string, unknown> = {};
    const snapshot = buildIceDebugSnapshot({
      at: 0,
      camera: null,
      entered: [],
      boards: [],
      slots: [],
      edges: [],
      overlays: EMPTY_OVERLAYS,
      peers: {},
      selection: [],
    });
    publishIceDebug(snapshot, target);
    expect(target[ICE_DEBUG_GLOBAL]).toBe(snapshot);
  });
});
