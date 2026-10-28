import { useReactFlow } from "@xyflow/react";
import { useEffect, useState } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "./interactions/multiSelect";
import { usePlaceStackStore } from "./placeStack";

/**
 * The stack in hand, drawn at the pointer, and the press that puts one down.
 *
 * The press is caught in the capture phase on `window` because the board's pane
 * `preventDefault`s its own pointerdown: a handler inside the surface would never see
 * a press on empty canvas. A control keeps its press, so the pill, the dock and a
 * card's own buttons stay clickable while a stack is in hand.
 */
export function PlaceStackCursor() {
  const queue = usePlaceStackStore((state) => state.queue);
  const advance = usePlaceStackStore((state) => state.advance);
  const workspace = useCanvasStore((state) => state.workspace);
  const activeBoardId = useUiStore((state) => state.activeBoardId);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const { screenToFlowPosition } = useReactFlow();
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => setPointer({ x: event.clientX, y: event.clientY });
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);

  useEffect(() => {
    if (queue.length === 0 || !canEditLayout || !activeBoardId) return;
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest('[data-testid="canvas-board"]')) return;
      if (target.closest("button, a, input, textarea, select, [contenteditable='true']")) return;
      const head = usePlaceStackStore.getState().queue[0];
      if (!head) return;
      event.preventDefault();
      event.stopPropagation();
      const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      // Centred on the pointer: "put it here" means the card appears under the hand.
      const box = { x: at.x - DEFAULT_CARD_WIDTH / 2, y: at.y - DEFAULT_CARD_HEIGHT / 2 };
      if (workspace.getBoard(head) !== undefined) {
        // A board is placed the way its row action places it: a portal that opens it.
        workspace.createPortalCard({
          boardId: activeBoardId,
          targetBoardId: head,
          position: box,
        });
      } else {
        workspace.placeCard(activeBoardId, head, box);
      }
      advance();
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [queue.length, canEditLayout, activeBoardId, workspace, screenToFlowPosition, advance]);

  if (queue.length === 0) return null;
  const head = queue[0];
  const title = head ? workspace.displayTitle(head) || "Untitled" : "";

  return (
    <div
      className="held-stack"
      data-testid="held-stack"
      aria-hidden="true"
      style={pointer ? { left: `${pointer.x}px`, top: `${pointer.y}px` } : undefined}
    >
      <span className="held-stack__under held-stack__under--far" />
      <span className="held-stack__under held-stack__under--near" />
      <span className="held-stack__card">
        <span className="held-stack__title">{title}</span>
        <span className="held-stack__count" data-testid="held-stack-count">
          {`${queue.length} left`}
        </span>
      </span>
    </div>
  );
}
