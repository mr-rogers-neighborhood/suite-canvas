import { useCallback, useState } from "react";

/**
 * Workspaces the reader pinned, per browser.
 *
 * The same rule as a board pin: a pin is a note to yourself about where you like to be,
 * not a fact about the workspace, so it lives in `localStorage` and syncs nothing. It
 * earns less than a board pin does — a pinned workspace goes to the top of the list in the
 * workspace menu and the launcher, and it does **not** earn a tab, because the tab strip
 * belongs to the board you are on. A launched workspace is one page load away; a board is
 * a click away, and only the second is worth a permanent surface.
 */
const PINS_KEY = "suite.workspacePins.v1";
/** Beyond this the top of the list stops being a shortcut. */
const MAX_PINS = 8;

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readWorkspacePins(): string[] {
  if (!hasStorage()) return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PINS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string").slice(0, MAX_PINS);
  } catch {
    return [];
  }
}

function writeWorkspacePins(pins: string[]): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    // A full or disabled storage must not break the menu.
  }
}

/** The pinned workspace ids, and the one action that changes them. */
export function useWorkspacePins(): {
  pinned: string[];
  isPinned: (workspaceId: string) => boolean;
  togglePin: (workspaceId: string) => void;
} {
  const [pinned, setPinned] = useState<string[]>(readWorkspacePins);
  const togglePin = useCallback((workspaceId: string) => {
    setPinned((current) => {
      const next = current.includes(workspaceId)
        ? current.filter((id) => id !== workspaceId)
        : [...current, workspaceId].slice(0, MAX_PINS);
      writeWorkspacePins(next);
      return next;
    });
  }, []);
  const isPinned = useCallback((workspaceId: string) => pinned.includes(workspaceId), [pinned]);
  return { pinned, isPinned, togglePin };
}

/**
 * Pinned workspaces first, in the order they were pinned, then everything else in the
 * order it arrived.
 *
 * A pin whose workspace was deleted elsewhere simply never matches a row, so a stale id
 * costs nothing: the list is per browser and outlives workspaces made on another device.
 */
export function pinnedWorkspaceOrder<T extends { id: string }>(
  entries: readonly T[],
  pins: readonly string[],
): T[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const pinned = pins.flatMap((id) => {
    const entry = byId.get(id);
    return entry ? [entry] : [];
  });
  const taken = new Set(pinned.map((entry) => entry.id));
  return [...pinned, ...entries.filter((entry) => !taken.has(entry.id))];
}
