import { create } from "zustand";
import type { CanvasMode } from "./links/linkGesture";

/**
 * A placement run: an ordered queue of cards being placed one at a time
 * (ADR-0063).
 *
 * It is **UI state, never document data**. Nothing here is written to the CRDT, so
 * a run needs no schema, no migration and no merge story: what lands in the
 * document is what a hand gesture would have landed — placements, links and at
 * most one section.
 */

/** Where a run's queue came from; the engine behaves the same, the UI does not. */
export const placementSources = ["selection", "view", "dock", "picker", "canvas"] as const;
export type PlacementSource = (typeof placementSources)[number];

/**
 * Sources whose run waits for cards instead of ending when its queue empties.
 *
 * A picker loop waits to be fed one card at a time. A run started from a card on the
 * canvas has nothing in hand yet — the reader asked to fan *from here* and has still
 * to choose what to fan, from the library or from the drop menu — so it waits too.
 */
const OPEN_SOURCES: readonly PlacementSource[] = ["picker", "canvas"];

/** Whether a run waits for cards rather than ending with its queue. */
export function isOpenRun(run: Pick<PlacementRun, "source">): boolean {
  return OPEN_SOURCES.includes(run.source);
}

/**
 * One step of a run: a card, or a set placed as one unit (ADR-0063 amendment).
 *
 * A set keeps its relative geometry where it has one — a section and its cards —
 * and is arranged in a small grid where it does not. The shape is the run's, not the
 * step's: one run draws one thing.
 */
export interface RunStep {
  /** The cards this step places, as one unit. */
  ids: string[];
  /**
   * Dots this step should link through, when the reader picked them by hand.
   *
   * The geometry proposes a dot; this is how the reader overrules it, per step and
   * per end, without setting a preference that would stick to the next one
   * (ADR-0061 third amendment). Absent means "use the inference".
   */
  overrides?: { source?: string | null; target?: string | null } | undefined;
}

/** A step for the common case: one card. */
export function cardStep(cardId: string): RunStep {
  return { ids: [cardId] };
}

/** The dots a held card would leave and arrive on, before it is dropped. */
export interface ProposedLink {
  anchorId: string;
  source: string | null;
  target: string | null;
}

export interface PlacementRun {
  /** Steps still to place, in the order the user can see. */
  queue: RunStep[];
  /** Card ids this run has already placed. */
  placed: string[];
  /**
   * The shape the run draws, fixed when it starts.
   *
   * A property of the run rather than a read of the live mode, because the live
   * mode can change under a run: a modifier, the mode control or a side effect of
   * another gesture, and the steps after it would be planned as a different shape.
   * That is how a fan drew a web — some spokes to the hub, later ones to the card
   * before them. One run, one shape (ADR-0063 fourth amendment).
   */
  shape: CanvasMode;
  /**
   * Where the run's hub comes from.
   *
   * `first` is a run started from the library: the reader has nothing on the board
   * yet, so the first card they drop is the hub. `existing` is a run started from a
   * card already on the board, which is its hub and is never placed again.
   */
  hub: "first" | "existing";
  /** The hub: what a `fan` links every spoke to, and what a `place` grid measures from. */
  originId: string | null;
  /** The most recent placement: what a `thread` continues from. */
  anchorId: string | null;
  /** The section this run created to frame itself, once it exists. */
  sectionId: string | null;
  /** Whether the run should frame itself in a new section. Off by default. */
  wrap: boolean;
  source: PlacementSource;
}

export interface StartRunOptions {
  /** The shape the run draws; `place` when a caller has no opinion. */
  shape?: CanvasMode;
  /** Where the hub comes from; `first` when a caller has no opinion. */
  hub?: "first" | "existing";
  /** The hub, for a run that starts from a card already on the board. */
  originId?: string | null;
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
  /**
   * True from the moment the run's last card lands until the gesture that placed it
   * ends.
   *
   * The run used to vanish inside the `pointerdown` that placed its final card, and
   * the rest of that gesture — React Flow's `onConnect`, `onConnectEnd` — then saw no
   * run at all and drew a link nobody asked for. A press is one gesture from down to
   * up, so the guard lasts that long (ADR-0063 fourth amendment).
   */
  settling: boolean;
  /** The gesture that placed the last card is over; the run is gone. */
  settle: () => void;
  /**
   * Change what the rest of the run draws.
   *
   * A deliberate change, from the run's own bar: the shape is a run property so a
   * modifier pressed for something else cannot steer it, but the reader can.
   */
  setShape: (shape: CanvasMode) => void;
  /** Begin a run from card ids; each becomes a single-card step. */
  start: (queue: readonly string[], options?: StartRunOptions) => void;
  /** Begin a run from steps, when a source can offer sets. */
  startSteps: (steps: readonly RunStep[], options?: StartRunOptions) => void;
  /** Record the step just placed. The caller has already written the placements and the link. */
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
  /**
   * Record which dot the reader picked for the step at the top of the queue.
   *
   * The geometry proposes; this is how the reader disposes before the card is
   * dropped, per step and per end, without a preference that would outlive it.
   */
  setOverrides: (overrides: { source?: string | null; target?: string | null }) => void;
  /**
   * The dots the held card would use if it landed where the pointer is now.
   *
   * UI state, never document state: it exists so the canvas can highlight the dot
   * the commit would choose, and it is cleared the moment nothing is held.
   */
  proposal: ProposedLink | null;
  setProposal: (proposal: ProposedLink | null) => void;
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
 * Whether a run owns the pointer right now, which includes the closing gesture.
 *
 * Every surface that could draw a link asks this rather than reading `run`, because
 * `run` is null for the last few events of the gesture that finished it.
 */
export function pointerOwnedByRun(): boolean {
  const state = usePlacementRunStore.getState();
  return state.run !== null || state.settling;
}

/**
 * A run lives beside the thread arm because both are "the next gesture is part of
 * a longer one" state, and both are read by the canvas and the library. One store
 * per workspace session, like the arm.
 */
export const usePlacementRunStore = create<PlacementRunState>((set, get) => ({
  run: null,
  proposal: null,
  suspended: [],
  settling: false,
  settle: () => {
    if (get().settling) set({ settling: false });
  },
  setShape: (shape) => {
    const run = get().run;
    if (!run || run.shape === shape) return;
    set({ run: { ...run, shape } });
  },
  start: (queue, options = {}) => {
    get().startSteps(queue.map(cardStep), options);
  },
  startSteps: (steps, options = {}) => {
    // A queue longer than a board could usefully hold is a sign of a caller bug, not
    // a feature; clamping keeps a runaway selection from placing forever.
    const trimmed = steps.filter((step) => step.ids.length > 0).slice(0, GUARD);
    // An open run may start with nothing in hand: "fan from this card" is a decision
    // about the hub, and the spokes arrive afterwards.
    if (trimmed.length === 0 && (options.source ?? "selection") !== "canvas") {
      set({ run: null });
      return;
    }
    const hub = options.hub ?? "first";
    const next: PlacementRun = {
      queue: trimmed,
      placed: [],
      shape: options.shape ?? "place",
      hub,
      // A run from a card already on the board knows its hub from the first click;
      // a run from the library learns it from the first card dropped.
      originId: hub === "existing" ? (options.originId ?? null) : null,
      anchorId: hub === "existing" ? (options.originId ?? null) : null,
      sectionId: null,
      wrap: options.wrap === true,
      source: options.source ?? "selection",
    };
    // Starting while one is live is a sub-run, not a replacement: the outer run is
    // suspended and resumes when this one ends (ADR-0063 second amendment).
    const current = get().run;
    set({
      run: next,
      settling: false,
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
    // The hub is whichever card the run started from: the one it was given, or the
    // first it dropped. It never moves, which is the whole of what a fan means.
    const first = run.originId ?? step.ids[0] ?? null;
    const anchor = step.ids[step.ids.length - 1] ?? run.anchorId;
    // The picker loop is the one run that outlives its queue: it is waiting to be
    // fed one card at a time, which is the whole point of it (ADR-0063 §6). Every
    // other run ends when its last card lands.
    const ended = queue.length === 0 && !isOpenRun(run);
    set({
      settling: ended,
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
  setOverrides: (overrides) => {
    const run = get().run;
    const next = run?.queue[0];
    if (!run || !next) return;
    // Onto the *head* only: a later step keeps its own geometry rather than
    // inheriting a choice made about a different card.
    const queue = [
      { ...next, overrides: { ...next.overrides, ...overrides } },
      ...run.queue.slice(1),
    ];
    set({ run: { ...run, queue } });
  },

  setProposal: (proposal) => {
    const current = get().proposal;
    const same =
      current?.anchorId === proposal?.anchorId &&
      current?.source === proposal?.source &&
      current?.target === proposal?.target;
    // Dots are marked from this, so an identical proposal must not re-render them.
    if (same) return;
    set({ proposal });
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
    // An explicit stop is not a gesture, so nothing is waiting to settle.
    set({ run: parent, suspended, settling: false });
  },
  finishAll: () => set({ run: null, suspended: [], settling: false }),
}));

/** The live run, so the canvas can report progress and offer Stop. */
export function usePlacementRun(): PlacementRun | null {
  return usePlacementRunStore((state) => state.run);
}

/** How many runs are waiting under the live one, for the control's depth count. */
export function useSuspendedRunCount(): number {
  return usePlacementRunStore((state) => state.suspended.length);
}
