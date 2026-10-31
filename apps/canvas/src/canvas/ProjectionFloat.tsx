import { resolveContext } from "@suite/graph";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconGlyph } from "../icons/IconGlyph";
import { DEFAULT_CORNER, PROJECTION_KEY, useProjectionStore } from "../store/projectionStore";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { useViewsStore } from "../store/viewsStore";
import { useWorkspaceSnapshot } from "../store/workspaceStore";
import { Chip } from "../views/chip";
import { useFloatGesture } from "./floatGesture";
import { planFloats } from "./floatPlan";
import { shellBounds, shellObstacles } from "./shellObstacles";
import { useCanvasLens } from "./useCanvasLens";

/**
 * What is projected, and how to leave it.
 *
 * A projection is this reader's, so the float offers *this* reader's two ways out: stop projecting, or open
 * the layer on the same view and change it. It is also the only place a multi-board context explains
 * itself: the chips are the boards the context touches, and the inbox count says how much of it has no
 * position to outline.
 *
 * It floats rather than sitting in a bar because it is not chrome the app owns — it is a sticky note in the
 * corner of the reader's board. It drags like a pin and the handbook bubble do, remembers its corner, and
 * settles around the dock rather than under it.
 *
 * Picking happens here too. Building a context *is* projecting it for a moment: the cards light up as they
 * are added, and one bar says what is being built and how to stop.
 */
export function ProjectionFloat() {
  const lens = useCanvasLens();
  const workspace = useCanvasStore((state) => state.workspace);
  const snapshot = useWorkspaceSnapshot();
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const activateBoard = useUiStore((state) => state.activateBoard);
  const stop = useProjectionStore((state) => state.stop);
  const setToggles = useProjectionStore((state) => state.setToggles);
  const corner = useProjectionStore((state) => state.corners[PROJECTION_KEY] ?? DEFAULT_CORNER);
  const setCorner = useProjectionStore((state) => state.setCorner);
  const openLayer = useViewsStore((state) => state.openLayer);
  const picking = useViewsStore((state) => state.picking);
  const pickDraft = useViewsStore((state) => state.draft);
  const endPicking = useViewsStore((state) => state.endPicking);
  const cancelPicking = useViewsStore((state) => state.cancelPicking);
  const setDraft = useViewsStore((state) => state.setDraft);

  const view = lens.view;
  const ref = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [at, setAt] = useState(corner);

  // A remembered corner is a hint, not a promise: a window that shrank since last time would otherwise
  // leave the float off screen.
  useEffect(() => {
    setAt({
      x: Math.max(8, Math.min(corner.x, window.innerWidth - 120)),
      y: Math.max(8, Math.min(corner.y, window.innerHeight - 60)),
    });
  }, [corner]);

  const settle = () => {
    setDragging(false);
    const element = ref.current;
    if (element === null) return;
    const rect = element.getBoundingClientRect();
    const plan = planFloats({
      moving: [
        {
          id: "projection-float",
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
        },
      ],
      obstacles: shellObstacles(element),
      bounds: shellBounds(),
    });
    const placed = plan.rects[0];
    if (placed === undefined) return;
    setAt({ x: placed.x, y: placed.y });
    setCorner({ x: placed.x, y: placed.y });
  };

  const gesture = useFloatGesture({
    onMove: (_id, rect) => {
      setDragging(true);
      setAt({ x: rect.x, y: rect.y });
    },
    onEnd: settle,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: the snapshot is the invalidation signal.
  const context = useMemo(() => {
    if (workspace === null || view === null) return null;
    return resolveContext(workspace, view, { boardId: activeBoardId });
  }, [workspace, view, activeBoardId, snapshot]);

  if (view === null || context === null) return null;

  const here = activeBoardId === null ? 0 : (context.byBoard.get(activeBoardId) ?? 0);
  const pinned = view.context?.cardIds.length ?? pickDraft?.cardIds.length ?? 0;

  const finishPick = () => {
    endPicking();
    openLayer(view.id);
  };

  const cancelPick = () => {
    const base = cancelPicking();
    if (workspace !== null) {
      workspace.clearViewPins(view.id);
      for (const cardId of base ?? []) workspace.addViewPin(view.id, cardId);
    } else if (pickDraft !== null) {
      setDraft({ cardIds: [...(base ?? [])] });
    }
    openLayer(view.id);
  };

  return (
    <div
      ref={ref}
      data-testid="projection-float"
      data-handbook-region="views-projection-float"
      data-picking={picking ? "true" : undefined}
      data-dragging={dragging ? "true" : undefined}
      className="views-float"
      style={{ left: at.x, top: at.y }}
    >
      <button
        type="button"
        className="views-float-handle"
        aria-label={`Move ${view.name}`}
        title="Drag to move"
        onPointerDown={(event) =>
          gesture.start(event, {
            id: "projection-float",
            rect: {
              x: at.x,
              y: at.y,
              width: ref.current?.getBoundingClientRect().width ?? 240,
              height: ref.current?.getBoundingClientRect().height ?? 36,
            },
            mode: "move",
          })
        }
      >
        <IconGlyph icon="lucide:grip-vertical" size={12} />
        <span className="views-float-name" data-testid="projection-float-name">
          {view.name}
        </span>
      </button>

      {picking ? (
        <>
          <span className="views-tertiary" data-testid="projection-float-picking">
            Picking · press cards on the board · {pinned} pinned
          </span>
          <Chip action testId="views-picking-done" onClick={finishPick}>
            Done
          </Chip>
          <Chip action testId="views-picking-cancel" onClick={cancelPick}>
            Cancel
          </Chip>
        </>
      ) : (
        <>
          <span className="views-tertiary tabular-nums">
            {here} here · {context.cardIds.length} of the view
          </span>
          {[...context.byBoard.entries()].map(([boardId, count]) => {
            const board = snapshot.boards.find((entry) => entry.id === boardId);
            if (board === undefined) return null;
            return (
              <Chip
                key={boardId}
                pressed={boardId === activeBoardId}
                count={count}
                testId={`projection-float-board-${boardId}`}
                title={`Go to ${board.name}`}
                onClick={() => activateBoard(boardId)}
              >
                {board.name}
              </Chip>
            );
          })}
          {context.inInbox.length > 0 ? (
            <span
              data-testid="projection-float-inbox"
              title="These cards are in the inbox: they are in the view, but a board has no place to show them."
              className="views-tertiary"
            >
              {context.inInbox.length} in the inbox
            </span>
          ) : null}
          <Chip
            pressed={lens.outline}
            testId="projection-float-outline"
            title="Outline the cards this view selects"
            onClick={() => setToggles({ outline: !lens.outline })}
          >
            Outline
          </Chip>
          <Chip
            pressed={lens.fade}
            testId="projection-float-fade"
            title="Fade everything this view does not select"
            onClick={() => setToggles({ fade: !lens.fade })}
          >
            Fade
          </Chip>
          <Chip
            action
            testId="projection-float-open"
            title="Open the layer on this view"
            onClick={() => openLayer(view.id)}
          >
            <IconGlyph icon="lucide:table" size={11} />
            Open
          </Chip>
          <button
            type="button"
            aria-label="Stop projecting"
            data-testid="projection-float-stop"
            className="views-icon-button"
            onClick={stop}
          >
            <IconGlyph icon="lucide:x" size={13} />
          </button>
        </>
      )}
    </div>
  );
}
