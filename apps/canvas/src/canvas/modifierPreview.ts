import type { KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * The one modifier map both mode families read (ADR-0066).
 *
 * A family lists its values in order, resting first: `place · thread · fan ·
 * branch` and `explore · run · record` (with `explain` reserved for alt). No
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
 * The slots the keys own, in family order. Slot 0 is the resting value, which is why
 * the baseline stays reachable by a key: no key claims it, so it is always the one
 * value a held key can offer that nothing else is offering.
 */
const KEY_SLOTS = [1, 2, 3] as const;

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

/** Whether a modifier is down at all, i.e. whether the stored value is being overridden. */
export function isHeld(state: ModifierState): boolean {
  return modifierOffset(state) !== 0;
}

/**
 * The modifier a preview is riding on, named the way a key cap prints it, so a label
 * can say which key to release. The most specific one wins, exactly as in
 * `modifierOffset`, or the label would name a key that is not deciding anything.
 */
export function heldKey(state: ModifierState): string | null {
  if (state.alt) return "Alt";
  if (state.ctrl) return "Ctrl";
  if (state.shift) return "Shift";
  return null;
}

/**
 * The value a family would show for the modifiers held, or `null` for none — which
 * includes the resting modifier, because "resting" means "whatever is stored" and
 * not "the first value".
 *
 * A key means its own slot, with one exception: when the stored value is already in
 * that slot, the key hands back the value the map would otherwise leave out. The
 * invariant is that **the stored value plus the three keys show every value of the
 * family exactly once**, so no key is ever a no-op and no value is ever unreachable.
 * In a family of four that missing value is always the resting one — `values[0]` —
 * because the keys cover slots 1–3 between them; it is derived rather than assumed so
 * that a family of a different size still closes.
 *
 * A family with three values and no fourth gets `null` for alt rather than a
 * clamp: an empty slot is a reservation, and showing the last value instead would
 * make `alt` silently mean `ctrl`.
 */
export function previewedValue<T>(
  values: readonly T[],
  state: ModifierState,
  stored?: T,
): T | null {
  const offset = modifierOffset(state);
  if (offset === 0) return null;
  const storedIndex = stored === undefined ? -1 : values.indexOf(stored);
  // No collision: the key means its own slot, whatever the reader has stored.
  if (storedIndex !== offset) return values[offset] ?? null;

  // What the map would otherwise leave out: the stored value and the other keys'
  // slots are already spoken for, so hand back the one that is not.
  const slots = KEY_SLOTS.filter((slot) => slot < values.length);
  const covered = new Set<number>([storedIndex, ...slots.filter((slot) => slot !== offset)]);
  const missing = [...slots, 0].find((index) => !covered.has(index));
  return missing === undefined ? null : (values[missing] ?? null);
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
