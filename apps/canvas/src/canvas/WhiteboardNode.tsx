import { type NodeProps, NodeResizer, type ResizeParams } from "@xyflow/react";
import { useCallback, useMemo, useRef, useState } from "react";
import { WhiteboardCardFace } from "../cards/WhiteboardCardFace";
import { readSketchDisplay, SKETCH_TYPE_NAME } from "../cards/whiteboard";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useCardTitle } from "../hooks/useCardContainers";
import { useDrawing } from "../hooks/useDrawing";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { DEFAULT_CARD_HEIGHT, DEFAULT_CARD_WIDTH } from "./interactions/multiSelect";
import { NodeConnectors } from "./NodeConnectors";
import type { CardNodeData } from "./nodeData";
import { useNodeConnectorWiring } from "./useNodeConnectorWiring";

/** A sketch card on the canvas: a cheap preview that opens the info drawer on a
 * click and the focus surface on a double click. */
export function WhiteboardNode({ data, selected }: NodeProps) {
  const { card, placement } = data as CardNodeData;
  const workspace = useCanvasStore((state) => state.workspace);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const openCardFocus = useUiStore((state) => state.openCardFocus);
  // A sketch is a card, so a click reads it in the one inspector, exactly as a
  // note does; the focus surface stays behind the double click.
  const openInspector = useUiStore((state) => state.openInspector);
  const title = useCardTitle(card.id);
  const drawing = useDrawing(card.id);
  const display = readSketchDisplay(workspace, card);
  // Presence rides the shared focus channel: a peer with this sketch open is
  // editing it, and the badge says so without syncing any cursor.
  const peers = useBoardPeers(placement.boardId);
  const editors = useMemo(
    () => peers.filter((peer) => peer.focus?.nodeId === card.id).map((peer) => peer.user),
    [peers, card.id],
  );
  // A sketch is a card too: same connector dots, same gestures as a note.
  const connectors = useNodeConnectorWiring(card, placement.boardId);
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null);
  const pointerOrigin = useRef<{ x: number; y: number } | null>(null);

  const handleResize = useCallback((_event: unknown, params: ResizeParams) => {
    setLiveSize({ width: params.width, height: params.height });
  }, []);

  const handleResizeEnd = useCallback(
    (_event: unknown, params: ResizeParams) => {
      workspace.updatePlacementGeometry(placement.boardId, card.id, {
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height,
      });
      setLiveSize(null);
    },
    [workspace, placement.boardId, card.id],
  );

  // The same defaults the link geometry uses, so a sketch without a stored size
  // is measured where it is painted. A different fallback here put every dot
  // half the difference away from where a flow-space link started.
  const width = liveSize?.width ?? placement.width ?? DEFAULT_CARD_WIDTH;
  const height = liveSize?.height ?? placement.height ?? DEFAULT_CARD_HEIGHT;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the sketch is a canvas node; its preview button already handles keyboard open.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the sketch's preview button owns keyboard activation with Enter and Space.
    <div
      className="whiteboard-node"
      data-testid="whiteboard-node"
      data-connector-surface="true"
      style={{ width, height, position: "relative" }}
      onPointerDown={(event) => {
        pointerOrigin.current = { x: event.clientX, y: event.clientY };
      }}
      // A single click opens the sketch's info; React Flow has already selected
      // it, and the pointerdown is left alone so a drag can still start. A drag
      // moves the card and must not also open a panel.
      onClick={(event) => {
        // Multi-select owns modifier clicks; they must not open the drawer.
        if (event.shiftKey || event.metaKey || event.ctrlKey) return;
        const origin = pointerOrigin.current;
        const moved = origin ? Math.hypot(event.clientX - origin.x, event.clientY - origin.y) : 0;
        if (moved > 4) return;
        openInspector(card.id);
      }}
      // Drawing is what a sketch is for, so the second click goes straight to the
      // surface; the first still reads the card, exactly as a note does.
      onDoubleClick={() => openCardFocus(card.id)}
    >
      <NodeResizer
        isVisible={canEditLayout && Boolean(selected)}
        minWidth={200}
        minHeight={150}
        onResize={handleResize}
        onResizeEnd={handleResizeEnd}
        lineStyle={{ borderColor: "var(--ink-muted)", borderWidth: 1 }}
        handleStyle={{ width: 8, height: 8, borderRadius: 2, background: "var(--ink)" }}
      />
      <WhiteboardCardFace
        drawing={drawing}
        label={title || SKETCH_TYPE_NAME}
        display={display}
        editors={editors}
        onOpen={() => openCardFocus(card.id)}
      />
      <NodeConnectors {...connectors} selected={Boolean(selected)} />
    </div>
  );
}
