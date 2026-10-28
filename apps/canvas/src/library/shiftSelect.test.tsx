import { describe, expect, it } from "vitest";
import { applySelection, EMPTY_SELECTION, gestureOf } from "./librarySelection";

/**
 * Shift-click starts a multi-select without going through the mode button.
 *
 * The drawer's dominant gesture is "open this card", so a plain click must stay
 * that. A modifier is the reader saying "rows", and it has to work the first time
 * rather than being swallowed because selection mode was off.
 */
const order = ["a", "b", "c", "d"];
const press = (keys: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }> = {}) =>
  gestureOf({ shiftKey: false, metaKey: false, ctrlKey: false, ...keys });

describe("the modifier is the request", () => {
  it("reads shift as a range and cmd or ctrl as one more", () => {
    expect(press({ shiftKey: true })).toBe("range");
    expect(press({ metaKey: true })).toBe("add");
    expect(press({ ctrlKey: true })).toBe("add");
    expect(press()).toBe("replace");
  });

  it("ranges from the last plain click to the row shift-clicked", () => {
    const first = applySelection(EMPTY_SELECTION, "b", "replace", order);
    const ranged = applySelection(first, "d", "range", order);

    expect(ranged.ids).toEqual(["b", "c", "d"]);
  });

  it("adds a row without disturbing the rest", () => {
    const first = applySelection(EMPTY_SELECTION, "a", "replace", order);
    const second = applySelection(first, "c", "add", order);
    const third = applySelection(second, "c", "add", order);

    expect(second.ids).toEqual(["a", "c"]);
    // The same row again takes it back out, which is what a toggle is.
    expect(third.ids).toEqual(["a"]);
  });
});
