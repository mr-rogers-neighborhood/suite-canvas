import { useReactFlow } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { attachDots, type FacingBox } from "./attachDots";
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
  const mode = useUiStore((state) => state.mode);
  const { screenToFlowPosition } = useReactFlow();
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const move = (event: PointerEvent) => setPointer({ x: event.clientX, y: event.clientY });
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);

  /**
   * A change of mode continues from the card just placed.
   *
   * The anchor is the thing a mode interprets: a thread walks it forward, a fan holds it
   * still. Switching re-interprets the same reader intent, so it resets the anchor to the
   * card they put down last, and the next press links from there.
   */
  const previousLinking = useRef<"thread" | "fan" | null>(mode === "place" ? null : mode);
  useEffect(() => {
    // Cycling from a fan to a thread passes through `place`, and passing through is not a
    // decision: only a change between the two linking modes re-reads the anchor.
    if (mode === "place") return;
    if (previousLinking.current === mode) return;
    previousLinking.current = mode;
    const stack = usePlaceStackStore.getState();
    if (stack.lastPlacedId !== null) stack.setAnchor(stack.lastPlacedId);
  }, [mode]);

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
      const items = resolveSelection(queue, lookup);
      // A card already on this board is not a card to place: pressing must not move
      // what the reader already arranged, so the stack passes over it.
      const item = items.find(
        (entry) =>
          entry.kind === "board" ||
          workspace.getPlacement(activeBoardId, entry.cardId) === undefined,
      );
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
        // One press is one undo step, link and placement together: undoing a placement is
        // what hands the card back to the stack, and a reader who has to press undo twice
        // to get there has already lost the thread of what happened.
        const placed = workspace.batch("place-stack", () => {
          const landed = workspace.placeCard(activeBoardId, item.cardId, box);
          if (landed && mode !== "place") attachPlaced(item.cardId, box);
          return landed;
        });
        if (placed) {
          // Every press moves "the card just placed", whether or not this mode draws a
          // line: switching to a linking mode continues from it either way.
          usePlaceStackStore.getState().setLastPlaced(item.cardId);
          usePlaceStackStore.getState().notePlaced(item.cardId);
        }
      }
      usePlaceStackStore.getState().remove(consumed);
    };
    /**
     * The placement macro: a card dropped with thread or fan chosen gets one link back to
     * its anchor, through the dots that face each other.
     *
     * `thread` anchors on the card placed before this one; `fan` keeps one hub, which is
     * the card the reader had selected when the stack was picked up, or else the first
     * card placed. `place` draws nothing. With nothing to anchor to, the card lands alone
     * and becomes the anchor — which is what a first press should do.
     */
    const attachPlaced = (cardId: string, box: { x: number; y: number }) => {
      const anchorId = usePlaceStackStore.getState().anchorId;
      if (anchorId === null || anchorId === cardId) {
        usePlaceStackStore.getState().setAnchor(cardId);
        return;
      }
      const anchor = workspace.getPlacement(activeBoardId, anchorId);
      const card = workspace.getPlacement(activeBoardId, cardId);
      if (!anchor || !card) return;
      const anchorBox: FacingBox = {
        x: anchor.x,
        y: anchor.y,
        width: anchor.width ?? DEFAULT_CARD_WIDTH,
        height: anchor.height ?? DEFAULT_CARD_HEIGHT,
      };
      const cardBox: FacingBox = {
        x: box.x,
        y: box.y,
        width: card.width ?? DEFAULT_CARD_WIDTH,
        height: card.height ?? DEFAULT_CARD_HEIGHT,
      };
      const dots = attachDots({
        anchorDots: workspace.getCard(anchorId)?.connectors ?? [],
        anchorBox,
        cardDots: workspace.getCard(cardId)?.connectors ?? [],
        cardBox,
      });
      workspace.addEdge({
        boardId: activeBoardId,
        source: anchorId,
        target: cardId,
        ...(dots.source ? { sourceConnector: dots.source.id } : {}),
        ...(dots.target ? { targetConnector: dots.target.id } : {}),
      });
      // The two ends that joined, lit for a moment: the line says they are linked, the
      // highlight says *which dots* were used, which is what a chain makes hard to read.
      usePlaceStackStore
        .getState()
        .flashConnectors([
          ...(dots.source ? [{ nodeId: anchorId, connectorId: dots.source.id }] : []),
          ...(dots.target ? [{ nodeId: cardId, connectorId: dots.target.id }] : []),
        ]);
      // A thread moves its anchor on to the card it just linked; a fan keeps the hub.
      if (mode === "thread") usePlaceStackStore.getState().setAnchor(cardId);
    };

    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, [queue.length, canEditLayout, activeBoardId, workspace, screenToFlowPosition, mode]);

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
