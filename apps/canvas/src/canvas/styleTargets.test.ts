import { describe, expect, it } from "vitest";
import { bulkStyleWrites, mergeStylePatch, sharedStyleValue } from "./styleTargets";

/**
 * A style edit across a multi-selection.
 *
 * The properties the board leans on: a bulk edit patches each card's own style
 * rather than replacing it, a cleared key leaves "never set" and "reset" in the
 * same state, and a bar that spans cards says "mixed" instead of borrowing one
 * card's value.
 */

describe("a bulk edit", () => {
  it("patches each card's own style instead of replacing it", () => {
    const writes = bulkStyleWrites(
      [{ id: "a", style: { radius: 12, ink: "accent" } }, { id: "b" }],
      { shape: "pill" },
    );

    expect(writes).toEqual([
      { cardId: "a", style: { radius: 12, ink: "accent", shape: "pill" } },
      { cardId: "b", style: { shape: "pill" } },
    ]);
  });

  it("clears a key the patch names as undefined, and drops an empty record", () => {
    expect(mergeStylePatch({ shape: "pill" }, { shape: undefined })).toBeNull();
    expect(mergeStylePatch({ shape: "pill", surface: "canvas" }, { shape: undefined })).toEqual({
      surface: "canvas",
    });
  });

  it("says mixed instead of borrowing one card's value", () => {
    expect(
      sharedStyleValue(
        [
          { id: "a", style: { shape: "pill" } },
          { id: "b", style: { shape: "pill" } },
        ],
        "shape",
      ),
    ).toEqual({ mixed: false, value: "pill" });
    expect(sharedStyleValue([{ id: "a", style: { shape: "pill" } }, { id: "b" }], "shape")).toEqual(
      { mixed: true, value: undefined },
    );
  });
});
