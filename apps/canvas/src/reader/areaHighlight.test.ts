import { describe, expect, it } from "vitest";
import { isAreaDrag, normalisedRect, quoteInRect, rectBetween } from "./areaHighlight";

/**
 * An area highlight.
 *
 * The arithmetic is the part that can go wrong quietly: a rectangle stored in the wrong coordinate system looks right
 * until the reader resizes the window, and then it is somewhere else entirely. Everything here is about the same
 * rectangle, seen from the pointer and from the column.
 */
const COLUMN = { left: 100, top: 200, width: 400, height: 1000 };

describe("the rectangle a drag drew", () => {
  it("should convert a viewport drag into fractions of the column", () => {
    // A drag from a quarter across and a tenth down, 200 by 100 wide, in a column 400 by 1000.
    const rect = normalisedRect({ left: 200, top: 300, width: 200, height: 100 }, COLUMN);
    expect(rect).toEqual({ x: 0.25, y: 0.1, width: 0.5, height: 0.1 });
  });

  it("should read a drag that went right to left as the same rectangle", () => {
    const forwards = normalisedRect({ left: 200, top: 300, width: 200, height: 100 }, COLUMN);
    const backwards = normalisedRect({ left: 400, top: 400, width: -200, height: -100 }, COLUMN);
    expect(backwards).toEqual(forwards);
  });

  it("should clamp a drag that left the column rather than refusing it", () => {
    const rect = normalisedRect({ left: 350, top: 1100, width: 400, height: 400 }, COLUMN);
    expect(rect).toEqual({ x: 0.625, y: 0.9, width: 0.375, height: 0.1 });
  });

  it("should answer nothing for a column that is not laid out yet", () => {
    expect(
      normalisedRect({ left: 0, top: 0, width: 10, height: 10 }, { ...COLUMN, height: 0 }),
    ).toBeNull();
  });

  it("should build the same rectangle from any two corners the pointer visited", () => {
    expect(rectBetween({ x: 10, y: 40 }, { x: 30, y: 100 })).toEqual({
      left: 10,
      top: 40,
      width: 20,
      height: 60,
    });
    expect(rectBetween({ x: 30, y: 100 }, { x: 10, y: 40 })).toEqual({
      left: 10,
      top: 40,
      width: 20,
      height: 60,
    });
  });

  it("should not mistake a press for a selection", () => {
    expect(isAreaDrag({ left: 10, top: 10, width: 2, height: 2 })).toBe(false);
    expect(isAreaDrag({ left: 10, top: 10, width: 40, height: 2 })).toBe(true);
  });
});

/**
 * The words under it.
 *
 * jsdom lays nothing out, so every box is empty and no text is ever "inside" a rectangle. What is testable here is the
 * refusal: a rectangle over words the browser cannot measure must produce nothing rather than a paragraph of guesses.
 */
describe("the words under a rectangle", () => {
  it("should answer nothing when nothing can be measured", () => {
    const root = document.createElement("div");
    root.innerHTML = "<p>Some words that a rectangle might cover.</p>";
    document.body.append(root);
    expect(quoteInRect(root, { left: 0, top: 0, width: 100, height: 100 }, 4000)).toBe("");
    root.remove();
  });
});
