import { beforeEach, describe, expect, it } from "vitest";
import { cardStep, usePlacementRunStore } from "./placementRun";

/**
 * A run is gesture state, so these tests pin the state machine only: what a step
 * does to the queue, the origin and the anchor, and that every exit leaves nothing
 * behind. ADR-0063.
 */

const store = () => usePlacementRunStore.getState();

beforeEach(() => {
  usePlacementRunStore.setState({ run: null, suspended: [] });
});

describe("starting a run", () => {
  it("keeps the order it was given, because the order is what the user sees", () => {
    store().start(["a", "b", "c"]);

    expect(store().run?.queue).toEqual([cardStep("a"), cardStep("b"), cardStep("c")]);
    expect(store().run?.placed).toEqual([]);
    expect(store().run?.originId).toBeNull();
    expect(store().run?.source).toBe("selection");
  });

  it("does not start on an empty queue", () => {
    store().start(["a"]);
    store().start([]);

    expect(store().run).toBeNull();
  });

  it("starts unwrapped, because an unwanted section is an object to delete", () => {
    store().start(["a", "b"]);
    expect(store().run?.wrap).toBe(false);

    store().start(["a", "b"], { wrap: true, source: "view" });
    expect(store().run?.wrap).toBe(true);
    expect(store().run?.source).toBe("view");
  });
});

describe("a run's shape", () => {
  it("takes the shape it was started with, and keeps it", () => {
    store().start(["a", "b"], { shape: "fan" });

    expect(store().run?.shape).toBe("fan");
  });

  it("defaults to a dump, which is the shape that claims nothing", () => {
    store().start(["a", "b"]);

    expect(store().run?.shape).toBe("place");
  });

  it("learns its hub from the first card when it came from the library", () => {
    store().start(["a", "b"], { shape: "fan" });

    expect(store().run?.hub).toBe("first");
    expect(store().run?.originId).toBeNull();

    store().advance(cardStep("a"));
    expect(store().run?.originId).toBe("a");
  });

  it("knows its hub up front when it started from a card on the board", () => {
    // A spokes-only run: the card is already placed and is never dropped again.
    store().start(["b", "c"], { shape: "fan", hub: "existing", originId: "hub" });

    expect(store().run?.originId).toBe("hub");
    expect(store().run?.anchorId).toBe("hub");

    store().advance(cardStep("b"));
    // The hub never moves: that is the whole of what a fan means.
    expect(store().run?.originId).toBe("hub");
    expect(store().run?.anchorId).toBe("b");
  });
});

describe("advancing a run", () => {
  it("sets the origin on the first placement and the anchor on every one", () => {
    store().start(["a", "b", "c"]);

    store().advance(cardStep("a"));
    expect(store().run?.originId).toBe("a");
    expect(store().run?.anchorId).toBe("a");
    expect(store().run?.queue).toEqual([cardStep("b"), cardStep("c")]);

    store().advance(cardStep("b"));
    // The origin stays put: a fan keeps returning to it.
    expect(store().run?.originId).toBe("a");
    expect(store().run?.anchorId).toBe("b");
    expect(store().run?.placed).toEqual(["a", "b"]);
  });

  it("ends the run when the queue empties, so no stale run survives a last card", () => {
    store().start(["a"]);
    store().advance(cardStep("a"));

    expect(store().run).toBeNull();
  });

  it("records a section the engine created for the run", () => {
    store().start(["a", "b", "c"], { wrap: true });
    store().advance(cardStep("a"), "section-1");

    expect(store().run?.sectionId).toBe("section-1");
    // Later steps keep the frame they were given rather than making another.
    store().advance(cardStep("b"));
    expect(store().run?.sectionId).toBe("section-1");
  });

  it("ignores a step after the run ended", () => {
    store().start(["a"]);
    store().advance(cardStep("a"));
    store().advance(cardStep("a"));

    expect(store().run).toBeNull();
  });
});

describe("enqueue: the picker loop", () => {
  it("appends the card the user just picked to the live run", () => {
    store().start(["a"]);
    store().enqueue(["b"]);

    expect(store().run?.queue).toEqual([cardStep("a"), cardStep("b")]);
  });

  it("ignores a card already in the queue, so a double pick cannot place twice", () => {
    store().start(["a", "b"]);
    store().enqueue(["b"]);

    expect(store().run?.queue).toEqual([cardStep("a"), cardStep("b")]);
  });

  it("does nothing without a run: picking a type is still one card, one drop", () => {
    store().enqueue(["a"]);

    expect(store().run).toBeNull();
  });
});

describe("skipping and finishing", () => {
  it("drops the head without placing it", () => {
    store().start(["a", "b"]);
    store().skip();

    expect(store().run?.queue).toEqual([cardStep("b")]);
    expect(store().run?.placed).toEqual([]);
  });

  it("ends the run when the last card is skipped", () => {
    store().start(["a"]);
    store().skip();

    expect(store().run).toBeNull();
  });

  it("finish clears the outermost run, which is how Escape and Stop exit", () => {
    store().start(["a", "b"], { wrap: true });
    store().advance(cardStep("a"), "section-1");
    store().finish();

    expect(store().run).toBeNull();
    expect(store().suspended).toEqual([]);
  });

  it("finishAll drops the whole stack, which is what a board switch does", () => {
    store().start(["a"]);
    store().start(["b"]);
    store().finishAll();

    expect(store().run).toBeNull();
    expect(store().suspended).toEqual([]);
  });

  it("toggles wrapping mid-run without disturbing the queue", () => {
    store().start(["a", "b"]);
    store().setWrap(true);

    expect(store().run?.wrap).toBe(true);
    expect(store().run?.queue).toEqual([cardStep("a"), cardStep("b")]);
  });
});

describe("a step can be a set, and can change the mode", () => {
  it("advances the whole set at once and anchors on its last card", () => {
    store().startSteps([{ ids: ["a", "b"] }, { ids: ["c"] }]);

    store().advance({ ids: ["a", "b"] });

    expect(store().run?.placed).toEqual(["a", "b"]);
    // The anchor is the set's last card, so whatever comes next hangs off it.
    expect(store().run?.anchorId).toBe("b");
    expect(store().run?.originId).toBe("a");
    expect(store().run?.queue).toEqual([{ ids: ["c"] }]);
  });

  it("consumes the queue by position, so the same card may be placed twice", () => {
    store().startSteps([{ ids: ["a"] }, { ids: ["a"] }]);
    store().advance({ ids: ["a"] });

    // Filtering by id would have eaten both steps.
    expect(store().run?.queue).toEqual([{ ids: ["a"] }]);
  });

  it("holds a set as one step, so a section and its cards move together", () => {
    store().startSteps([{ ids: ["a"] }, { ids: ["b", "c"] }], { shape: "place" });

    expect(store().run?.queue[1]).toEqual({ ids: ["b", "c"] });
  });

  it("ignores an empty step list", () => {
    store().startSteps([{ ids: [] }]);

    expect(store().run).toBeNull();
  });
});

describe("the picker loop outlives its queue", () => {
  it("stays live with an empty queue, because it is waiting to be fed", () => {
    store().start(["a"], { source: "picker" });
    store().advance(cardStep("a"));

    expect(store().run).not.toBeNull();
    expect(store().run?.queue).toEqual([]);
    expect(store().run?.placed).toEqual(["a"]);
  });

  it("still ends on Stop, which is the only exit a loop needs", () => {
    store().start(["a"], { source: "picker" });
    store().advance(cardStep("a"));
    store().finish();

    expect(store().run).toBeNull();
  });

  it("every other source ends when its last card lands", () => {
    for (const source of ["selection", "view", "dock"] as const) {
      store().start(["a"], { source });
      store().advance(cardStep("a"));
      expect(store().run).toBeNull();
    }
  });
});

describe("a run may nest", () => {
  it("suspends the outer run instead of replacing it", () => {
    store().start(["outer-1", "outer-2"], { source: "selection" });
    store().start(["inner-1"], { source: "view" });

    // Only the top places; the outer run is waiting rather than gone.
    expect(store().run?.queue).toEqual([cardStep("inner-1")]);
    expect(store().suspended).toHaveLength(1);
    expect(store().suspended[0]?.queue).toEqual([cardStep("outer-1"), cardStep("outer-2")]);
  });

  it("resumes the run it interrupted, exactly where it stopped", () => {
    store().start(["outer-1", "outer-2"]);
    store().advance(cardStep("outer-1"));
    store().start(["inner-1"]);

    store().finish();

    // Same queue, same origin, same anchor: the inner run left no trace on it.
    expect(store().run?.queue).toEqual([cardStep("outer-2")]);
    expect(store().run?.originId).toBe("outer-1");
    expect(store().run?.anchorId).toBe("outer-1");
    expect(store().suspended).toEqual([]);
  });

  it("resumes outermost-last, so two levels come back in order", () => {
    store().start(["a"]);
    store().start(["b"]);
    store().start(["c"]);

    store().finish();
    expect(store().run?.queue).toEqual([cardStep("b")]);
    store().finish();
    expect(store().run?.queue).toEqual([cardStep("a")]);
    store().finish();
    expect(store().run).toBeNull();
  });
});
