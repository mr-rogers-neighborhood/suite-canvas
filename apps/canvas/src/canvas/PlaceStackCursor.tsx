import { useReactFlow } from "@xyflow/react";
import { useEffect, useState } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "./interactions/multiSelect";
import { placementLookup, resolveSelection } from "./placeSelection";
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
      // A control keeps its own press, so the pill, the dock and a card's buttons stay
      // clickable while a stack is in hand. The section frame is the exception: its hit
      // area is a whole section, which is the canvas, drawn as a button so it can be
      // focused. Without that, every press aimed inside a section placed nothing.
      const control = target.closest(
        "button, a, input, textarea, select, [contenteditable='true']",
      );
      if (control && !control.classList.contains("section-region")) return;
      event.preventDefault();
      event.stopPropagation();
      const queue = usePlaceStackStore.getState().queue;
      const lookup = placementLookup(workspace);
      const item = resolveSelection(queue, lookup)[0];
      if (item === undefined) return;
      const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      // Centred on the pointer: "put it here" means the card appears under the hand.
      const box = { x: at.x - DEFAULT_CARD_WIDTH / 2, y: at.y - DEFAULT_CARD_HEIGHT / 2 };
      // One press retires everything that press consumed: a board row and its portal
      // card are one decision, so neither may come back for a second press.
      const opened = item.kind === "board" ? item.boardId : lookup.opens(item.cardId);
      const consumed = [
        item.kind === "card" ? item.cardId : item.boardId,
        // The board a card opens, and every other portal of it, is the same decision:
        // it must not come back for a second press. Only when there *is* a board, or
        // every plain card would match the absent one.
        ...(opened === undefined
          ? []
          : queue.filter((id) => id === opened || lookup.opens(id) === opened)),
      ];
      if (item.kind === "board") {
        const existing = lookup.portalFor(item.boardId);
        if (existing === undefined) {
          workspace.createPortalCard({
            boardId: activeBoardId,
            targetBoardId: item.boardId,
            position: box,
          });
        } else {
          workspace.placeCard(activeBoardId, existing, box);
          consumed.push(existing);
        }
      } else {
        workspace.placeCard(activeBoardId, item.cardId, box);
      }
      usePlaceStackStore.getState().remove(consumed);
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [queue.length, canEditLayout, activeBoardId, workspace, screenToFlowPosition]);

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
