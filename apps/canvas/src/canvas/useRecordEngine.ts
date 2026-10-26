import { insertTourStep, listTourSteps, type Target, updateTourStep } from "@suite/graph";
import { useCallback, useMemo } from "react";
import { currentViewport } from "../cards/tour";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { planRecordClick, useRecordRunStore } from "./recordRun";

/**
 * The engine that turns clicks into tour steps
 * (ADR-0058
 * amendment, ADR-0064 §9).
 *
 * The sibling of `usePlacementEngine`: a hook, because the canvas captures the
 * click while the control and the Steps panel read the same run, and it reads the
 * stores itself so a caller cannot forget the document or the gesture. Recording
 * is gesture state; the steps it writes are document truth and go through
 * `@suite/graph`.
 *
 * The click path reads the tutorial body, never a stored count: a collaborator
 * may have added steps, and where a step lands is the body's answer. The count in
 * `state` is the run's own, seeded when the recording starts.
 */
export interface RecordEngine {
  /** Capture one click as a step, or into the step being written. */
  record: (target: Target) => void;
  /** End the recording. The steps already written stay on the tutorial. */
  stop: () => void;
  /** Arm recording into one tutorial card. */
  start: (tutorialId: string) => void;
  /**
   * The step the next click lands in, counting from zero, or null when nothing
   * is being recorded. `fan` holds the step it is growing; every other gesture
   * holds the next one (ADR-0058 amendment).
   */
  held: number | null;
  /** What the control reports: the tour being filled and how long it is. */
  state: { tutorialId: string | null; steps: number };
}

export function useRecordEngine(): RecordEngine {
  const workspace = useCanvasStore((state) => state.workspace);
  const tutorialId = useRecordRunStore((state) => state.tutorialId);
  const steps = useRecordRunStore((state) => state.steps);
  const gesture = useUiStore((state) => state.mode);

  const start = useCallback(
    (nextTutorialId: string) => {
      // Seeded from the tutorial itself: re-entering `record` continues the tour
      // it finds rather than pretending the timeline starts empty.
      const existing = listTourSteps(workspace, nextTutorialId).length;
      useRecordRunStore.getState().start(nextTutorialId, existing);
    },
    [workspace],
  );

  const stop = useCallback(() => {
    useRecordRunStore.getState().stop();
  }, []);

  const record = useCallback(
    (target: Target) => {
      // Read at click time, never from a closure: entering `record` creates the
      // tutorial, opens its tour and arms the capture in the same tick, and a
      // gesture change has to steer the *next* click, not the one that armed it.
      const run = useRecordRunStore.getState();
      const recordingId = run.tutorialId;
      if (recordingId === null) return;
      if (!useUiStore.getState().canEditContent) return;
      const current = listTourSteps(workspace, recordingId);
      const plan = planRecordClick(useUiStore.getState().mode, current.length);
      const viewport = currentViewport();

      if (plan.action === "addTarget") {
        const heldStep = current[plan.stepIndex];
        if (!heldStep) return;
        const targets = heldStep.step?.targets ?? [];
        // A step pointing at the same thing twice is a typo rather than a second
        // highlight, and `validTargets` would drop it on the next read anyway.
        if (targets.some((entry) => entry.kind === target.kind && entry.id === target.id)) return;
        updateTourStep(workspace, recordingId, heldStep.stepId, {
          targets: [...targets, target],
        });
      } else {
        // A recorded step keeps the camera the author was looking at — the same
        // anchor the Steps panel stores when it picks a target by hand
        // (ADR-0054 §5), and what a reader sees once the target is gone.
        insertTourStep(workspace, recordingId, {
          id: crypto.randomUUID(),
          targets: [target],
          ...(viewport ? { viewport } : {}),
          advance: "next",
        });
      }
      run.captured(plan);
    },
    [workspace],
  );

  const held = tutorialId === null ? null : planRecordClick(gesture, steps).stepIndex;
  const state = useMemo(() => ({ tutorialId, steps }), [steps, tutorialId]);

  return { record, stop, start, held, state };
}
