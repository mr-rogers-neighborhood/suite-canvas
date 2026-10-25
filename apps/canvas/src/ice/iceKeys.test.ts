import { describe, expect, it } from "vitest";

import {
  describeIceKeys,
  ICE_KEY_BINDINGS,
  type IceCommandId,
  iceCommandKeys,
  iceKeymapEntries,
  iceKeySignature,
  iceShellBindings,
} from "./iceKeys";

const EVERY_COMMAND: readonly IceCommandId[] = [
  "undo",
  "redo",
  "delete",
  "trash",
  "escape",
  "copy",
  "cut",
  "paste",
  "duplicate",
  "nudge-left",
  "nudge-right",
  "nudge-up",
  "nudge-down",
  "nudge-left-far",
  "nudge-right-far",
  "nudge-up-far",
  "nudge-down-far",
  "search",
];

/** A full handler record, so a missing command is a type error in the surface. */
function handlersOf(run: (id: IceCommandId) => void): Record<IceCommandId, () => void> {
  const handlers = {} as Record<IceCommandId, () => void>;
  for (const id of EVERY_COMMAND) handlers[id] = () => run(id);
  return handlers;
}

describe("the desk's key map", () => {
  it("should claim every keyboard signature at most once", () => {
    // Two entries with the same `key|mod|shift` would mean one silently
    // shadowing the other — ICE matches overrides by that signature.
    const signatures = ICE_KEY_BINDINGS.map(iceKeySignature);
    expect(new Set(signatures).size).toBe(signatures.length);
  });

  it("should bind the clipboard, the nudge steps and search", () => {
    const keys = iceCommandKeys();
    expect(keys.copy).toEqual(["⌘C / Ctrl+C"]);
    expect(keys.cut).toEqual(["⌘X / Ctrl+X"]);
    expect(keys.paste).toEqual(["⌘V / Ctrl+V"]);
    expect(keys.duplicate).toEqual(["⌘D / Ctrl+D"]);
    expect(keys.search).toEqual(["⌘K / Ctrl+K"]);
    expect(keys["nudge-left"]).toEqual(["←"]);
    expect(keys["nudge-left-far"]).toEqual(["⇧←"]);
    // Redo is both chords, like every editor.
    expect(keys.redo).toHaveLength(2);
  });

  it("should give every command a handler and call it exactly once", () => {
    const calls: IceCommandId[] = [];
    const handlers = handlersOf((id) => calls.push(id));
    const entries = iceKeymapEntries(handlers);
    const canvasBindings = ICE_KEY_BINDINGS.filter((binding) => binding.owner !== "shell");
    expect(entries).toHaveLength(canvasBindings.length);
    for (const entry of entries) entry.run({} as never);
    expect(calls).toEqual(canvasBindings.map((binding) => binding.id));
  });

  it("should hand ICE the modifiers the table asks for", () => {
    const entries = iceKeymapEntries(handlersOf(() => undefined));
    const paste = entries.find((entry) => entry.key === "v");
    expect(paste?.mod).toBe(true);
    expect(paste?.shift).toBeUndefined();
    // An arrow without Shift must say so: ICE treats a missing `shift` as
    // "must not be held", which is what replaces its own nudge default.
    const arrow = entries.find((entry) => entry.key === "ArrowLeft" && entry.shift !== true);
    expect(arrow?.mod).toBeUndefined();
    const far = entries.find((entry) => entry.key === "ArrowLeft" && entry.shift === true);
    expect(far).toBeDefined();
  });

  it("should leave the shell's own chords out of ICE's keymap", () => {
    // ICE cedes a `preventDefault`ed event, and the Dock binds Cmd/Ctrl+K on
    // window before the desk mounts — an ICE override for it could never fire.
    expect(iceShellBindings().map((binding) => binding.id)).toEqual(["search"]);
    const entries = iceKeymapEntries(handlersOf(() => undefined));
    expect(entries.some((entry) => entry.key === "k")).toBe(false);
  });

  it("should describe itself in one sentence for the surface's description", () => {
    const described = describeIceKeys();
    for (const binding of ICE_KEY_BINDINGS) expect(described).toContain(binding.label);
    expect(described).toContain("copy the selection");
  });
});
