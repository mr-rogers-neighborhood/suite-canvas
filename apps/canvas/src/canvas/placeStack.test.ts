import { describe, expect, it } from "vitest";
import { usePlaceStackStore } from "./placeStack";

/** A stack is placed one press at a time, so the top must actually leave the hand. */
describe("the place stack", () => {
  it("puts the picked cards in hand and drops one per press", () => {
    usePlaceStackStore.getState().start(["a", "b", "c"]);
    expect(usePlaceStackStore.getState().queue).toEqual(["a", "b", "c"]);

    usePlaceStackStore.getState().advance();
    expect(usePlaceStackStore.getState().queue).toEqual(["b", "c"]);

    usePlaceStackStore.getState().advance();
    usePlaceStackStore.getState().advance();
    expect(usePlaceStackStore.getState().queue).toEqual([]);
  });

  it("never carries the same card twice", () => {
    usePlaceStackStore.getState().start(["a", "b", "a"]);
    expect(usePlaceStackStore.getState().queue).toEqual(["a", "b"]);
  });

  it("retires a board and every portal of it in one press", () => {
    usePlaceStackStore.getState().start(["board", "portal", "note"]);
    // The press placed the portal that opens `board`, so both ids are done.
    usePlaceStackStore.getState().remove(["board", "portal"]);
    expect(usePlaceStackStore.getState().queue).toEqual(["note"]);
  });

  it("empties on stop, and an empty pick puts nothing in hand", () => {
    usePlaceStackStore.getState().start(["a"]);
    usePlaceStackStore.getState().stop();
    expect(usePlaceStackStore.getState().queue).toEqual([]);
    usePlaceStackStore.getState().start([]);
    expect(usePlaceStackStore.getState().queue).toEqual([]);
  });
});
