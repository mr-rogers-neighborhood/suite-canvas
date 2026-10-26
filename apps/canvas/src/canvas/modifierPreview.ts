import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * The one modifier map both mode families read ([ADR-0066](../../../docs/decisions/0066-one-modifier-vocabulary-and-a-purpose-that-explains.md)).
 *
 * A family lists its values in order, resting first: `place · thread · fan ·
 * pattern` and `explore · run · record` (with `explain` reserved for alt). No
 * modifier is the first value, shift the second, ctrl the third, alt the fourth.
 *
 * Positional, not semantic, on purpose: one rule covers both widgets, so a reader
 * who learns "modifiers pick the value" on the link tool is not surprised by the
 * purpose control. What each value *is* is carried by its glyph and its label.
 *
 * A modifier only ever **previews**. Nothing here writes a store: commitment is a
 * click, or the gesture that consumes the hint, because these same keys are undo,
 * multi-select and every browser shortcut.
 */
export interface ModifierState {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

export const NO_MODIFIERS: ModifierState = { shift: false, ctrl: false, alt: false };

/**
 * Which value the held modifiers point at: `0` is resting, so a caller falls back
 * to what is stored.
 *
 * The most specific modifier wins — alt, then ctrl, then shift — so holding two is
 * one of the values the family already has rather than a combination with a
 * meaning of its own. A four-value family has no room for "ctrl+shift".
 */
export function modifierOffset(state: ModifierState): 0 | 1 | 2 | 3 {
  if (state.alt) return 3;
  if (state.ctrl) return 2;
  if (state.shift) return 1;
  return 0;
}

/**
 * The value a family would show for the modifiers held, or `null` for none — which
 * includes the resting modifier, because "resting" means "whatever is stored" and
 * not "the first value".
 *
 * A family with three values and no fourth gets `null` for alt rather than a
 * clamp: an empty slot is a reservation, and showing the last value instead would
 * make `alt` silently mean `ctrl`.
 */
export function previewedValue<T>(values: readonly T[], state: ModifierState): T | null {
  const offset = modifierOffset(state);
  return offset === 0 ? null : (values[offset] ?? null);
}

/** Read the modifiers off any keyboard event, so a listener has no opinion of its own. */
export function modifiersOf(event: KeyboardEvent | ReactKeyboardEvent): ModifierState {
  return { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey };
}

const TEXT_ENTRY = 'input, textarea, [contenteditable="true"], .ProseMirror';

/**
 * Whether the keyboard event is going into a text field.
 *
 * A hint is paint, so it is harmless in principle — but holding shift to type a
 * capital or ctrl to type a shortcut would flash a mode on every keystroke, which
 * teaches the reader to ignore the control. Typing is not a canvas gesture.
 */
export function isTextEntry(event: { target: EventTarget | null }): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  return target.closest(TEXT_ENTRY) !== null;
}
