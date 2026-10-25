import { describe, expect, it } from "vitest";
import {
  applySelection,
  EMPTY_SELECTION,
  gestureOf,
  selectAll,
  selectedInOrder,
} from "./librarySelection";

/**
 * Selection is the input to every bulk action, so its three gestures are pinned
 * here rather than in a component test: a Shift-range over a *filtered* list must
 * range over what is visible, and the order a run places in must be the order on
 * screen. ADR-0011 amendment.
 */

const ORDER = ["a", "b", "c", "d", "e"];

describe("gestureOf", () => {
  it("reads Shift as a range, Command or Control as an add, and nothing as replace", () => {
    expect(gestureOf({ shiftKey: true, metaKey: false, ctrlKey: false })).toBe("range");
    expect(gestureOf({ shiftKey: false, metaKey: true, ctrlKey: false })).toBe("add");
    expect(gestureOf({ shiftKey: false, metaKey: false, ctrlKey: true })).toBe("add");
    expect(gestureOf({ shiftKey: false, metaKey: false, ctrlKey: false })).toBe("replace");
  });

  it("prefers a range when Shift and a modifier are both held", () => {
    expect(gestureOf({ shiftKey: true, metaKey: true, ctrlKey: true })).toBe("range");
  });
});

describe("applySelection", () => {
  it("replaces on a plain click", () => {
    const next = applySelection({ ids: ["a", "b"], anchor: "b" }, "c", "replace", ORDER);

    expect(next).toEqual({ ids: ["c"], anchor: "c" });
  });

  it("adds and removes on a modifier click", () => {
    const added = applySelection({ ids: ["a"], anchor: "a" }, "c", "add", ORDER);
    expect(added.ids).toEqual(["a", "c"]);

    // A second modifier click on the same row takes it back out.
    const removed = applySelection(added, "c", "add", ORDER);
    expect(removed.ids).toEqual(["a"]);
    expect(removed.anchor).toBe("c");
  });

  it("ranges from the anchor in either direction", () => {
    const forward = applySelection({ ids: ["b"], anchor: "b" }, "d", "range", ORDER);
    expect(forward.ids).toEqual(["b", "c", "d"]);

    const backward = applySelection({ ids: ["d"], anchor: "d" }, "b", "range", ORDER);
    expect(backward.ids).toEqual(["b", "c", "d"]);
  });

  it("ranges over the visible order, not the document order", () => {
    // A filtered or sorted list is what the reader sees, so a range follows it.
    const visible = ["e", "c", "a"];
    const next = applySelection({ ids: ["e"], anchor: "e" }, "a", "range", visible);

    expect(next.ids).toEqual(["e", "c", "a"]);
  });

  it("treats a range from an invisible anchor as a plain click", () => {
    const next = applySelection({ ids: ["z"], anchor: "z" }, "c", "range", ORDER);

    expect(next).toEqual({ ids: ["c"], anchor: "c" });
  });
});

describe("selectAll and selectedInOrder", () => {
  it("selects every visible row", () => {
    expect(selectAll(ORDER)).toEqual({ ids: ORDER, anchor: "a" });
    expect(selectAll([])).toEqual({ ids: [], anchor: null });
  });

  it("orders a selection by what is on screen, which is the order a run places in", () => {
    // Selected out of order on purpose: a run that threaded this set in selection
    // order would draw a different board than the list shows.
    const state = { ids: ["d", "a", "c"], anchor: "a" };

    expect(selectedInOrder(state, ORDER)).toEqual(["a", "c", "d"]);
  });

  it("has an empty selection to start from", () => {
    expect(selectedInOrder(EMPTY_SELECTION, ORDER)).toEqual([]);
  });
});
