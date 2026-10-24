import { describe, expect, it } from "vitest";
import { beginPresencePress, DRAG_PRESENCE_EPSILON, presenceDragFor } from "./icePresencePress";

const START = { x: 100, y: 200, width: 240, height: 160 };
const press = beginPresencePress({ cardId: "card-a", planeId: "view-1", box: START });

describe("beginPresencePress", () => {
  it("records the box a card was pressed in", () => {
    expect(press).toEqual({ cardId: "card-a", planeId: "view-1", start: START });
  });

  it("refuses an unidentifiable press", () => {
    expect(beginPresencePress({ cardId: "", planeId: "view-1", box: START })).toBeNull();
    expect(beginPresencePress({ cardId: "card-a", planeId: "", box: START })).toBeNull();
    expect(beginPresencePress({ cardId: "card-a", planeId: "view-1", box: null })).toBeNull();
    expect(
      beginPresencePress({
        cardId: "card-a",
        planeId: "view-1",
        box: { x: Number.NaN, y: 0, width: 10, height: 10 },
      }),
    ).toBeNull();
  });
});

describe("presenceDragFor", () => {
  it("publishes nothing while the card has not moved", () => {
    expect(press).not.toBeNull();
    if (press === null) return;
    expect(presenceDragFor(press, START)).toBeNull();
    expect(presenceDragFor(press, { ...START, x: START.x + DRAG_PRESENCE_EPSILON / 2 })).toBeNull();
  });

  it("publishes the live box in the plane, with the whole dragged set", () => {
    if (press === null) throw new Error("press");
    const moved = { ...START, x: START.x + 40, y: START.y + 10 };
    expect(presenceDragFor(press, moved, ["card-a", "card-b"])).toEqual({
      nodeId: "card-a",
      position: { x: 140, y: 210 },
      nodeIds: ["card-a", "card-b"],
      boardId: "view-1",
    });
  });

  it("keeps a single-card drag free of nodeIds", () => {
    if (press === null) throw new Error("press");
    const moved = { ...START, x: START.x + 40 };
    expect(presenceDragFor(press, moved)).not.toHaveProperty("nodeIds");
  });

  it("does not turn a resize into a drag", () => {
    if (press === null) throw new Error("press");
    expect(presenceDragFor(press, { ...START, width: START.width + 60 })).toBeNull();
  });

  it("drops a box that cannot be replayed", () => {
    if (press === null) throw new Error("press");
    expect(presenceDragFor(press, null)).toBeNull();
    expect(
      presenceDragFor(press, { x: Number.POSITIVE_INFINITY, y: 0, width: 10, height: 10 }),
    ).toBeNull();
  });
});
