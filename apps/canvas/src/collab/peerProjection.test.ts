import { describe, expect, it } from "vitest";
import { GESTURE_TTL_MS, gestureSignature, projectPeers, type SeenGesture } from "./peerProjection";
import { AWARENESS_FIELDS } from "./presence";

const SELF = 1;
const PEER = 2;

function states(overrides: Record<string, unknown> = {}) {
  return new Map<number, Record<string, unknown>>([
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

function project(now: number, seen: Map<number, SeenGesture>, overrides?: Record<string, unknown>) {
  return projectPeers(states(overrides), { selfId: SELF, now, seen });
}

describe("projectPeers", () => {
  it("keeps a gesture that is still arriving", () => {
    const seen = new Map<number, SeenGesture>();
    project(1000, seen);
    const peers = project(1000 + GESTURE_TTL_MS - 1, seen);
    expect(peers[PEER]?.dragging).toMatchObject({ nodeId: "n1" });
  });

  it("drops a gesture that stopped arriving", () => {
    const seen = new Map<number, SeenGesture>();
    project(1000, seen);
    const peers = project(1000 + GESTURE_TTL_MS + 1, seen);
    expect(peers[PEER]?.dragging).toBeNull();
    // The peer itself stays; only the in-flight gesture expires.
    expect(peers[PEER]?.user.name).toBe("Ada");
  });

  it("restarts the clock when the gesture frame changes", () => {
    const seen = new Map<number, SeenGesture>();
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
    const seen = new Map<number, SeenGesture>();
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
    const seen = new Map<number, SeenGesture>();
    const map = new Map<number, Record<string, unknown>>([
      [SELF, { [AWARENESS_FIELDS.user]: { name: "Me", color: "#000" } }],
      ...states().entries(),
    ]);
    expect(projectPeers(map, { selfId: SELF, now: 0, seen })).not.toHaveProperty(String(SELF));
    expect(seen.has(PEER)).toBe(true);

    projectPeers(new Map(), { selfId: SELF, now: 10, seen });
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
    const seen = new Map<number, SeenGesture>();
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
    const seen = new Map<number, SeenGesture>();
    project(1000, seen, connectFrame(10));
    expect(
      project(1000 + GESTURE_TTL_MS - 1, seen, connectFrame(10))[PEER]?.connect,
    ).not.toBeNull();
    expect(project(1000 + GESTURE_TTL_MS + 1, seen, connectFrame(10))[PEER]?.connect).toBeNull();
  });

  it("stays live while the pointer keeps refreshing it", () => {
    const seen = new Map<number, SeenGesture>();
    project(1000, seen, connectFrame(10));
    project(2000, seen, connectFrame(60));
    project(3000, seen, connectFrame(110));

    // The last frame arrived well inside the TTL window.
    const peers = project(3000 + GESTURE_TTL_MS - 1, seen, connectFrame(110));
    expect(peers[PEER]?.connect).toMatchObject({ position: { x: 110 } });
  });

  it("restarts only when a fresh frame arrives after expiry", () => {
    const seen = new Map<number, SeenGesture>();
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
