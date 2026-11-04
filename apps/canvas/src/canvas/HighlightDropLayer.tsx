import { useReactFlow } from "@xyflow/react";
import { useCallback } from "react";
import { useHighlightDrag } from "../reader/highlightDrag";
import { useHighlightDropper } from "../reader/highlightDrop";
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
 * is the same conversion `placeCard` uses — so a highlight lands where a card lands. It registers the one dropper
 * rather than listening for the release itself: every surface that carries a highlight ends its gesture through
 * `dropHighlight`, so there is one release and one decision instead of two listeners racing.
 */
export function HighlightDropLayer() {
  const carried = useHighlightDrag((state) => state.carried);
  const screen = useHighlightDrag((state) => state.screen);
  const { screenToFlowPosition } = useReactFlow();
  const workspace = useCanvasStore((state) => state.workspace);

  const drop = useCallback(
    (annotationId: string, at: { x: number; y: number }) => {
      const boardId = useUiStore.getState().activeBoardId;
      if (workspace === null || boardId === null) return;
      const under = document.elementFromPoint(at.x, at.y);
      // A release inside the reader itself puts the highlight back; dragging it out onto the
      // canvas board is what promotes and places the card.
      const insideReader = under?.closest(".book-canvas-reader, .book-focus, .reader");
      if (insideReader !== null && insideReader !== undefined) return;
      const overCanvas = under?.closest(
        '[data-testid="canvas-board"], .react-flow, .react-flow__pane, [data-board-id]',
      );
      if (overCanvas === null || overCanvas === undefined) return;
      const annotation = workspace.getAnnotation(annotationId);
      if (annotation === undefined) return;
      const flow = screenToFlowPosition({ x: at.x, y: at.y });
      promoteAnnotation({
        workspace,
        annotation,
        placement: {
          onBoard: {
            boardId,
            position: { x: flow.x - DEFAULT_CARD_WIDTH / 2, y: flow.y - DEFAULT_CARD_HEIGHT / 2 },
          },
        },
      });
    },
    [workspace, screenToFlowPosition],
  );
  useHighlightDropper(drop);

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
