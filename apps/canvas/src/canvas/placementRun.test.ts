import { beforeEach, describe, expect, it } from "vitest";
import { usePlacementRunStore } from "./placementRun";

/**
 * A run is gesture state, so these tests pin the state machine only: what a step
 * does to the queue, the origin and the anchor, and that every exit leaves nothing
 * behind. ADR-0063.
 */

const store = () => usePlacementRunStore.getState();

beforeEach(() => {
  usePlacementRunStore.setState({ run: null });
});

describe("starting a run", () => {
  it("keeps the order it was given, because the order is what the user sees", () => {
    store().start(["a", "b", "c"]);

    expect(store().run?.queue).toEqual(["a", "b", "c"]);
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

describe("advancing a run", () => {
  it("sets the origin on the first placement and the anchor on every one", () => {
    store().start(["a", "b", "c"]);

    store().advance("a");
    expect(store().run?.originId).toBe("a");
    expect(store().run?.anchorId).toBe("a");
    expect(store().run?.queue).toEqual(["b", "c"]);

    store().advance("b");
    // The origin stays put: a web keeps returning to it.
    expect(store().run?.originId).toBe("a");
    expect(store().run?.anchorId).toBe("b");
    expect(store().run?.placed).toEqual(["a", "b"]);
  });

  it("ends the run when the queue empties, so no stale run survives a last card", () => {
    store().start(["a"]);
    store().advance("a");

    expect(store().run).toBeNull();
  });

  it("records a section the engine created for the run", () => {
    store().start(["a", "b", "c"], { wrap: true });
    store().advance("a", "section-1");

    expect(store().run?.sectionId).toBe("section-1");
    // Later steps keep the frame they were given rather than making another.
    store().advance("b");
    expect(store().run?.sectionId).toBe("section-1");
  });

  it("ignores a step after the run ended", () => {
    store().start(["a"]);
    store().advance("a");
    store().advance("a");

    expect(store().run).toBeNull();
  });
});

describe("skipping and finishing", () => {
  it("drops the head without placing it", () => {
    store().start(["a", "b"]);
    store().skip();

    expect(store().run?.queue).toEqual(["b"]);
    expect(store().run?.placed).toEqual([]);
  });

  it("ends the run when the last card is skipped", () => {
    store().start(["a"]);
    store().skip();

    expect(store().run).toBeNull();
  });

  it("finish clears everything, which is how Escape and Stop exit", () => {
    store().start(["a", "b"], { wrap: true });
    store().advance("a", "section-1");
    store().finish();

    expect(store().run).toBeNull();
  });

  it("toggles wrapping mid-run without disturbing the queue", () => {
    store().start(["a", "b"]);
    store().setWrap(true);

    expect(store().run?.wrap).toBe(true);
    expect(store().run?.queue).toEqual(["a", "b"]);
  });
});
