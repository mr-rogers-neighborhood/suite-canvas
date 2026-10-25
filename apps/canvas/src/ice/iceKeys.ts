/**
 * The desk's keyboard, as one table.
 *
 * ICE binds a default keymap of its own (`@vibecook/ice/react`'s `attachKeymap`):
 * arrows nudge through ICE's ECS, ⌘D duplicates into ICE's document, ⌘Z undoes
 * ICE's history. None of that is allowed to run — the graph is the only document
 * truth and Loro is the only history — so every key the surface wants is an
 * *override*, and an override replaces a default by its `key|mod|shift`
 * signature.
 *
 * Keeping the table here, rather than inline in `IceSurface`, buys two things:
 *
 * - **One place to read.** The accessible description of the surface, the docs
 *   and the keymap itself cannot drift apart, because they are the same list.
 * - **A testable shape.** `iceKeys.test.ts` can assert that no two entries claim
 *   the same signature (a silently shadowed key) and that every command the
 *   surface implements is reachable from a key.
 *
 * The table is data; the commands live in `useIceBoardGesture` (they need the
 * engine, the seed and the document) and `IceSurface` supplies the handlers.
 * Nothing here touches ICE, React or the document.
 */

import type { KeymapEntry } from "@vibecook/ice/react";

/** Every key the surface binds. One id per action, not per keystroke. */
export type IceCommandId =
  | "undo"
  | "redo"
  | "delete"
  | "trash"
  | "escape"
  | "copy"
  | "cut"
  | "paste"
  | "duplicate"
  | "nudge-left"
  | "nudge-right"
  | "nudge-up"
  | "nudge-down"
  | "nudge-left-far"
  | "nudge-right-far"
  | "nudge-up-far"
  | "nudge-down-far"
  | "search";

/**
 * Who binds the chord.
 *
 * `canvas` keys are ICE keymap overrides. `shell` keys are handled by the
 * surface's own capture-phase listener, because ICE cedes a key whose event was
 * already `preventDefault`ed — and the shell's Dock binds Cmd/Ctrl+K on `window`
 * before the desk mounts, so an ICE override for it would never fire.
 */
export type IceKeyOwner = "canvas" | "shell";

export interface IceKeyBinding {
  readonly id: IceCommandId;
  /** Defaults to `canvas`. */
  readonly owner?: IceKeyOwner;
  /** How the chord is written for a reader (`⌘C / Ctrl+C`). */
  readonly keys: string;
  /** What the chord does, in one imperative line. */
  readonly label: string;
  /** `event.key`; matching is case-insensitive on ICE's side. */
  readonly key: string;
  /** ⌘ on macOS, Ctrl elsewhere. Absent means "must not be held". */
  readonly mod?: boolean;
  readonly shift?: boolean;
}

/**
 * The bound keys, in reading order.
 *
 * `Delete` removes a card from the Board it is on and `Shift+Delete` is the only
 * destructive key — the decision and its reasoning are in `useIceBoardGesture`.
 * A nudge is one document unit, ten with Shift, and it is the same
 * `planMoveCommit` a drag uses, so the two can never disagree about coordinates.
 */
export const ICE_KEY_BINDINGS: readonly IceKeyBinding[] = [
  { id: "undo", key: "z", mod: true, keys: "⌘Z / Ctrl+Z", label: "undo the last write" },
  { id: "redo", key: "z", mod: true, shift: true, keys: "⇧⌘Z / Shift+Ctrl+Z", label: "redo" },
  { id: "redo", key: "y", mod: true, keys: "⌘Y / Ctrl+Y", label: "redo" },
  {
    id: "delete",
    key: "Delete",
    keys: "Delete",
    label: "remove the selection from this Board (the card stays in the library)",
  },
  {
    id: "delete",
    key: "Backspace",
    keys: "Backspace",
    label: "remove the selection from this Board",
  },
  {
    id: "trash",
    key: "Delete",
    shift: true,
    keys: "⇧Delete / Shift+Delete",
    label: "move the selection to the trash",
  },
  {
    id: "trash",
    key: "Backspace",
    shift: true,
    keys: "⇧Backspace",
    label: "move the selection to the trash",
  },
  {
    id: "escape",
    key: "Escape",
    keys: "Esc",
    label: "abandon the gesture, leave the Board, then clear the selection",
  },
  { id: "copy", key: "c", mod: true, keys: "⌘C / Ctrl+C", label: "copy the selection" },
  {
    id: "cut",
    key: "x",
    mod: true,
    keys: "⌘X / Ctrl+X",
    label: "copy the selection, then remove it from this Board",
  },
  {
    id: "paste",
    key: "v",
    mod: true,
    keys: "⌘V / Ctrl+V",
    label: "paste onto the Board under the pointer",
  },
  {
    id: "duplicate",
    key: "d",
    mod: true,
    keys: "⌘D / Ctrl+D",
    label: "duplicate the selection just down-right of itself",
  },
  { id: "nudge-left", key: "ArrowLeft", keys: "←", label: "nudge the selection one unit left" },
  { id: "nudge-right", key: "ArrowRight", keys: "→", label: "nudge the selection one unit right" },
  { id: "nudge-up", key: "ArrowUp", keys: "↑", label: "nudge the selection one unit up" },
  { id: "nudge-down", key: "ArrowDown", keys: "↓", label: "nudge the selection one unit down" },
  {
    id: "nudge-left-far",
    key: "ArrowLeft",
    shift: true,
    keys: "⇧←",
    label: "nudge the selection ten units left",
  },
  {
    id: "nudge-right-far",
    key: "ArrowRight",
    shift: true,
    keys: "⇧→",
    label: "nudge the selection ten units right",
  },
  { id: "nudge-up-far", key: "ArrowUp", shift: true, keys: "⇧↑", label: "nudge ten units up" },
  {
    id: "nudge-down-far",
    key: "ArrowDown",
    shift: true,
    keys: "⇧↓",
    label: "nudge ten units down",
  },
  {
    id: "search",
    key: "k",
    mod: true,
    owner: "shell",
    keys: "⌘K / Ctrl+K",
    label: "search this canvas and fly to a card",
  },
];

/** The signature ICE compares an override with a default by. */
export function iceKeySignature(binding: IceKeyBinding): string {
  return `${binding.key.toLowerCase()}|${binding.mod === true}|${binding.shift === true}`;
}

/** How a command is reachable: the chords, in order, joined for prose. */
export function iceCommandKeys(): Readonly<Record<IceCommandId, readonly string[]>> {
  const keys: Partial<Record<IceCommandId, string[]>> = {};
  for (const binding of ICE_KEY_BINDINGS) {
    const list = keys[binding.id] ?? [];
    list.push(binding.keys);
    keys[binding.id] = list;
  }
  return keys as Readonly<Record<IceCommandId, readonly string[]>>;
}

/** The bindings the shell's own listener owns rather than ICE's keymap. */
export function iceShellBindings(): readonly IceKeyBinding[] {
  return ICE_KEY_BINDINGS.filter((binding) => binding.owner === "shell");
}

/**
 * ICE keymap overrides for every canvas-owned binding. A handler must exist for
 * each id; the map is typed as a full record so a new command cannot ship
 * unbound.
 */
export function iceKeymapEntries(
  handlers: Readonly<Record<IceCommandId, () => void>>,
): KeymapEntry[] {
  return ICE_KEY_BINDINGS.filter((binding) => binding.owner !== "shell").map((binding) => ({
    key: binding.key,
    ...(binding.mod === true ? { mod: true } : {}),
    ...(binding.shift === true ? { shift: true } : {}),
    run: () => handlers[binding.id](),
  }));
}

/** The keyboard, as one sentence — what the surface's description carries. */
export function describeIceKeys(): string {
  return ICE_KEY_BINDINGS.map((binding) => `${binding.keys} ${binding.label}`).join("; ");
}
