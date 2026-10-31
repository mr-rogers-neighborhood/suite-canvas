import { create } from "zustand";
import { WORKSPACE_ID } from "./useCanvasStore";

/**
 * Which view this reader has projected onto their board.
 *
 * A projection is a *reading position*, not a fact about the workspace: two people on the same board
 * should disagree about it, exactly as they disagree about where the camera is. So it is never written
 * to the document, and nothing a peer does can fade this reader's board.
 *
 * What *is* shared is the view itself. A saved view's query and presentation are document data, which is
 * why a view card redraws for everyone when one person edits the view. Projection only decides whether
 * this reader is looking at that shared thing cast over their canvas.
 *
 * Remembered per workspace in `localStorage`, so reopening the tab returns to the view the reader was
 * studying, and the record dies if the view it names is deleted.
 */
export interface Projection {
  readonly viewId: string;
  readonly fade: boolean;
  readonly outline: boolean;
}

/** Where this reader last put the projection float, in viewport coordinates. */
export interface FloatCorner {
  readonly x: number;
  readonly y: number;
}

/** The float's resting place when nothing has been remembered: clear of the dock, down and left. */
export const DEFAULT_CORNER: FloatCorner = { x: 16, y: 16 };

interface ProjectionState {
  /** Workspace id → the projection this reader left on. */
  readonly byWorkspace: Readonly<Record<string, Projection>>;
  /** Workspace id → the corner the reader dragged the float to. */
  readonly corners: Readonly<Record<string, FloatCorner>>;
  /** Remember where the float settled, so it comes back there. */
  setCorner: (corner: FloatCorner) => void;
  /** Cast a view on the board, keeping the toggles the reader last chose. */
  project: (viewId: string) => void;
  /** Stop projecting. */
  stop: () => void;
  /** The two lens toggles, remembered for the next projection in this workspace. */
  setToggles: (patch: Partial<Pick<Projection, "fade" | "outline">>) => void;
  /** A view that no longer exists takes its projection with it. */
  forget: (viewId: string) => void;
}

const STORAGE_KEY = "suite.projection.v1";
const CORNERS_KEY = "suite.projection.corners.v1";

/**
 * What this browser files a projection under.
 *
 * The workspace id is absent before a session is chosen, and a standalone build has none at all, so the
 * key falls back to `local`: what matters is that a projection never leaks between two workspaces this
 * browser has open.
 */
export const PROJECTION_KEY = WORKSPACE_ID ?? "local";

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStored(): Record<string, Projection> {
  if (!hasStorage()) return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return {};
    return parsed as Record<string, Projection>;
  } catch {
    return {};
  }
}

function persist(byWorkspace: Readonly<Record<string, Projection>>): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(byWorkspace));
  } catch {
    // A full or disabled storage must not make the board unusable.
  }
}

function readCorners(): Record<string, FloatCorner> {
  if (!hasStorage()) return {};
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(CORNERS_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, FloatCorner> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const { x, y } = value as Record<string, unknown>;
      if (typeof x === "number" && typeof y === "number") out[key] = { x, y };
    }
    return out;
  } catch {
    return {};
  }
}

function persistCorners(corners: Readonly<Record<string, FloatCorner>>): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(CORNERS_KEY, JSON.stringify(corners));
  } catch {
    // Same rule as the projection itself: storage trouble must not break the board.
  }
}

export const useProjectionStore = create<ProjectionState>()((set, get) => {
  const write = (byWorkspace: Record<string, Projection>) => {
    persist(byWorkspace);
    set({ byWorkspace });
  };

  return {
    byWorkspace: readStored(),
    corners: readCorners(),

    setCorner: (corner) => {
      const next = { ...get().corners, [PROJECTION_KEY]: corner };
      persistCorners(next);
      set({ corners: next });
    },

    project: (viewId) => {
      const existing = get().byWorkspace[PROJECTION_KEY];
      write({
        ...get().byWorkspace,
        [PROJECTION_KEY]: {
          viewId,
          // The reader's own toggles survive a change of view: they describe how they like to read,
          // not what they are reading.
          fade: existing?.fade ?? true,
          outline: existing?.outline ?? true,
        },
      });
    },

    stop: () => {
      const { [PROJECTION_KEY]: _stopped, ...rest } = get().byWorkspace;
      write(rest);
    },

    setToggles: (patch) => {
      const current = get().byWorkspace[PROJECTION_KEY];
      if (current === undefined) return;
      write({ ...get().byWorkspace, [PROJECTION_KEY]: { ...current, ...patch } });
    },

    forget: (viewId) => {
      const current = get().byWorkspace[PROJECTION_KEY];
      if (current?.viewId !== viewId) return;
      const { [PROJECTION_KEY]: _gone, ...rest } = get().byWorkspace;
      write(rest);
    },
  };
});

/** The projection this reader has on this board, or null. */
export function useProjection(): Projection | null {
  return useProjectionStore((state) => state.byWorkspace[PROJECTION_KEY] ?? null);
}
