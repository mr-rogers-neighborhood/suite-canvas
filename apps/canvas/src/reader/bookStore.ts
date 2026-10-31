import { create } from "zustand";
import { WORKSPACE_ID } from "../store/useCanvasStore";

/**
 * Where each reader is in each book.
 *
 * A reading position is a *reading position*: two people looking at the same book card are not in the same
 * place, and nothing about where I stopped is a fact about the document. So it is remembered per workspace and
 * per attachment in `localStorage`, and never written — the same rule a projection follows, for the same reason.
 */
interface BookState {
  /** `workspace/attachment` → the chapter it was last open on. */
  readonly positions: Readonly<Record<string, string>>;
  remember: (attachmentId: string, path: string) => void;
}

const STORAGE_KEY = "suite.reader.v1";

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStored(): Record<string, string> {
  if (!hasStorage()) return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** What this browser files a reading position under, so two workspaces cannot share one. */
export function positionKey(attachmentId: string): string {
  return `${WORKSPACE_ID ?? "local"}/${attachmentId}`;
}

export const useBookStore = create<BookState>()((set, get) => ({
  positions: readStored(),

  remember: (attachmentId, path) => {
    const next = { ...get().positions, [positionKey(attachmentId)]: path };
    set({ positions: next });
    if (!hasStorage()) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // A full or disabled storage must not make a book unreadable.
    }
  },
}));

/** Where this reader stopped in this book, or null. */
export function useBookPosition(attachmentId: string): string | null {
  return useBookStore((state) => state.positions[positionKey(attachmentId)] ?? null);
}
