import { useReactFlow } from "@xyflow/react";
import { useEffect } from "react";
import { useHighlightDrag } from "../reader/highlightDrag";
import { promoteAnnotation } from "../reader/promote";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "./interactions/multiSelect";

/**
 * Where a carried highlight lands.
 *
 * The drop is the promotion: a release over the board makes the card at that point, and a release anywhere else
 * puts the highlight back. Nothing is created before that, so a drag the reader changed their mind about leaves
 * nothing behind.
 *
 * This lives inside the board's React Flow provider because a screen point only becomes a flow point there, and it
 * is the same conversion `placeCard` uses — so a highlight lands where a card lands.
 */
export function HighlightDropLayer() {
  const carried = useHighlightDrag((state) => state.carried);
  const screen = useHighlightDrag((state) => state.screen);
  const { screenToFlowPosition } = useReactFlow();
  const workspace = useCanvasStore((state) => state.workspace);

  useEffect(() => {
    if (carried === null) return;
    const up = (event: PointerEvent) => {
      // The carry always ends here, whether or not the release lands on the board. A carry that outlives its own
      // gesture is worse than a cancelled drag: the reader is stuck holding something they cannot put down, and the
      // surface stays out of the way.
      useHighlightDrag.getState().release();
      const boardId = useUiStore.getState().activeBoardId;
      if (workspace === null || boardId === null) return;
      const under = document.elementFromPoint(event.clientX, event.clientY);
      const overCanvas = under?.closest(
        '[data-testid="canvas-board"], .react-flow, .react-flow__pane, [data-board-id]',
      );
      if (overCanvas === null || overCanvas === undefined) return;
      const annotation = workspace.getAnnotation(carried.annotationId);
      if (annotation === undefined) return;
      const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      promoteAnnotation({
        workspace,
        annotation,
        boardId,
        position: {
          x: flow.x - DEFAULT_CARD_WIDTH / 2,
          y: flow.y - DEFAULT_CARD_HEIGHT / 2,
        },
      });
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [carried, workspace, screenToFlowPosition]);

  if (carried === null || screen === null) return null;

  // A ghost, so the reader can see what is in their hand and where it will land.
  return (
    <div
      className="highlight-ghost"
      data-testid="highlight-ghost"
      style={{ left: screen.x, top: screen.y }}
      aria-hidden="true"
    />
  );
}
