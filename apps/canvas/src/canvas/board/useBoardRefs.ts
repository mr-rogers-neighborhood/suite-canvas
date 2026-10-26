import type { Rect } from "@suite/graph";
import { useEffect, useRef } from "react";
import type { LocalDragEase } from "../localEasing";
import { selectionKeyOf } from "./boardSupport";
import type { useBoardUi } from "./useBoardUi";

type Point = { x: number; y: number };

/**
 * Mutable board state that more than one concern shares — a press that must not
 * re-render, the box React Flow is drawing, the drag the frame loop is easing.
 * It is one bundle so a hook can read another's gesture without the board
 * passing a dozen refs around, and so a ref never gets recreated per hook.
 */
export function useBoardRefs(ui: ReturnType<typeof useBoardUi>, boardOrder: readonly string[]) {
  const { selectedNodeIds } = ui;

  /** Cards this client is dragging; React Flow owns their live positions. */
  const locallyDraggingIds = useRef(new Set<string>());
  /** Cards in the current drag gesture, anchor included; published to peers. */
  const draggedNodeIds = useRef<string[]>([]);
  /** Board cards in paint order; Cmd/Ctrl+A selects exactly these. */
  const boardCardIds = useRef<string[]>([]);
  /** Nodes this client is resizing; React Flow owns their live corner. */
  const locallyResizing = useRef(new Set<string>());
  /** React Flow reports edge-updater drags through onConnectStart too. */
  const reconnectGesture = useRef(false);
  /** True when `onConnect` already created this drag's link, so the drop is done. */
  const connectCommitted = useRef(false);
  const lastPointerSent = useRef(0);
  const lastDragSent = useRef(0);
  const selectedKey = selectionKeyOf(selectedNodeIds);
  /**
   * The selection key `applyBoardNodes` last painted. React Flow mirrors its own
   * selection into the store asynchronously (through `onSelectionChange`), so a
   * rebuild in between — a peer's pointer tick is enough — would paint the
   * previous selection back over a marquee that is still in flight. Only an
   * explicit selection change re-derives `selected`; otherwise React Flow's live
   * value wins.
   */
  const paintedSelection = useRef(selectedKey);
  /**
   * True from pointerdown to pointerup. A press owns React Flow's selection: the
   * store echo of the click *before* it can land mid-gesture, and painting that
   * echo back is what swallowed a modifier click. The flag is a ref — a press
   * must not re-render the board to protect itself.
   */
  const pointerActive = useRef(false);
  /**
   * React Flow owns the selection while a marquee runs. Repainting `selected`
   * from the store mid-gesture makes the pane diff against a stale set and skip
   * re-selecting a card that is still inside the box.
   */
  const marqueeActive = useRef(false);
  /**
   * The section a selection box was started inside. While the box stays within
   * that section's frame only its cards can be boxed: a marquee begun inside a
   * section is about rearranging that section, not the board around it. The
   * scope lifts the moment the box leaves the frame.
   */
  const marqueeScope = useRef<{ sectionId: string } | null>(null);
  /**
   * The box React Flow is drawing, in flow coordinates. React Flow clears its
   * own rectangle on pointerup, so this is the only copy left when the gesture
   * closes — and a link the box crossed is only knowable from the box.
   */
  const marqueeBox = useRef<Rect | null>(null);
  /**
   * Where the current press landed, in flow coordinates. A box is scoped to the
   * section that press was inside; `onSelectionStart` carries no position.
   */
  const marqueePress = useRef<Point | null>(null);
  /**
   * The rendered (eased) positions of this client's drag. React Flow paints the
   * pointer sample; this eases it, so the board does not step on a dropped
   * frame. `null` outside a drag and when reduced motion is requested.
   */
  const localEase = useRef<LocalDragEase | null>(null);
  const localEaseFrame = useRef<number | null>(null);

  // Remote drags are eased toward their latest reported position so motion on a
  // collaborator's screen reads as continuous instead of stepping.
  const peerTargets = useRef(new Map<string, Point>());
  const smoothPositions = useRef(new Map<string, Point>());
  const smoothingFrame = useRef<number | null>(null);
  const lastSmoothingTick = useRef(0);

  /** The board's own root element, which the selection key marks up. */
  const boardRoot = useRef<HTMLDivElement | null>(null);

  /**
   * Section links the user has selected. They are invisible to React Flow (a
   * section is not a node), so they need their own memory to survive the
   * selection reports that arrive for everything else.
   */
  const sectionLinkSelection = useRef<string[]>([]);
  const lastBoxSent = useRef(0);

  useEffect(() => {
    boardCardIds.current = [...boardOrder];
  }, [boardOrder]);

  return {
    locallyDraggingIds,
    draggedNodeIds,
    boardCardIds,
    locallyResizing,
    reconnectGesture,
    connectCommitted,
    lastPointerSent,
    lastDragSent,
    selectedKey,
    paintedSelection,
    pointerActive,
    marqueeActive,
    marqueeScope,
    marqueeBox,
    marqueePress,
    localEase,
    localEaseFrame,
    peerTargets,
    smoothPositions,
    smoothingFrame,
    lastSmoothingTick,
    boardRoot,
    sectionLinkSelection,
    lastBoxSent,
  };
}
