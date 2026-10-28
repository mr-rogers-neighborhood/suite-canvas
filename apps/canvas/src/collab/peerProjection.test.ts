import { describe, expect, it } from "vitest";
import {
  GESTURE_TTL_MS,
  gestureSignature,
  MAX_DRAG_NODE_IDS,
  PRESENCE_BEAT_MS,
  PRESENCE_TTL_MS,
  projectPeers,
  type SeenGesture,
} from "./peerProjection";
import { AWARENESS_FIELDS, type PeerPresence, peerIsInteracting } from "./presence";

const SELF = "self";
const PEER = "peer";

function states(overrides: Record<string, unknown> = {}) {
  return new Map<string, Record<string, unknown>>([
    [
      PEER,
      {
        [AWARENESS_FIELDS.user]: { name: "Ada", color: "#f00" },
        [AWARENESS_FIELDS.board]: "b1",
        [AWARENESS_FIELDS.dragging]: { nodeId: "n1", position: { x: 10, y: 20 } },
        ...overrides,
      },
    ],
  ]);
}

function project(
  now: number,
  seen: Map<string, SeenGesture>,
  overrides?: Record<string, unknown>,
  heard: Map<string, { marker: string; at: number }> = new Map(),
) {
  return projectPeers(states(overrides), { selfId: SELF, now, seen, heard });
}

describe("presence liveness", () => {
  const state = {
    [AWARENESS_FIELDS.user]: { name: "Nova", color: "#f97316" },
    [AWARENESS_FIELDS.presenceBeat]: 1,
  };

  it("keeps a peer who keeps beating", () => {
    const heard = new Map<string, { marker: string; at: number }>();
    const seen = new Map<string, SeenGesture>();
    projectPeers(new Map([[PEER, state]]), { selfId: SELF, now: 0, seen, heard });

    // Still here after a minute of silence-free beating, well past the ephemeral timeout.
    const peers = projectPeers(
      new Map([[PEER, { ...state, [AWARENESS_FIELDS.presenceBeat]: 9 }]]),
      {
        selfId: SELF,
        now: PRESENCE_BEAT_MS * 4,
        seen,
        heard,
      },
    );
    expect(peers[PEER]).toBeDefined();
  });

  it("drops a peer who stopped beating, because the relay never says they left", () => {
    const heard = new Map<string, { marker: string; at: number }>();
    const seen = new Map<string, SeenGesture>();
    projectPeers(new Map([[PEER, state]]), { selfId: SELF, now: 0, seen, heard });

    // The state is still in the store, because nothing removes it; only silence does.
    const peers = projectPeers(new Map([[PEER, state]]), {
      selfId: SELF,
      now: PRESENCE_TTL_MS + 1,
      seen,
      heard,
    });
    expect(peers[PEER]).toBeUndefined();
  });

  it("treats a state change as life for a peer on a build with no heartbeat", () => {
    const heard = new Map<string, { marker: string; at: number }>();
    const seen = new Map<string, SeenGesture>();
    const legacy = { [AWARENESS_FIELDS.user]: { name: "Nova", color: "#f97316" } };
    projectPeers(new Map([[PEER, legacy]]), { selfId: SELF, now: 0, seen, heard });

    const peers = projectPeers(new Map([[PEER, { ...legacy, [AWARENESS_FIELDS.board]: "b2" }]]), {
      selfId: SELF,
      now: PRESENCE_TTL_MS - 1000,
      seen,
      heard,
    });
    expect(peers[PEER]).toBeDefined();
  });
});

describe("projectPeers", () => {
  it("keeps a gesture that is still arriving", () => {
    const seen = new Map<string, SeenGesture>();
    project(1000, seen);
    const peers = project(1000 + GESTURE_TTL_MS - 1, seen);
    expect(peers[PEER]?.dragging).toMatchObject({ nodeId: "n1" });
  });

  it("drops a gesture that stopped arriving", () => {
    const seen = new Map<string, SeenGesture>();
    project(1000, seen);
    const peers = project(1000 + GESTURE_TTL_MS + 1, seen);
    expect(peers[PEER]?.dragging).toBeNull();
    // The peer itself stays; only the in-flight gesture expires.
    expect(peers[PEER]?.user.name).toBe("Ada");
  });

  it("keeps a held gesture alive on the sender's beat, not on movement", () => {
    const seen = new Map<string, SeenGesture>();
    project(1000, seen, { [AWARENESS_FIELDS.gestureBeat]: 1 });
    // The pointer never moves; only the liveness counter changes.
    project(3000, seen, { [AWARENESS_FIELDS.gestureBeat]: 3 });
    const peers = project(3000 + GESTURE_TTL_MS - 1, seen, {
      [AWARENESS_FIELDS.gestureBeat]: 3,
    });
    expect(peers[PEER]?.dragging).toMatchObject({ nodeId: "n1" });
    // And a sender that goes quiet still expires, beat or no beat.
    expect(
      project(3000 + GESTURE_TTL_MS + 1, seen, { [AWARENESS_FIELDS.gestureBeat]: 3 })[PEER]
        ?.dragging,
    ).toBeNull();
  });

  it("carries a library drag, and forgets it like any other gesture", () => {
    const seen = new Map<string, SeenGesture>();
    const drag = { cardId: "starter-1", position: { x: 10, y: 20 }, board: "b1" };
    project(1000, seen, { [AWARENESS_FIELDS.libraryDrag]: drag });
    const peers = project(1000 + GESTURE_TTL_MS - 1, seen, {
      [AWARENESS_FIELDS.libraryDrag]: drag,
    });
    expect(peers[PEER]?.libraryDrag).toMatchObject({ cardId: "starter-1" });

    // A held row that stops arriving is a dropped connection, not a drag.
    const quiet = project(1000 + GESTURE_TTL_MS + 1, seen, {
      [AWARENESS_FIELDS.libraryDrag]: drag,
    });
    expect(quiet[PEER]?.libraryDrag ?? null).toBeNull();
  });

  it("restarts the clock when the gesture frame changes", () => {
    const seen = new Map<string, SeenGesture>();
    project(1000, seen);
    project(2000, seen, {
      [AWARENESS_FIELDS.dragging]: { nodeId: "n1", position: { x: 99, y: 20 } },
    });
    const peers = project(2000 + GESTURE_TTL_MS - 1, seen, {
      [AWARENESS_FIELDS.dragging]: { nodeId: "n1", position: { x: 99, y: 20 } },
    });
    expect(peers[PEER]?.dragging).toMatchObject({ position: { x: 99 } });
  });

  it("keeps selections and carets, which are state rather than gestures", () => {
    const seen = new Map<string, SeenGesture>();
    const selection = { nodeIds: ["n1"] };
    const focus = { nodeId: "n1", field: "body" };
    project(1000, seen, {
      [AWARENESS_FIELDS.selection]: selection,
      [AWARENESS_FIELDS.focus]: focus,
      [AWARENESS_FIELDS.dragging]: undefined,
    });
    const peers = project(6000, seen, {
      [AWARENESS_FIELDS.selection]: selection,
      [AWARENESS_FIELDS.focus]: focus,
      [AWARENESS_FIELDS.dragging]: undefined,
    });
    expect(peers[PEER]?.selection).toEqual(selection);
    expect(peers[PEER]?.focus).toEqual(focus);
  });

  it("skips the local client and forgets clients that left", () => {
    const seen = new Map<string, SeenGesture>();
    const map = new Map<string, Record<string, unknown>>([
      [SELF, { [AWARENESS_FIELDS.user]: { name: "Me", color: "#000" } }],
      ...states().entries(),
    ]);
    expect(projectPeers(map, { selfId: SELF, now: 0, seen, heard: new Map() })).not.toHaveProperty(
      String(SELF),
    );
    expect(seen.has(PEER)).toBe(true);

    projectPeers(new Map(), { selfId: SELF, now: 10, seen, heard: new Map() });
    expect(seen.has(PEER)).toBe(false);
  });

  it("treats a peer with no gesture as inert", () => {
    const state = { [AWARENESS_FIELDS.user]: { name: "Ada", color: "#f00" } };
    const peer = { clientId: PEER, ...state, user: { name: "Ada", color: "#f00" } };
    expect(gestureSignature({ ...peer, board: null } as never)).toBe("");
  });
});

describe("projectPeers with a new-link drag", () => {
  const connectFrame = (x: number) => ({
    [AWARENESS_FIELDS.dragging]: undefined,
    [AWARENESS_FIELDS.connect]: {
      nodeId: "n1",
      connectorId: "c1",
      anchorEnd: "source",
      position: { x, y: 20 },
    },
  });

  it("projects the gesture so peers can draw a preview", () => {
    const seen = new Map<string, SeenGesture>();
    const peer = project(1000, seen, connectFrame(10))[PEER];
    expect(peer?.connect).toMatchObject({
      nodeId: "n1",
      connectorId: "c1",
      anchorEnd: "source",
      position: { x: 10, y: 20 },
    });
    expect(peer && gestureSignature(peer)).not.toBe("");
  });

  it("expires when the drag stops arriving, like any other gesture", () => {
    const seen = new Map<string, SeenGesture>();
    project(1000, seen, connectFrame(10));
    expect(
      project(1000 + GESTURE_TTL_MS - 1, seen, connectFrame(10))[PEER]?.connect,
    ).not.toBeNull();
    expect(project(1000 + GESTURE_TTL_MS + 1, seen, connectFrame(10))[PEER]?.connect).toBeNull();
  });

  it("stays live while the pointer keeps refreshing it", () => {
    const seen = new Map<string, SeenGesture>();
    project(1000, seen, connectFrame(10));
    project(2000, seen, connectFrame(60));
    project(3000, seen, connectFrame(110));

    // The last frame arrived well inside the TTL window.
    const peers = project(3000 + GESTURE_TTL_MS - 1, seen, connectFrame(110));
    expect(peers[PEER]?.connect).toMatchObject({ position: { x: 110 } });
  });

  it("restarts only when a fresh frame arrives after expiry", () => {
    const seen = new Map<string, SeenGesture>();
    project(1000, seen, connectFrame(10));
    expect(project(1000 + GESTURE_TTL_MS + 1, seen, connectFrame(10))[PEER]?.connect).toBeNull();
    // A fresh frame is a new arrival, so the gesture is live again.
    expect(project(1000 + GESTURE_TTL_MS + 2, seen, connectFrame(90))[PEER]?.connect).toMatchObject(
      {
        position: { x: 90 },
      },
    );
  });
});

describe("the two axes on a peer", () => {
  const peerWith = (overrides: Record<string, unknown> = {}): PeerPresence => {
    const peer = project(1000, new Map(), {
      [AWARENESS_FIELDS.dragging]: undefined,
      ...overrides,
    })[PEER];
    if (peer === undefined) throw new Error("the fixture must project one peer");
    return peer;
  };

  it("projects what a peer is doing, so their cursor can say it", () => {
    const peer = peerWith({
      [AWARENESS_FIELDS.purpose]: "record",
      [AWARENESS_FIELDS.gesture]: "fan",
    });

    expect(peer.purpose).toBe("record");
    expect(peer.gesture).toBe("fan");
  });

  it("reads a peer from before the axes existed as explore and place", () => {
    const peer = peerWith();

    // Absent is not unknown: an old client publishes neither field, and the
    // honest reading of "said nothing" is the default the axis starts in.
    expect(peer.purpose).toBeNull();
    expect(peer.gesture).toBeNull();
  });

  it("does not count a purpose as an in-flight gesture", () => {
    // A mode is state, not a held drag: it must not keep a stale cursor alive
    // past the TTL, because nothing is being dragged.
    const peer = peerWith({
      [AWARENESS_FIELDS.purpose]: "run",
      [AWARENESS_FIELDS.gesture]: "thread",
    });

    expect(gestureSignature(peer)).toBe("");
    expect(peerIsInteracting(peer)).toBe(false);
  });
});

describe("peerIsInteracting", () => {
  const base = (overrides: Record<string, unknown> = {}) =>
    project(1000, new Map(), {
      [AWARENESS_FIELDS.dragging]: undefined,
      ...overrides,
    })[PEER];

  it("is true for every active editing or manipulation state", () => {
    const focus = { nodeId: "n1", field: "title" };
    const resizing = { nodeId: "n1", width: 200, height: 100 };
    const connector = { nodeId: "n1", connectorId: "c1" };
    const reconnect = { edgeId: "e1", end: "target", position: { x: 1, y: 2 } };
    const connect = {
      nodeId: "n1",
      connectorId: "c1",
      anchorEnd: "source",
      position: { x: 1, y: 2 },
    };

    for (const override of [
      { [AWARENESS_FIELDS.focus]: focus },
      { [AWARENESS_FIELDS.dragging]: { nodeId: "n1", position: { x: 1, y: 2 } } },
      { [AWARENESS_FIELDS.resizing]: resizing },
      { [AWARENESS_FIELDS.connector]: connector },
      { [AWARENESS_FIELDS.reconnect]: reconnect },
      { [AWARENESS_FIELDS.connect]: connect },
    ]) {
      expect(peerIsInteracting(base(override) as never)).toBe(true);
    }
  });

  it("is false for selection, hover, and an idle peer", () => {
    expect(
      peerIsInteracting(base({ [AWARENESS_FIELDS.selection]: { nodeIds: ["n1"] } }) as never),
    ).toBe(false);
    expect(peerIsInteracting(base() as never)).toBe(false);
  });
});

describe("section gestures", () => {
  it("projects a section drag and treats it as an interaction", () => {
    const peers = projectPeers(
      new Map([
        [
          PEER,
          {
            [AWARENESS_FIELDS.user]: { name: "Nova", color: "#f97316" },
            [AWARENESS_FIELDS.sectionDrag]: {
              sectionId: "s1",
              position: { x: 10, y: 20 },
            },
          },
        ],
      ]),
      { selfId: SELF, now: 1000, seen: new Map(), heard: new Map() },
    );

    expect(peers[PEER]?.sectionDrag).toEqual({
      sectionId: "s1",
      position: { x: 10, y: 20 },
    });
    const peer = peers[PEER];
    expect(peer ? peerIsInteracting(peer) : false).toBe(true);
  });

  it("drops a stale section drag", () => {
    const seen = new Map<string, SeenGesture>();
    const state = {
      [AWARENESS_FIELDS.user]: { name: "Nova", color: "#f97316" },
      [AWARENESS_FIELDS.sectionDrag]: { sectionId: "s1", position: { x: 10, y: 20 } },
    };
    projectPeers(new Map([[PEER, state]]), { selfId: SELF, now: 1000, seen, heard: new Map() });
    const peers = projectPeers(new Map([[PEER, state]]), {
      selfId: SELF,
      now: 1000 + 4000,
      seen,
      heard: new Map(),
    });
    expect(peers[PEER]?.sectionDrag).toBeNull();
  });
});

describe("multi-card drag presence", () => {
  const drag = (dragging: Record<string, unknown>) => ({
    [AWARENESS_FIELDS.dragging]: { nodeId: "n1", position: { x: 10, y: 20 }, ...dragging },
  });

  it("keeps the full dragged set, anchor included", () => {
    const seen = new Map<string, SeenGesture>();
    const peers = project(1000, seen, drag({ nodeIds: ["n1", "n2", "n3"] }));
    expect(peers[PEER]?.dragging?.nodeIds).toEqual(["n1", "n2", "n3"]);
    expect(peers[PEER]?.dragging?.nodeId).toBe("n1");
  });

  it("normalises a set without the anchor or with duplicates", () => {
    const seen = new Map<string, SeenGesture>();
    const peers = project(1000, seen, drag({ nodeIds: ["n2", "n2", 42, "", "n3"] }));
    expect(peers[PEER]?.dragging?.nodeIds).toEqual(["n1", "n2", "n3"]);
  });

  it("falls back to the anchor when the set is missing or malformed", () => {
    const missing = project(1000, new Map(), drag({}))[PEER];
    expect(missing?.dragging?.nodeIds).toEqual(["n1"]);

    for (const nodeIds of [null, "n2", {}, [null, 7]]) {
      const peers = project(1000, new Map(), drag({ nodeIds }))[PEER];
      expect(peers?.dragging?.nodeIds).toEqual(["n1"]);
    }
  });

  it("caps an oversized set", () => {
    const nodeIds = Array.from({ length: MAX_DRAG_NODE_IDS + 100 }, (_, index) => `n${index}`);
    const peers = project(1000, new Map(), drag({ nodeIds }))[PEER];
    expect(peers?.dragging?.nodeIds).toHaveLength(MAX_DRAG_NODE_IDS);
  });

  it("still expires a multi-card drag after the gesture TTL", () => {
    const seen = new Map<string, SeenGesture>();
    const frame = drag({ nodeIds: ["n1", "n2"] });
    expect(project(1000, seen, frame)[PEER]?.dragging?.nodeIds).toEqual(["n1", "n2"]);
    expect(project(1000 + GESTURE_TTL_MS - 1, seen, frame)[PEER]?.dragging).not.toBeNull();
    expect(project(1000 + GESTURE_TTL_MS + 1, seen, frame)[PEER]?.dragging).toBeNull();
  });

  it("treats a changed set as a new frame, restarting the TTL", () => {
    const seen = new Map<string, SeenGesture>();
    project(1000, seen, drag({ nodeIds: ["n1"] }));
    project(2000, seen, drag({ nodeIds: ["n1", "n2"] }));
    const peers = project(2000 + GESTURE_TTL_MS - 1, seen, drag({ nodeIds: ["n1", "n2"] }));
    expect(peers[PEER]?.dragging?.nodeIds).toEqual(["n1", "n2"]);
  });
});
