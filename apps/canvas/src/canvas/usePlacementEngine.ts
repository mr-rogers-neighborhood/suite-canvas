import { useReactFlow } from "@xyflow/react";
import { useCallback } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "./multiSelect";
import {
  type PlacementSource,
  type ProposedLink,
  type RunStep,
  usePlacementRunStore,
} from "./placementRun";
import {
  type FacingBox,
  inferConnectors,
  planPlacementStep,
  planRunFrame,
  planSetOffsets,
} from "./placeRun";

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
  /**
   * Place the next step at the planner's position — the arrangement reading, and
   * what a held run falls back to when a caller has no pointer.
   */
  step: () => void;
  /**
   * Place the next step **at this point** in flow space: the held reading, where
   * the user is choosing the spot (ADR-0063 third amendment).
   */
  placeAt: (point: { x: number; y: number }) => void;
  /** The card at the top of the stack, or null when nothing is held. */
  held: string | null;
  /**
   * The connectors the *next* placement would use if the card landed here.
   *
   * The same inference the commit runs, given the pointer instead of the planner's
   * position, so the dot the reader sees highlighted is the dot that gets written
   * ([ADR-0061](../../../docs/decisions/0061-three-ways-to-draw-links.md) third amendment).
   * `null` when there is nothing to propose: no run, no link, or no anchor.
   */
  proposeAt: (point: { x: number; y: number }) => ProposedLink | null;
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
      /** Where the user put it down, for a held run. Absent means "plan it". */
      held?: { x: number; y: number } | undefined,
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
      // A held card is centred on the pointer, which is what "put it here" means;
      // an arrangement keeps the planner's top-left.
      const base = held
        ? { x: held.x - size.width / 2, y: held.y - size.height / 2 }
        : planned.position;
      const boxes = step.ids.map((id, index) => {
        const offset = offsets[index] ?? { x: 0, y: 0 };
        const existing = placementOf(id);
        return {
          x: base.x + offset.x,
          y: base.y + offset.y,
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

  const proposeAt = useCallback(
    (point: { x: number; y: number }): ProposedLink | null => {
      const run = usePlacementRunStore.getState().run;
      const next = run?.queue[0];
      if (!run || !next || !activeBoardId) return null;
      const plan = planStep(next, run, point);
      if (!plan?.planned.link || !plan.linkFrom) return null;
      const headBox = plan.boxes[0];
      if (!headBox) return null;
      const anchorBox: FacingBox = {
        x: plan.linkFrom.x,
        y: plan.linkFrom.y,
        width: plan.linkFrom.width ?? DEFAULT_CARD_WIDTH,
        height: plan.linkFrom.height ?? DEFAULT_CARD_HEIGHT,
      };
      const dots = inferConnectors({
        sourceDots: workspace.getCard(plan.linkFrom.cardId)?.connectors ?? [],
        targetDots: workspace.getCard(plan.head)?.connectors ?? [],
        sourceBox: anchorBox,
        targetBox: headBox,
        overrides: {
          source: next.overrides?.source ?? null,
          target: next.overrides?.target ?? null,
        },
      });
      return {
        anchorId: plan.linkFrom.cardId,
        source: dots.source?.id ?? null,
        target: dots.target?.id ?? null,
      };
    },
    [activeBoardId, planStep, workspace],
  );

  const placeStep = useCallback(
    (held?: { x: number; y: number } | undefined) => {
      if (!activeBoardId || !canEditLayout) return;
      const run = usePlacementRunStore.getState().run;
      if (!run) return;
      const next = run.queue[0];
      if (!next) {
        // A picker loop is *waiting*, not finished: it lives until it is stopped.
        if (run.source !== "picker") usePlacementRunStore.getState().finish();
        return;
      }
      const plan = planStep(next, run, held);
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
          // Ordinary links, leaving and arriving on the dots that actually face each
          // other. The sides come from where the cards *landed*, not from the mode, so
          // a fan that spreads upward leaves the top and a thread that continues to the
          // right leaves the right edge without either mode owning a rule.
          const headBox = plan.boxes[0];
          if (headBox) {
            const anchorBox: FacingBox = {
              x: plan.linkFrom.x,
              y: plan.linkFrom.y,
              width: plan.linkFrom.width ?? DEFAULT_CARD_WIDTH,
              height: plan.linkFrom.height ?? DEFAULT_CARD_HEIGHT,
            };
            // One inference, shared with the preview, so what the reader saw while
            // holding the card is what gets written (ADR-0061 third amendment).
            const dots = inferConnectors({
              sourceDots: workspace.getCard(plan.linkFrom.cardId)?.connectors ?? [],
              targetDots: workspace.getCard(plan.head)?.connectors ?? [],
              sourceBox: anchorBox,
              targetBox: headBox,
              overrides: {
                source: next.overrides?.source ?? null,
                target: next.overrides?.target ?? null,
              },
            });
            workspace.addEdge({
              boardId: activeBoardId,
              source: plan.linkFrom.cardId,
              target: plan.head,
              ...(dots.source ? { sourceConnector: dots.source.id } : {}),
              ...(dots.target ? { targetConnector: dots.target.id } : {}),
            });
          }
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
    },
    [activeBoardId, canEditLayout, planStep, workspace],
  );

  const step = useCallback(() => placeStep(), [placeStep]);
  const placeAt = useCallback((point: { x: number; y: number }) => placeStep(point), [placeStep]);

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
   * Start a run, then either arrange it or hold it.
   *
   * **An arrangement is bulk**: `place` computes every position from the planner and
   * lands the set in one commit, because a dump makes no claim about relationships.
   * **Everything else is held**: `thread`, `fan` and `branch` draw relationships, so
   * the cards go into the user's hand as a stack and each click puts one down where
   * they choose (ADR-0063 third amendment).
   */
  const start = useCallback(
    (queue: readonly string[], source: PlacementSource) => {
      if (!canEditLayout || queue.length === 0) return;
      usePlacementRunStore.getState().start(queue, { source });
      const arrangement = useUiStore.getState().mode === "place";
      if (!arrangement) return;
      workspace.batch("place-run:arrange", () => {
        // Bounded by the queue itself: a step that could not advance ends the loop
        // rather than spinning.
        for (let index = 0; index < queue.length; index += 1) {
          const before = usePlacementRunStore.getState().run?.queue.length ?? 0;
          step();
          const after = usePlacementRunStore.getState().run?.queue.length ?? 0;
          if (after === before) break;
        }
      });
    },
    [canEditLayout, step, workspace],
  );

  const held = usePlacementRunStore((state) => state.run?.queue[0]?.ids[0] ?? null);

  return { step, placeAt, placeAll, stop, start, held, proposeAt };
}
