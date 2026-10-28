import type { Board } from "@suite/graph";
import { useCallback, useState } from "react";

/**
 * Boards the reader pinned in the switcher, per browser.
 *
 * A pin is a note to yourself about where you like to be, not a fact about the
 * workspace: two people on the same board should disagree about the order they
 * see, and pinning must not write a document that syncs. So this lives in
 * `localStorage` beside the recents mirror, and an id left behind by another
 * workspace simply never matches a board here.
 */
const PINS_KEY = "suite.boardPins.v1";
/** Beyond this the switcher's pinned group stops being a shortcut. */
const MAX_PINS = 12;

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readBoardPins(): string[] {
  if (!hasStorage()) return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PINS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string").slice(0, MAX_PINS);
  } catch {
    return [];
  }
}

function writeBoardPins(pins: string[]): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    // A full or disabled storage must not break the bar.
  }
}

/** The pinned board ids, and the one action that changes them. */
export function useBoardPins(): {
  pinned: string[];
  isPinned: (boardId: string) => boolean;
  togglePin: (boardId: string) => void;
} {
  const [pinned, setPinned] = useState<string[]>(readBoardPins);
  const togglePin = useCallback((boardId: string) => {
    setPinned((current) => {
      const next = current.includes(boardId)
        ? current.filter((id) => id !== boardId)
        : [...current, boardId].slice(0, MAX_PINS);
      writeBoardPins(next);
      return next;
    });
  }, []);
  const isPinned = useCallback((boardId: string) => pinned.includes(boardId), [pinned]);
  return { pinned, isPinned, togglePin };
}

/**
 * The pinned boards in pin order, for the tabs beside the switcher.
 *
 * A pin whose board is gone drops out here rather than rendering a dead tab: the
 * list is per browser, so it outlives a board someone deleted on another device.
 */
export function pinnedOrder(boards: readonly Board[], pins: readonly string[]): Board[] {
  const byId = new Map(boards.map((board) => [board.id, board]));
  return pins.flatMap((id) => {
    const board = byId.get(id);
    return board ? [board] : [];
  });
}
