import { create } from "zustand";
import { WORKSPACE_ID } from "../store/useCanvasStore";

/**
 * Where each reader is in each book.
 *
 * A reading position is a *reading position*: two people looking at the same book card are not in the same
 * place, and nothing about where I stopped is a fact about the document. So it is remembered per workspace and
 * per attachment in `localStorage`, and never written — the same rule a projection follows, for the same reason.
 */
/** Where a reader stopped: the chapter, how far down it, and how far through the book that is. */
export interface ReadingPosition {
  readonly path: string;
  /** Pixels scrolled into the chapter. A reading position is a place, not a percentage. */
  readonly offset: number;
  /**
   * How much of the whole book is behind the reader, 0 to 1.
   *
   * Stored rather than derived, because deriving it needs the chapter's index and its scroll height, and neither is
   * available to a surface that only wants to draw a bar: the library has the book's card, not the book.
   */
  readonly progress: number;
  /** When it was written, so "continue reading" can mean the book this reader was last in. */
  readonly at: number;
}

interface BookState {
  /** `workspace/attachment` → the place it was last open on. */
  readonly positions: Readonly<Record<string, ReadingPosition>>;
  remember: (attachmentId: string, path: string, offset?: number, progress?: number) => void;
}

const STORAGE_KEY = "suite.reader.v1";

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStored(): Record<string, ReadingPosition> {
  if (!hasStorage()) return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, ReadingPosition> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      // A position written before the offset existed is a bare chapter path: read it as the top of that chapter.
      if (typeof value === "string") out[key] = { path: value, offset: 0, progress: 0, at: 0 };
      else if (typeof value === "object" && value !== null) {
        const record = value as Record<string, unknown>;
        if (typeof record.path !== "string") continue;
        out[key] = {
          path: record.path,
          offset:
            typeof record.offset === "number" && Number.isFinite(record.offset)
              ? Math.max(0, Math.round(record.offset))
              : 0,
          // Absent means a position from before progress was recorded: an unread bar is honest, a guessed one is not.
          progress:
            typeof record.progress === "number" && Number.isFinite(record.progress)
              ? Math.min(1, Math.max(0, record.progress))
              : 0,
          at: typeof record.at === "number" && Number.isFinite(record.at) ? record.at : 0,
        };
      }
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

  remember: (attachmentId, path, offset = 0, progress = 0) => {
    const next = {
      ...get().positions,
      [positionKey(attachmentId)]: {
        path,
        offset: Math.max(0, Math.round(offset)),
        progress: Math.min(1, Math.max(0, progress)),
        at: Date.now(),
      },
    };
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
export function useBookPosition(attachmentId: string): ReadingPosition | null {
  return useBookStore((state) => state.positions[positionKey(attachmentId)] ?? null);
}
