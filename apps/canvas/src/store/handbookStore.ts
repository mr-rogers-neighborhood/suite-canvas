import type { Target } from "@suite/graph";
import { create } from "zustand";

/**
 * Where the handbook sits, what it is showing, and what explain mode asked it.
 *
 * This is reader state and never document data (ADR-0045 §1's amendment): the panel is
 * measured against this window's chrome, so syncing it would move someone else's bubble while
 * they read. Its rects and its open state survive a reload because a reader who parked the
 * handbook in a corner expects it there next time; the article, the explain scope and the open
 * pane do not, because those are the answer to a question asked a minute ago.
 */
export interface HandbookRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type HandbookPane = "handbook" | "feedback";

interface HandbookState {
  open: boolean;
  /** The pill's rect, in shell coordinates. */
  collapsed: HandbookRect;
  /** The panel's rect, remembered apart from the pill's. */
  expanded: HandbookRect;
  /** The open article, or null while the list is showing. */
  articleId: string | null;
  /** What the reader last read, so the pill can name it. */
  lastArticleId: string | null;
  /** Targets explain mode gathered: a selection, or what the picker pointed at. */
  scope: readonly Target[];
  pane: HandbookPane;
  /** True while the next click is being turned into a target. */
  picking: boolean;

  toggle: () => void;
  setOpen: (open: boolean) => void;
  setRect: (which: "collapsed" | "expanded", rect: HandbookRect) => void;
  openArticle: (articleId: string) => void;
  closeArticle: () => void;
  setPane: (pane: HandbookPane) => void;
  setPicking: (picking: boolean) => void;
  addToScope: (target: Target) => void;
  removeFromScope: (target: Target) => void;
  setScope: (targets: readonly Target[]) => void;
  clearScope: () => void;
}

const STORAGE_KEY = "suite.handbook.v1";

/** The pill starts bottom-right, above the dock and clear of the title bar. */
const DEFAULT_COLLAPSED: HandbookRect = { x: 0, y: 0, width: 196, height: 36 };
const DEFAULT_EXPANDED: HandbookRect = { x: 0, y: 0, width: 340, height: 460 };

interface Stored {
  open?: unknown;
  collapsed?: unknown;
  expanded?: unknown;
  lastArticleId?: unknown;
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function rectOf(value: unknown, fallback: HandbookRect): HandbookRect {
  if (typeof value !== "object" || value === null) return fallback;
  const candidate = value as Record<string, unknown>;
  const numbers = ["x", "y", "width", "height"].map((key) => candidate[key]);
  if (!numbers.every((number) => typeof number === "number" && Number.isFinite(number))) {
    return fallback;
  }
  const [x, y, width, height] = numbers as number[];
  return {
    x: x ?? 0,
    y: y ?? 0,
    width: width ?? fallback.width,
    height: height ?? fallback.height,
  };
}

function readStored(): Pick<HandbookState, "open" | "collapsed" | "expanded" | "lastArticleId"> {
  const fallback = {
    open: false,
    collapsed: DEFAULT_COLLAPSED,
    expanded: DEFAULT_EXPANDED,
    lastArticleId: null,
  };
  if (!hasStorage()) return fallback;
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return fallback;
    const stored = parsed as Stored;
    return {
      open: stored.open === true,
      collapsed: rectOf(stored.collapsed, fallback.collapsed),
      expanded: rectOf(stored.expanded, fallback.expanded),
      lastArticleId: typeof stored.lastArticleId === "string" ? stored.lastArticleId : null,
    };
  } catch {
    return fallback;
  }
}

function persist(state: HandbookState): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        open: state.open,
        collapsed: state.collapsed,
        expanded: state.expanded,
        lastArticleId: state.lastArticleId,
      }),
    );
  } catch {
    // A full or disabled storage must not make the handbook unusable.
  }
}

const initial = readStored();

export const useHandbookStore = create<HandbookState>()((set, get) => {
  const write = (patch: Partial<HandbookState>) => {
    set(patch);
    persist(get());
  };

  return {
    ...initial,
    articleId: null,
    scope: [],
    pane: "handbook",
    picking: false,

    toggle: () => write({ open: !get().open }),
    setOpen: (open) => write({ open }),
    setRect: (which, rect) => write({ [which]: rect }),

    openArticle: (articleId) =>
      write({ articleId, lastArticleId: articleId, open: true, pane: "handbook" }),
    closeArticle: () => set({ articleId: null }),

    setPane: (pane) => set({ pane }),
    setPicking: (picking) => set({ picking }),

    addToScope: (target) =>
      set((state) =>
        state.scope.some((entry) => entry.kind === target.kind && entry.id === target.id)
          ? state
          : { scope: [...state.scope, target], open: true },
      ),
    removeFromScope: (target) =>
      set((state) => ({
        scope: state.scope.filter(
          (entry) => !(entry.kind === target.kind && entry.id === target.id),
        ),
      })),
    setScope: (targets) => set({ scope: targets }),
    clearScope: () => set({ scope: [], picking: false }),
  };
});

/** The rect the bubble is drawn at right now: one float with two remembered sizes. */
export function activeHandbookRect(state: {
  open: boolean;
  collapsed: HandbookRect;
  expanded: HandbookRect;
}): HandbookRect {
  return state.open ? state.expanded : state.collapsed;
}

/** Where the pill starts if the reader has never moved it: bottom-right, over the canvas. */
export function defaultHandbookRects(viewport: { width: number; height: number }): {
  collapsed: HandbookRect;
  expanded: HandbookRect;
} {
  const width = Math.min(360, viewport.width - 32);
  const height = Math.min(460, viewport.height - 120);
  return {
    collapsed: {
      x: viewport.width - 196 - 16,
      y: viewport.height - 36 - 72,
      width: 196,
      height: 36,
    },
    expanded: {
      x: viewport.width - width - 16,
      y: Math.max(56, viewport.height - height - 72),
      width,
      height,
    },
  };
}
