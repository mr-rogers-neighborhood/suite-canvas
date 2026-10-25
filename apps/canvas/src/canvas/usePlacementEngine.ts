import { useReactFlow } from "@xyflow/react";
import { useCallback } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "./multiSelect";
import { type PlacementSource, type RunStep, usePlacementRunStore } from "./placementRun";
import { connectorFacing, planPlacementStep, planRunFrame, planSetOffsets } from "./placeRun";

/**
 * The engine that carries out a placement run
 * ([ADR-0063](../../../docs/decisions/0063-placement-is-a-mode-too.md)).
 *
 * A hook rather than a prop, because three surfaces need it and they are not in
 * one tree: the library and the dock start a run, the mode control reports and
 * steers one, and the canvas owns the camera the first card lands in. It reads
 * the stores itself so a caller cannot forget to pass the document or the mode.
 */
export interface PlacementEngine {
  /** Place the next step. */
  step: () => void;
  /** Place everything left, as one undo step. */
  placeAll: () => void;
  /** End the run wherever it is. */
  stop: () => void;
  /** Start a run from card ids, each becoming a one-card step. */
  start: (queue: readonly string[], source: PlacementSource) => void;
}

export function usePlacementEngine(): PlacementEngine {
  const workspace = useCanvasStore((state) => state.workspace);
  const { screenToFlowPosition } = useReactFlow();
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const canEditLayout = useUiStore((state) => state.canEditLayout);

  /** The viewport centre in flow space: where a card lands when nothing else says. */
  const canvasPoint = useCallback(() => {
    const rect = document.querySelector('[data-testid="canvas-board"]')?.getBoundingClientRect();
    const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const y = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    return screenToFlowPosition({ x, y });
  }, [screenToFlowPosition]);

  const planStep = useCallback(
    (
      step: RunStep,
      run: { placed: string[]; originId: string | null; anchorId: string | null },
    ) => {
      const placements = activeBoardId ? workspace.listBoardPlacements(activeBoardId) : [];
      const placementOf = (id: string | null) =>
        id === null ? undefined : placements.find((entry) => entry.cardId === id);
      const boxOf = (id: string | null) => {
        const placement = placementOf(id);
        if (!placement) return null;
        return {
          x: placement.x,
          y: placement.y,
          width: placement.width ?? DEFAULT_CARD_WIDTH,
          height: placement.height ?? DEFAULT_CARD_HEIGHT,
        };
      };
      const head = step.ids[0];
      if (!head) return null;
      const own = placementOf(head);
      const size = {
        width: own?.width ?? DEFAULT_CARD_WIDTH,
        height: own?.height ?? DEFAULT_CARD_HEIGHT,
      };
      // Only what was on the board *before* the run: the run's own cards are placed
      // apart by construction, and treating them as obstacles would make a grid walk
      // away from itself.
      const placedByRun = new Set(run.placed);
      const occupied = placements
        .filter((entry) => !placedByRun.has(entry.cardId))
        .map((entry) => ({
          x: entry.x,
          y: entry.y,
          width: entry.width ?? DEFAULT_CARD_WIDTH,
          height: entry.height ?? DEFAULT_CARD_HEIGHT,
        }));

      // Read at step time, never from a closure: a verb sets the mode and starts the
      // run in the same tick, and a control change should steer the *next* card.
      const liveMode = useUiStore.getState().mode;
      const placementOptions = useUiStore.getState().placementOptions;
      const planned = planPlacementStep({
        // A step may read the shape differently from its neighbours, which is what
        // makes a run an outline of intent (ADR-0063 amendment).
        mode: step.mode ?? liveMode,
        index: run.placed.length,
        size,
        origin: boxOf(run.originId),
        anchor: boxOf(run.anchorId),
        start: canvasPoint(),
        occupied,
        options: placementOptions,
      });
      const offsets = planSetOffsets(step.ids.length, size, placementOptions);
      const boxes = step.ids.map((id, index) => {
        const offset = offsets[index] ?? { x: 0, y: 0 };
        const existing = placementOf(id);
        return {
          x: planned.position.x + offset.x,
          y: planned.position.y + offset.y,
          width: existing?.width ?? DEFAULT_CARD_WIDTH,
          height: existing?.height ?? DEFAULT_CARD_HEIGHT,
        };
      });
      const linkFrom = planned.link
        ? placementOf(run[planned.link.from === "origin" ? "originId" : "anchorId"])
        : undefined;
      return { planned, boxes, linkFrom, head };
    },
    [activeBoardId, canvasPoint, workspace],
  );

  const step = useCallback(() => {
    if (!activeBoardId || !canEditLayout) return;
    const run = usePlacementRunStore.getState().run;
    if (!run) return;
    const next = run.queue[0];
    if (!next) {
      usePlacementRunStore.getState().finish();
      return;
    }
    const plan = planStep(next, run);
    if (!plan) {
      usePlacementRunStore.getState().finish();
      return;
    }

    let sectionId: string | null = run.sectionId;
    // One batch: a step's placements, its one line and its section are one undo. A
    // run of `n` steps is `n` undo steps, which is what makes interrupting one safe
    // (ADR-0063 §5).
    workspace.batch("place-run:step", () => {
      next.ids.forEach((id, index) => {
        const box = plan.boxes[index];
        if (box) workspace.placeCard(activeBoardId, id, box);
      });
      if (plan.planned.link && plan.linkFrom) {
        // Ordinary links, leaving and arriving on the sides that face each other: a
        // line from right dot to right dot loops around a card and reads as a
        // mistake rather than a chain.
        const fromDots = workspace.getCard(plan.linkFrom.cardId)?.connectors ?? [];
        const toDots = workspace.getCard(plan.head)?.connectors ?? [];
        const sourceDot = connectorFacing(fromDots, "right");
        const targetDot = connectorFacing(toDots, plan.planned.link.to);
        workspace.addEdge({
          boardId: activeBoardId,
          source: plan.linkFrom.cardId,
          target: plan.head,
          ...(sourceDot ? { sourceConnector: sourceDot.id } : {}),
          ...(targetDot ? { targetConnector: targetDot.id } : {}),
        });
      }
      if (run.wrap) {
        const { sectionPadding } = useUiStore.getState().placementOptions;
        const frame = planRunFrame(
          [...run.placed, ...next.ids].flatMap((id) => {
            const placement = workspace.getPlacement(activeBoardId, id);
            return placement
              ? [
                  {
                    x: placement.x,
                    y: placement.y,
                    width: placement.width ?? DEFAULT_CARD_WIDTH,
                    height: placement.height ?? DEFAULT_CARD_HEIGHT,
                  },
                ]
              : [];
          }),
          sectionPadding,
        );
        if (!sectionId && frame) {
          sectionId = workspace.createSection({
            boardId: activeBoardId,
            title: "",
            ...frame,
          }).id;
        } else if (sectionId && frame) {
          workspace.updateSectionGeometry(sectionId, frame);
        }
      }
    });
    usePlacementRunStore.getState().advance(next, sectionId);
  }, [activeBoardId, canEditLayout, planStep, workspace]);

  const placeAll = useCallback(() => {
    if (!activeBoardId || !canEditLayout) return;
    // The whole remaining queue in one commit: the one case where a run is a single
    // undo step.
    workspace.batch("place-run:all", () => {
      // Bounded by the queue length, so a planner that refused to advance could never
      // spin here.
      const budget = usePlacementRunStore.getState().run?.queue.length ?? 0;
      for (let index = 0; index < budget; index += 1) {
        const before = usePlacementRunStore.getState().run?.queue.length ?? 0;
        step();
        const after = usePlacementRunStore.getState().run?.queue.length ?? 0;
        if (after === before) break;
      }
    });
  }, [activeBoardId, canEditLayout, step, workspace]);

  const stop = useCallback(() => {
    usePlacementRunStore.getState().finish();
  }, []);

  /**
   * Start and carry out a run.
   *
   * A verb over a selection means "place these now", so the queue is walked to the
   * end — one commit per card, which is the undo granularity ADR-0063 chose. The
   * picker loop is the other reading: it enqueues and takes *one* step per pick, so
   * the user chooses each next card from the library.
   */
  const start = useCallback(
    (queue: readonly string[], source: PlacementSource) => {
      if (!canEditLayout || queue.length === 0) return;
      usePlacementRunStore.getState().start(queue, { source });
      // Bounded by the queue itself: a step that could not advance ends the loop
      // rather than spinning.
      for (let index = 0; index < queue.length; index += 1) {
        if (!usePlacementRunStore.getState().run) break;
        step();
      }
    },
    [canEditLayout, step],
  );

  return { step, placeAll, stop, start };
}
