import { create } from "zustand";
import type { CanvasMode } from "./linkGesture";

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

/**
 * One step of a run: a card, or a set placed as one unit (ADR-0063 amendment).
 *
 * A set keeps its relative geometry where it has one — a section and its cards —
 * and is arranged in a small grid where it does not. A step may also read the
 * shape differently from its neighbours, which is what makes a run an outline of
 * intent ("thread this one, then fan that section beside it") instead of a
 * repetition of one gesture.
 */
export interface RunStep {
  /** The cards this step places, as one unit. */
  ids: string[];
  /** Overrides the run's live mode for this step. */
  mode?: CanvasMode | undefined;
  /**
   * Dots this step should link through, when the reader picked them by hand.
   *
   * The geometry proposes a dot; this is how the reader overrules it, per step and
   * per end, without setting a preference that would stick to the next one
   * (ADR-0061 third amendment). Absent means "use the inference".
   */
  overrides?: { source?: string | null; target?: string | null } | undefined;
}

/** A step for the common case: one card, the run's own mode. */
export function cardStep(cardId: string): RunStep {
  return { ids: [cardId] };
}

export interface PlacementRun {
  /** Steps still to place, in the order the user can see. */
  queue: RunStep[];
  /** Card ids this run has already placed. */
  placed: string[];
  /**
   * The run's first placement. A `fan` links every spoke to it, and a `place`
   * grid measures from it.
   */
  originId: string | null;
  /** The most recent placement: what a `thread` or `branch` continues from. */
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
  /**
   * Runs that were live when a sub-run started, outermost first (ADR-0063 second
   * amendment). Only the top of the stack places; finishing the inner run resumes
   * the one it interrupted, exactly where it stopped.
   */
  suspended: PlacementRun[];
  /** Begin a run from card ids; each becomes a single-card step. */
  start: (queue: readonly string[], options?: StartRunOptions) => void;
  /** Begin a run from steps, when a source can offer sets or per-step modes. */
  startSteps: (steps: readonly RunStep[], options?: StartRunOptions) => void;
  /**
   * Record the step just placed. The caller has already written the placements
   * and the link in one commit.
   */
  advance: (step: RunStep, sectionId?: string | null) => void;
  /** Drop the head of the queue without placing it. */
  skip: () => void;
  /**
   * Add cards to the end of a live run. This is the picker loop: the card was
   * created a moment ago and belongs in the sequence the user is already making.
   */
  enqueue: (ids: readonly string[]) => void;
  /** The run's own frame, once the engine has created it. */
  setSection: (sectionId: string | null) => void;
  setWrap: (wrap: boolean) => void;
  /**
   * End the run. Every exit goes through here, so no stale queue survives — and
   * ending a sub-run hands control back to the run it interrupted.
   */
  finish: () => void;
  /** Drop the whole stack: a board switch or a Stop on the outermost run. */
  finishAll: () => void;
}

const GUARD = 200;

/**
 * A run lives beside the thread arm because both are "the next gesture is part of
 * a longer one" state, and both are read by the canvas and the library. One store
 * per workspace session, like the arm.
 */
export const usePlacementRunStore = create<PlacementRunState>((set, get) => ({
  run: null,
  suspended: [],
  start: (queue, options = {}) => {
    get().startSteps(queue.map(cardStep), options);
  },
  startSteps: (steps, options = {}) => {
    // A queue longer than a board could usefully hold is a sign of a caller bug, not
    // a feature; clamping keeps a runaway selection from placing forever.
    const trimmed = steps.filter((step) => step.ids.length > 0).slice(0, GUARD);
    if (trimmed.length === 0) {
      set({ run: null });
      return;
    }
    const next: PlacementRun = {
      queue: trimmed,
      placed: [],
      originId: null,
      anchorId: null,
      sectionId: null,
      wrap: options.wrap === true,
      source: options.source ?? "selection",
    };
    // Starting while one is live is a sub-run, not a replacement: the outer run is
    // suspended and resumes when this one ends (ADR-0063 second amendment).
    const current = get().run;
    set({
      run: next,
      suspended: current ? [...get().suspended, current] : get().suspended,
    });
  },
  advance: (step, sectionId = null) => {
    const run = get().run;
    if (!run) return;
    const placed = [...run.placed];
    for (const id of step.ids) if (!placed.includes(id)) placed.push(id);
    // The queue is consumed by position, not by value: two steps may name the same
    // card (placing it twice on purpose), so filtering by id would eat both.
    const queue = run.queue.slice(1);
    const first = run.originId ?? step.ids[0] ?? null;
    const anchor = step.ids[step.ids.length - 1] ?? run.anchorId;
    // The picker loop is the one run that outlives its queue: it is waiting to be
    // fed one card at a time, which is the whole point of it (ADR-0063 §6). Every
    // other run ends when its last card lands.
    const ended = queue.length === 0 && run.source !== "picker";
    set({
      run: ended
        ? null
        : {
            ...run,
            queue,
            placed,
            originId: first,
            anchorId: anchor,
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
  enqueue: (ids) => {
    const run = get().run;
    if (!run) return;
    const fresh = ids.filter((id) => !run.queue.some((step) => step.ids.includes(id)));
    if (fresh.length === 0) return;
    set({ run: { ...run, queue: [...run.queue, ...fresh.map(cardStep)] } });
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
  finish: () => {
    // A sub-run hands back to what it interrupted; the outermost run leaves nothing
    // behind, which is why Escape on it ends the whole idea rather than resuming.
    const suspended = [...get().suspended];
    const parent = suspended.pop() ?? null;
    set({ run: parent, suspended });
  },
  finishAll: () => set({ run: null, suspended: [] }),
}));

/** The live run, so the canvas can report progress and offer Stop. */
export function usePlacementRun(): PlacementRun | null {
  return usePlacementRunStore((state) => state.run);
}

/** How many runs are waiting under the live one, for the control's depth count. */
export function useSuspendedRunCount(): number {
  return usePlacementRunStore((state) => state.suspended.length);
}
