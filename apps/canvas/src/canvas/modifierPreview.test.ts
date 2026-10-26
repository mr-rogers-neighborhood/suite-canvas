import { describe, expect, it } from "vitest";
import { canvasModes } from "./linkGesture";
import { modifierOffset, NO_MODIFIERS, previewedValue } from "./modifierPreview";
import { choosablePurposes } from "./purpose";

/**
 * The one modifier map ([ADR-0066](../../../docs/decisions/0066-one-modifier-vocabulary-and-a-purpose-that-explains.md)).
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

  it("reads both families with one rule", () => {
    expect(previewedValue(canvasModes, { shift: true, ctrl: false, alt: false })).toBe("thread");
    expect(previewedValue(canvasModes, { shift: false, ctrl: true, alt: false })).toBe("fan");
    expect(previewedValue(canvasModes, { shift: false, ctrl: false, alt: true })).toBe("pattern");

    expect(previewedValue(choosablePurposes, { shift: true, ctrl: false, alt: false })).toBe("run");
    expect(previewedValue(choosablePurposes, { shift: false, ctrl: true, alt: false })).toBe(
      "record",
    );
  });

  it("leaves alt empty on a three-value family instead of clamping", () => {
    // The slot is reserved for `explain`; clamping would make alt a synonym for
    // ctrl, which is worse than a key that does nothing yet.
    expect(previewedValue(choosablePurposes, { shift: false, ctrl: false, alt: true })).toBeNull();
  });
});
