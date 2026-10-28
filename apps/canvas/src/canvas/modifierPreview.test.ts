import { describe, expect, it } from "vitest";
import { type CanvasMode, canvasModes } from "./links/linkGesture";
import { modifierOffset, NO_MODIFIERS, previewedValue } from "./modifierPreview";

/**
 * The one modifier map (ADR-0066).
 *
 * What is worth pinning is the *positional* rule: both families read the same
 * offsets, the resting modifier never names a value, and an empty slot is empty
 * rather than clamped — because a clamped alt would quietly mean "ctrl".
 */

describe("the modifier map", () => {
  it("reads resting, shift, ctrl and alt as the four positions", () => {
    expect(modifierOffset(NO_MODIFIERS)).toBe(0);
    expect(modifierOffset({ ...NO_MODIFIERS, shift: true })).toBe(1);
    expect(modifierOffset({ ...NO_MODIFIERS, ctrl: true })).toBe(2);
    expect(modifierOffset({ ...NO_MODIFIERS, alt: true })).toBe(3);
  });

  it("lets the most specific modifier win, because a four-value family has no fifth", () => {
    expect(modifierOffset({ shift: true, ctrl: true, alt: false })).toBe(2);
    expect(modifierOffset({ shift: true, ctrl: true, alt: true })).toBe(3);
  });

  it("names nothing at rest, so a control falls back to what is stored", () => {
    // Not "the first value": a preview replaces the stored value, and at rest
    // there is nothing to replace it with.
    expect(previewedValue(canvasModes, NO_MODIFIERS)).toBeNull();
  });

  it("reads the gesture family", () => {
    expect(previewedValue(canvasModes, { shift: true, ctrl: false, alt: false })).toBe("thread");
    expect(previewedValue(canvasModes, { shift: false, ctrl: true, alt: false })).toBe("fan");
    // Three values fill three slots, so alt points at nothing.
    expect(previewedValue(canvasModes, { shift: false, ctrl: false, alt: true })).toBeNull();
  });

  it("hands back the value the map would otherwise leave out", () => {
    // The author's case: the second value in both families, so every key pointed at a
    // value already on screen and previewed nothing.
    expect(previewedValue(canvasModes, { shift: true, ctrl: false, alt: false }, "thread")).toBe(
      "place",
    );
    // The case that broke a "step back one" rule: from fan, stepping back made ctrl and
    // shift both show thread, and place was unreachable from the bar.
    expect(previewedValue(canvasModes, { shift: true, ctrl: false, alt: false }, "fan")).toBe(
      "thread",
    );
    expect(previewedValue(canvasModes, { shift: false, ctrl: true, alt: false }, "fan")).toBe(
      "place",
    );
    expect(previewedValue(canvasModes, { shift: false, ctrl: false, alt: true }, "fan")).toBeNull();
  });

  it("keeps a key pointing at its own slot when the stored value is elsewhere", () => {
    // The exception is only for the collision: a key must still mean its own value
    // from any other starting point, or the map would drift with the selection.
    expect(previewedValue(canvasModes, { shift: true, ctrl: false, alt: false }, "place")).toBe(
      "thread",
    );
    expect(previewedValue(canvasModes, { shift: false, ctrl: true, alt: false }, "thread")).toBe(
      "fan",
    );
    expect(previewedValue(canvasModes, NO_MODIFIERS, "fan")).toBeNull();
  });

  /**
   * The property the map exists for, checked as a matrix rather than case by case:
   * whatever the reader has stored, the bar shows the stored value plus three keys,
   * and between them they name every value of the family exactly once. A "step back
   * one" rule passed the two hand-written cases above and still failed this: from
   * `fan` it showed `thread` twice and left `place` unaccounted for.
   */
  const KEYS = [
    { shift: true, ctrl: false, alt: false },
    { shift: false, ctrl: true, alt: false },
    { shift: false, ctrl: false, alt: true },
  ] as const;

  it("shows every mode exactly once across the stored one and the two keys", () => {
    for (const stored of canvasModes) {
      const shown = KEYS.map((state) => previewedValue(canvasModes, state, stored)).filter(
        (value): value is CanvasMode => value !== null && value !== undefined,
      );
      const reached = new Set([stored, ...shown]);

      expect(reached.size, `${stored}: ${[...reached].join(", ")}`).toBe(canvasModes.length);
      expect([...reached].sort(), `${stored}: ${[...reached].join(", ")}`).toEqual(
        [...canvasModes].sort(),
      );
    }
  });

  it("never shows a key's own value as the collision answer", () => {
    // The failure the matrix above catches, stated directly so the reason survives a
    // refactor that keeps the counts but changes which value is handed back.
    for (const stored of canvasModes) {
      for (const [index, state] of KEYS.entries()) {
        const previewed = previewedValue(canvasModes, state, stored);
        expect(previewed, `${stored} with key ${index + 1}`).not.toBe(stored);
      }
    }
  });

  it("leaves a slot empty on a family with fewer values than keys, instead of clamping", () => {
    // No live family is short a value now that `explain` is cyclable, so the rule is
    // asserted on a literal one: clamping would make alt a synonym for ctrl, which is
    // worse than a key that does nothing.
    expect(previewedValue(["a", "b", "c"], { shift: false, ctrl: false, alt: true })).toBeNull();
    expect(previewedValue(["a", "b", "c"], { shift: false, ctrl: true, alt: false })).toBe("c");
  });
});
