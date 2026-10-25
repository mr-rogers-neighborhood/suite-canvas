import { create } from "zustand";
import type { CanvasMode } from "./linkGesture";

/**
 * Recording a tour ([ADR-0058](../../../docs/decisions/0058-a-tour-is-one-document-on-three-surfaces.md)
 * amendment, [ADR-0064](../../../docs/decisions/0064-two-axes-and-a-cursor-that-says-so.md) §9).
 *
 * Recording is a *purpose*, and the gesture axis becomes the step verb: `place` and
 * `thread` append a step per click, `web` accumulates several targets into one step.
 * A tour's order is its step list — recording draws no links — so nothing here
 * touches edges.
 */

/** How a click adds to the tour. Derived from the gesture, never stored twice. */
export interface RecordClickPlan {
  /** `newStep` appends a step; `addTarget` grows the step the author is on. */
  action: "newStep" | "addTarget";
  /** The step the click lands in, counting from zero, once the plan is applied. */
  stepIndex: number;
}

/**
 * What one click means while recording.
 *
 * `web` is the interesting one: the author is building *one* step that spotlights
 * several entities, so every click after the first joins the same step. `place` and
 * `thread` are the same plan for one click — a sequence — and are kept distinct
 * because the author picked them and the cursor says which.
 *
 * `pattern` has no step meaning: a pattern is a placement shape (ADR-0049), so it is
 * read as `thread` here rather than inventing a fourth way to add a step.
 */
export function planRecordClick(gesture: CanvasMode, stepCount: number): RecordClickPlan {
  if (gesture === "web" && stepCount > 0) {
    // The step already being written is the last one: `web` grows it.
    return { action: "addTarget", stepIndex: stepCount - 1 };
  }
  return { action: "newStep", stepIndex: stepCount };
}

interface RecordRunState {
  /** The tutorial being recorded, or null when nothing is being captured. */
  tutorialId: string | null;
  /** Steps captured in this recording, for the control's count. */
  steps: number;
  start: (tutorialId: string) => void;
  /** One captured click, so the count follows the author. */
  captured: (plan: RecordClickPlan) => void;
  stop: () => void;
}

/**
 * The recording's own state, beside the placement run for the same reason: it is
 * gesture state, it never reaches the document, and the canvas, the control and the
 * tour panel all read it.
 */
export const useRecordRunStore = create<RecordRunState>((set, get) => ({
  tutorialId: null,
  steps: 0,
  start: (tutorialId) => set({ tutorialId, steps: 0 }),
  captured: (plan) =>
    set((state) =>
      plan.action === "newStep" ? { steps: state.steps + 1 } : { steps: state.steps },
    ),
  stop: () => {
    // A stop with nothing captured leaves nothing behind; a stop after use keeps
    // the count for the summary the panel shows.
    if (get().tutorialId === null) return;
    set({ tutorialId: null });
  },
}));

/** True while a tour is being recorded. */
export function isRecording(): boolean {
  return useRecordRunStore.getState().tutorialId !== null;
}
