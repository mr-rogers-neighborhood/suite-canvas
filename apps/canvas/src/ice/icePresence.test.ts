import { describe, expect, it } from "vitest";
import type { PeerPresence } from "../collab/presence";
import {
  dragSample,
  EMPTY_ICE_PRESENCE_FRAME,
  type IcePresenceInstance,
  type IceScreenRect,
  marqueeSample,
  pointerSample,
  presenceRoleCaps,
  projectPeerPresence,
  selectionSample,
} from "./icePresence";

const BOARD = "board-root";
const OTHER_BOARD = "board-other";

function peer(patch: Partial<PeerPresence> = {}): PeerPresence {
  return {
    clientId: "peer-1",
    board: BOARD,
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

function peersOf(...entries: [string, PeerPresence][]): Record<string, PeerPresence> {
  return Object.fromEntries(entries);
}

function instance(
  instanceKey: string,
  cardId: string,
  rect: { x: number; y: number; width: number; height: number },
  boardId = BOARD,
): IcePresenceInstance {
  return { instanceKey, cardId, boardId, rect };
}

const CAMERA = { x: 0, y: 0, zoom: 1 };
const VIEWPORT: IceScreenRect = { left: 0, top: 0, width: 1000, height: 800 };

describe("projectPeerPresence", () => {
  it("drops a peer looking at another board", () => {
    const frame = projectPeerPresence({
      peers: peersOf(
        [
          "peer-1",
          peer({
            pointer: { x: 10, y: 20 },
            selection: { nodeIds: ["card-1"] },
            selectionBox: { x: 0, y: 0, width: 10, height: 10 },
          }),
        ],
        ["peer-2", peer({ clientId: "peer-2", board: OTHER_BOARD, pointer: { x: 5, y: 5 } })],
      ),
      camera: CAMERA,
      boardId: BOARD,
      instances: [instance("i1", "card-1", { x: 0, y: 0, width: 100, height: 50 })],
      viewport: VIEWPORT,
    });

    expect(frame.cursors.map((cursor) => cursor.peerId)).toEqual(["peer-1"]);
    expect(frame.rings).toHaveLength(1);
    expect(frame.marquee?.peerId).toBe("peer-1");
  });

  it("maps a pointer through the camera at zoom 0.5 and with an offset", () => {
    const frame = projectPeerPresence({
      peers: peersOf(["peer-1", peer({ pointer: { x: 300, y: 250 } })]),
      camera: { x: 100, y: 50, zoom: 0.5 },
      boardId: BOARD,
      instances: [],
    });

    expect(frame.cursors).toEqual([
      { peerId: "peer-1", name: "Ada", color: "#f43f5e", x: 100, y: 100, boardId: null },
    ]);

    const zoomedIn = projectPeerPresence({
      peers: peersOf(["peer-1", peer({ pointer: { x: 0, y: 0 } })]),
      camera: { x: -50, y: 20, zoom: 2 },
      boardId: BOARD,
      instances: [],
    });
    expect(zoomedIn.cursors[0]).toMatchObject({ x: 100, y: -40 });
  });

  it("drops a pointer outside the viewport but keeps one on the edge", () => {
    const frame = projectPeerPresence({
      peers: peersOf(
        ["peer-1", peer({ pointer: { x: 2000, y: 0 } })],
        ["peer-2", peer({ clientId: "peer-2", pointer: { x: 1000, y: 800 } })],
      ),
      camera: CAMERA,
      boardId: BOARD,
      instances: [],
      viewport: VIEWPORT,
    });

    expect(frame.cursors).toEqual([
      { peerId: "peer-2", name: "Ada", color: "#f43f5e", x: 1000, y: 800, boardId: null },
    ]);
  });

  it("says which Board a peer's pointer is inside without hiding them", () => {
    const frame = projectPeerPresence({
      peers: peersOf(["peer-1", peer({ boardOf: "board-interviews", pointer: { x: 10, y: 20 } })]),
      camera: CAMERA,
      boardId: BOARD,
      instances: [],
    });

    // Same View, so the peer still contributes; the Board is attribution.
    expect(frame.cursors).toEqual([
      {
        peerId: "peer-1",
        name: "Ada",
        color: "#f43f5e",
        x: 10,
        y: 20,
        boardId: "board-interviews",
      },
    ]);
  });

  it("gives two instances of one card two rings, and skips other boards", () => {
    const frame = projectPeerPresence({
      peers: peersOf(["peer-1", peer({ selection: { nodeIds: ["card-1"] } })]),
      camera: CAMERA,
      boardId: BOARD,
      instances: [
        instance("i1", "card-1", { x: 10, y: 20, width: 100, height: 50 }),
        instance("i2", "card-1", { x: 500, y: 20, width: 100, height: 50 }),
        instance("i3", "card-1", { x: 10, y: 20, width: 100, height: 50 }, OTHER_BOARD),
        instance("i4", "card-2", { x: 10, y: 20, width: 100, height: 50 }),
      ],
      viewport: VIEWPORT,
    });

    expect(frame.rings.map((ring) => ring.instanceKey)).toEqual(["i1", "i2"]);
    expect(frame.rings[0]).toEqual({
      peerId: "peer-1",
      color: "#f43f5e",
      cardId: "card-1",
      instanceKey: "i1",
      rect: { left: 10, top: 20, width: 100, height: 50 },
    });
  });

  it("projects rings through the camera", () => {
    const frame = projectPeerPresence({
      peers: peersOf(["peer-1", peer({ selection: { nodeIds: ["card-1"] } })]),
      camera: { x: 10, y: 40, zoom: 2 },
      boardId: BOARD,
      instances: [instance("i1", "card-1", { x: 20, y: 50, width: 100, height: 50 })],
      viewport: VIEWPORT,
    });

    expect(frame.rings[0]?.rect).toEqual({ left: 20, top: 20, width: 200, height: 100 });
  });

  it("drops a ring that lies outside the viewport", () => {
    const frame = projectPeerPresence({
      peers: peersOf(["peer-1", peer({ selection: { nodeIds: ["card-1"] } })]),
      camera: CAMERA,
      boardId: BOARD,
      instances: [instance("i1", "card-1", { x: 5000, y: 0, width: 100, height: 50 })],
      viewport: VIEWPORT,
    });

    expect(frame.rings).toEqual([]);
  });

  it("draws a ghost from the anchor position plus the per-card delta", () => {
    const frame = projectPeerPresence({
      peers: peersOf([
        "peer-1",
        peer({
          dragging: {
            nodeId: "card-1",
            position: { x: 130, y: 190 },
            nodeIds: ["card-1", "card-2"],
            boardId: BOARD,
          },
        }),
      ]),
      camera: CAMERA,
      boardId: BOARD,
      instances: [
        instance("i1", "card-1", { x: 100, y: 200, width: 120, height: 80 }),
        instance("i2", "card-1", { x: 400, y: 200, width: 120, height: 80 }),
        instance("i3", "card-2", { x: 800, y: 200, width: 60, height: 40 }),
      ],
      viewport: VIEWPORT,
    });

    // delta = (30, -10): the anchor's stored box moves to the live position and
    // every other member carries the same delta.
    expect(frame.ghosts.map((ghost) => [ghost.instanceKey, ghost.rect])).toEqual([
      ["i1", { left: 130, top: 190, width: 120, height: 80 }],
      ["i2", { left: 430, top: 190, width: 120, height: 80 }],
      ["i3", { left: 830, top: 190, width: 60, height: 40 }],
    ]);
    expect(frame.ghosts[0]).toMatchObject({
      peerId: "peer-1",
      color: "#f43f5e",
      name: "Ada",
      nodeIds: ["card-1", "card-2"],
    });
    // A drag suppresses the cursor on the wire, and the projection agrees.
    expect(frame.cursors).toEqual([]);
  });

  it("falls back to the anchor when a drag carries no nodeIds", () => {
    const frame = projectPeerPresence({
      peers: peersOf([
        "peer-1",
        peer({ dragging: { nodeId: "card-1", position: { x: 130, y: 190 }, nodeIds: [] } }),
      ]),
      camera: CAMERA,
      boardId: BOARD,
      instances: [
        instance("i1", "card-1", { x: 100, y: 200, width: 120, height: 80 }),
        instance("i3", "card-2", { x: 800, y: 200, width: 60, height: 40 }),
      ],
      viewport: VIEWPORT,
    });

    expect(frame.ghosts).toHaveLength(1);
    expect(frame.ghosts[0]).toMatchObject({
      instanceKey: "i1",
      nodeIds: ["card-1"],
      rect: { left: 130, top: 190 },
    });
  });

  it("ignores a drag published for another board", () => {
    const frame = projectPeerPresence({
      peers: peersOf([
        "peer-1",
        peer({
          dragging: {
            nodeId: "card-1",
            position: { x: 130, y: 190 },
            boardId: OTHER_BOARD,
          },
        }),
      ]),
      camera: CAMERA,
      boardId: BOARD,
      instances: [instance("i1", "card-1", { x: 100, y: 200, width: 120, height: 80 })],
      viewport: VIEWPORT,
    });

    expect(frame.ghosts).toEqual([]);
  });

  it("groups focus into editing entries per card and never into a caret", () => {
    const frame = projectPeerPresence({
      peers: peersOf(
        ["peer-1", peer({ focus: { nodeId: "card-1", field: "title" } })],
        [
          "peer-2",
          peer({
            clientId: "peer-2",
            user: { name: "Grace", color: "#22d3ee" },
            focus: { nodeId: "card-1", field: "body" },
          }),
        ],
        [
          "peer-3",
          peer({
            clientId: "peer-3",
            user: { name: "Linus", color: "#a3e635" },
            focus: { nodeId: "card-2" },
          }),
        ],
      ),
      camera: CAMERA,
      boardId: BOARD,
      instances: [],
      viewport: VIEWPORT,
    });

    expect(frame.editing).toEqual([
      {
        cardId: "card-1",
        peers: [
          { peerId: "peer-1", name: "Ada", color: "#f43f5e" },
          { peerId: "peer-2", name: "Grace", color: "#22d3ee" },
        ],
      },
      { cardId: "card-2", peers: [{ peerId: "peer-3", name: "Linus", color: "#a3e635" }] },
    ]);
    expect(frame.cursors).toEqual([]);
  });

  it("maps a marquee in board units to a screen rect", () => {
    const frame = projectPeerPresence({
      peers: peersOf(["peer-1", peer({ selectionBox: { x: 10, y: 20, width: 100, height: 40 } })]),
      camera: { x: 10, y: 20, zoom: 2 },
      boardId: BOARD,
      instances: [],
      viewport: VIEWPORT,
    });

    expect(frame.marquee).toEqual({
      peerId: "peer-1",
      color: "#f43f5e",
      rect: { left: 0, top: 0, width: 200, height: 80 },
    });
  });

  it("keeps one marquee, chosen by peer id rather than insertion order", () => {
    const frame = projectPeerPresence({
      peers: peersOf(
        [
          "peer-9",
          peer({ clientId: "peer-9", selectionBox: { x: 0, y: 0, width: 10, height: 10 } }),
        ],
        [
          "peer-2",
          peer({ clientId: "peer-2", selectionBox: { x: 5, y: 5, width: 10, height: 10 } }),
        ],
      ),
      camera: CAMERA,
      boardId: BOARD,
      instances: [],
      viewport: VIEWPORT,
    });

    expect(frame.marquee?.peerId).toBe("peer-2");
  });

  it("returns the shared empty frame for no peers", () => {
    expect(projectPeerPresence({ peers: {}, camera: CAMERA, boardId: BOARD, instances: [] })).toBe(
      EMPTY_ICE_PRESENCE_FRAME,
    );
  });

  it("draws a peer's in-flight link from the connector it left", () => {
    const frame = projectPeerPresence({
      peers: peersOf([
        "peer-1",
        peer({
          connect: {
            nodeId: "card-1",
            connectorId: "c-east",
            anchorEnd: "source",
            position: { x: 200, y: 120 },
          },
        }),
      ]),
      camera: CAMERA,
      boardId: BOARD,
      instances: [],
      anchorOf: (cardId, connectorId) =>
        cardId === "card-1" && connectorId === "c-east" ? { x: 50, y: 60 } : null,
    });

    expect(frame.links).toEqual([
      {
        peerId: "peer-1",
        name: "Ada",
        color: "#f43f5e",
        from: { x: 50, y: 60 },
        to: { x: 200, y: 120 },
        compatible: false,
      },
    ]);
  });

  it("marks a link the peer has snapped to a compatible connector", () => {
    const frame = projectPeerPresence({
      peers: peersOf([
        "peer-1",
        peer({
          connect: {
            nodeId: "card-1",
            connectorId: "c-east",
            anchorEnd: "source",
            position: { x: 10, y: 10 },
            target: { nodeId: "card-2", connectorId: "c-west" },
          },
        }),
      ]),
      camera: CAMERA,
      boardId: BOARD,
      instances: [],
      anchorOf: () => ({ x: 0, y: 0 }),
    });
    expect(frame.links[0]?.compatible).toBe(true);
  });

  it("draws no link when the surface cannot resolve the connector", () => {
    const frame = projectPeerPresence({
      peers: peersOf([
        "peer-1",
        peer({
          connect: {
            nodeId: "card-1",
            connectorId: "c-east",
            anchorEnd: "source",
            position: { x: 10, y: 10 },
          },
        }),
      ]),
      camera: CAMERA,
      boardId: BOARD,
      instances: [],
      anchorOf: () => null,
    });
    expect(frame.links).toEqual([]);
    // No anchor, no preview: the frame is empty enough to share.
    expect(frame).toBe(EMPTY_ICE_PRESENCE_FRAME);
  });

  it("ignores non-finite samples and refuses a broken camera", () => {
    const bad = projectPeerPresence({
      peers: peersOf([
        "peer-1",
        peer({
          pointer: { x: Number.NaN, y: 0 },
          selectionBox: { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 },
          dragging: { nodeId: "card-1", position: { x: Number.NaN, y: 0 } },
        }),
      ]),
      camera: CAMERA,
      boardId: BOARD,
      instances: [instance("i1", "card-1", { x: 100, y: 200, width: 120, height: 80 })],
      viewport: VIEWPORT,
    });

    expect(bad.cursors).toEqual([]);
    expect(bad.ghosts).toEqual([]);
    expect(bad.marquee).toBeNull();

    expect(
      projectPeerPresence({
        peers: peersOf(["peer-1", peer({ pointer: { x: 1, y: 2 } })]),
        camera: { x: 0, y: 0, zoom: 0 },
        boardId: BOARD,
        instances: [],
      }),
    ).toBe(EMPTY_ICE_PRESENCE_FRAME);

    expect(
      projectPeerPresence({
        peers: peersOf(["peer-1", peer({ pointer: { x: 1, y: 2 } })]),
        camera: null,
        boardId: BOARD,
        instances: [],
      }),
    ).toBe(EMPTY_ICE_PRESENCE_FRAME);
  });
});

describe("pointerSample", () => {
  it("publishes board units, which are ICE world units", () => {
    expect(pointerSample({ x: 12.5, y: -3 }, { x: 400, y: 300, zoom: 2 })).toEqual({
      x: 12.5,
      y: -3,
    });
  });

  it("round-trips through the projection", () => {
    const camera = { x: 40, y: 60, zoom: 0.5 };
    const sample = pointerSample({ x: 100, y: 200 }, camera);
    expect(sample).not.toBeNull();
    if (!sample) return;
    const frame = projectPeerPresence({
      peers: peersOf(["peer-1", peer({ pointer: sample })]),
      camera,
      boardId: BOARD,
      instances: [],
    });
    expect(frame.cursors[0]).toMatchObject({ x: 30, y: 70 });
  });

  it("drops the sample when the camera or the point is unusable", () => {
    expect(pointerSample({ x: 1, y: 2 }, null)).toBeNull();
    expect(pointerSample(null, CAMERA)).toBeNull();
    expect(pointerSample({ x: Number.NaN, y: 2 }, CAMERA)).toBeNull();
  });
});

describe("dragSample", () => {
  it("publishes the live box top-left and the whole dragged set", () => {
    expect(
      dragSample("card-1", BOARD, { x: 100, y: 200, width: 120, height: 80 }, ["card-1", "card-2"]),
    ).toEqual({
      nodeId: "card-1",
      position: { x: 100, y: 200 },
      nodeIds: ["card-1", "card-2"],
      boardId: BOARD,
    });
  });

  it("keeps a single-card drag free of nodeIds", () => {
    const sample = dragSample("card-1", BOARD, { x: 0, y: 0, width: 10, height: 10 });
    expect(sample).toEqual({ nodeId: "card-1", position: { x: 0, y: 0 }, boardId: BOARD });
    expect(sample && "nodeIds" in sample).toBe(false);
  });

  it("refuses a gesture with no usable box", () => {
    expect(dragSample("card-1", BOARD, null)).toBeNull();
    expect(dragSample("card-1", BOARD, { x: 0, y: 0, width: Number.NaN, height: 10 })).toBeNull();
    expect(dragSample("", BOARD, { x: 0, y: 0, width: 10, height: 10 })).toBeNull();
  });
});

describe("selectionSample", () => {
  it("dedupes ids and omits empty optional sets", () => {
    expect(selectionSample(["card-1", "card-2", "card-1"])).toEqual({
      nodeIds: ["card-1", "card-2"],
    });
    expect(selectionSample([], [], null)).toEqual({ nodeIds: [] });
    expect(selectionSample(["card-1"], ["edge-1"], "section-1")).toEqual({
      nodeIds: ["card-1"],
      edgeIds: ["edge-1"],
      sectionId: "section-1",
    });
  });
});

describe("marqueeSample", () => {
  it("normalises a marquee dragged up and left", () => {
    expect(marqueeSample({ x: 100, y: 100, width: -40, height: -20 })).toEqual({
      x: 60,
      y: 80,
      width: 40,
      height: 20,
    });
  });

  it("drops a non-finite box", () => {
    expect(marqueeSample(null)).toBeNull();
    expect(marqueeSample({ x: 0, y: 0, width: Number.NaN, height: 10 })).toBeNull();
  });
});

describe("presenceRoleCaps", () => {
  it("lets a viewer point and select but never drag, resize or marquee", () => {
    expect(presenceRoleCaps("viewer")).toEqual({
      pointer: true,
      selection: true,
      drag: false,
      resize: false,
      marquee: false,
    });
  });

  it("lets an owner and an editor publish every gesture", () => {
    for (const role of ["owner", "editor"] as const) {
      expect(presenceRoleCaps(role)).toEqual({
        pointer: true,
        selection: true,
        drag: true,
        resize: true,
        marquee: true,
      });
    }
  });
});
