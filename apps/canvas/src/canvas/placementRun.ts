import { create } from "zustand";

/**
 * A placement run: an ordered queue of cards being placed one at a time
 * ([ADR-0063](../../../docs/decisions/0063-placement-is-a-mode-too.md)).
 *
 * It is **UI state, never document data**. Nothing here is written to the CRDT, so
 * a run needs no schema, no migration and no merge story: what lands in the
 * document is what a hand gesture would have landed — placements, links and at
 * most one section.
 */

/** Where a run's queue came from; the engine behaves the same, the UI does not. */
export const placementSources = ["selection", "view", "dock", "picker"] as const;
export type PlacementSource = (typeof placementSources)[number];

export interface PlacementRun {
  /** Card ids still to place, in the order the user can see. */
  queue: string[];
  /** Card ids this run has already placed. */
  placed: string[];
  /**
   * The run's first placement. A `web` links every spoke to it, and a `place`
   * grid measures from it.
   */
  originId: string | null;
  /** The most recent placement: what a `thread` or `pattern` continues from. */
  anchorId: string | null;
  /** The section this run created to frame itself, once it exists. */
  sectionId: string | null;
  /** Whether the run should frame itself in a new section. Off by default. */
  wrap: boolean;
  source: PlacementSource;
}

export interface StartRunOptions {
  wrap?: boolean;
  source?: PlacementSource;
}

interface PlacementRunState {
  run: PlacementRun | null;
  /** Begin a run. An empty queue is not a run, so it clears instead. */
  start: (queue: readonly string[], options?: StartRunOptions) => void;
  /**
   * Record a placement. `cardId` must be the head of the queue; the caller has
   * already written the placement and its link in one commit.
   */
  advance: (cardId: string, sectionId?: string | null) => void;
  /** Drop the head of the queue without placing it. */
  skip: () => void;
  /** The run's own frame, once the engine has created it. */
  setSection: (sectionId: string | null) => void;
  setWrap: (wrap: boolean) => void;
  /** End the run. Every exit goes through here, so no stale queue survives. */
  finish: () => void;
}

const GUARD = 200;

/**
 * A run lives beside the thread arm because both are "the next gesture is part of
 * a longer one" state, and both are read by the canvas and the library. One store
 * per workspace session, like the arm.
 */
export const usePlacementRunStore = create<PlacementRunState>((set, get) => ({
  run: null,
  start: (queue, options = {}) => {
    // A queue longer than a board could usefully hold is a sign of a caller bug, not
    // a feature; clamping keeps a runaway selection from placing forever.
    const trimmed = queue.slice(0, GUARD);
    if (trimmed.length === 0) {
      set({ run: null });
      return;
    }
    set({
      run: {
        queue: trimmed,
        placed: [],
        originId: null,
        anchorId: null,
        sectionId: null,
        wrap: options.wrap === true,
        source: options.source ?? "selection",
      },
    });
  },
  advance: (cardId, sectionId = null) => {
    const run = get().run;
    if (!run) return;
    const placed = run.placed.includes(cardId) ? run.placed : [...run.placed, cardId];
    const queue = run.queue.filter((id) => id !== cardId);
    set({
      run:
        queue.length === 0
          ? null
          : {
              ...run,
              queue,
              placed,
              originId: run.originId ?? cardId,
              anchorId: cardId,
              sectionId: sectionId ?? run.sectionId,
            },
    });
  },
  skip: () => {
    const run = get().run;
    if (!run) return;
    const queue = run.queue.slice(1);
    set({ run: queue.length === 0 ? null : { ...run, queue } });
  },
  setSection: (sectionId) => {
    const run = get().run;
    if (!run) return;
    set({ run: { ...run, sectionId } });
  },
  setWrap: (wrap) => {
    const run = get().run;
    if (!run) return;
    set({ run: { ...run, wrap } });
  },
  finish: () => set({ run: null }),
}));

/** True while a run is placing, so the canvas can report progress and offer Stop. */
export function usePlacementRun(): PlacementRun | null {
  return usePlacementRunStore((state) => state.run);
}
