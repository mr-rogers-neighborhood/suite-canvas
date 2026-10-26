import { type CommandGroup, commands } from "./commandRegistry";

/** A window event, because the sheet's host sits in the dock and the palette is a sibling. */
export const SHORTCUT_SHEET_EVENT = "suite:shortcuts-open";

/** Opens the sheet from anywhere: the palette row and the dock's `?` both use it. */
export function openShortcutSheet(): void {
  window.dispatchEvent(new Event(SHORTCUT_SHEET_EVENT));
}

/** One key and what it does. */
export interface ShortcutRow {
  keys: string;
  label: string;
  group: CommandGroup | "keys";
}

const GROUP_LABELS: Record<ShortcutRow["group"], string> = {
  navigation: "Navigation",
  create: "Create",
  edit: "Edit",
  layout: "Layout",
  view: "View",
  system: "System",
  keys: "The board",
};

export function shortcutGroupLabel(group: ShortcutRow["group"]): string {
  return GROUP_LABELS[group];
}

/**
 * Keys the board reads that are not commands.
 *
 * `[` toggles the outline, and the outline is a reading aid rather than an
 * action a surface lists, so it has no registry row of its own. `[` was
 * documented nowhere; it is here so the sheet is the whole answer.
 */
export const BOARD_KEY_ROWS: readonly ShortcutRow[] = [
  { keys: "[", label: "Show or hide the outline", group: "keys" },
  { keys: "Enter", label: "Open the selected card", group: "keys" },
  { keys: "Delete", label: "Take the selection off this board", group: "keys" },
  { keys: "Shift\u21e5Delete", label: "Move the selection to the trash", group: "keys" },
  { keys: "Esc", label: "Close the surface in front of you", group: "keys" },
];

/**
 * The sheet's rows: every registry command that declares a shortcut, plus the
 * board keys the registry does not own. Availability is deliberately ignored —
 * the sheet is a reference, so a key is documented in a viewer session too.
 */
export function shortcutRows(): ShortcutRow[] {
  const fromRegistry = commands.flatMap((command) =>
    command.shortcut === undefined
      ? []
      : [{ keys: command.shortcut, label: command.label, group: command.group }],
  );
  return [...fromRegistry, ...BOARD_KEY_ROWS];
}

/** Rows in the order they are drawn: registry order, then the board's own keys. */
export function shortcutGroups(): Array<{ group: ShortcutRow["group"]; rows: ShortcutRow[] }> {
  const order: ShortcutRow["group"][] = [];
  const rows = new Map<ShortcutRow["group"], ShortcutRow[]>();
  for (const row of shortcutRows()) {
    const bucket = rows.get(row.group);
    if (bucket) bucket.push(row);
    else {
      rows.set(row.group, [row]);
      order.push(row.group);
    }
  }
  return order.map((group) => ({ group, rows: rows.get(group) ?? [] }));
}
