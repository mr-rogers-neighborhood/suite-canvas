import { type NodeProps, NodeResizer, type ResizeParams } from "@xyflow/react";
import { useCallback, useState } from "react";
import { WhiteboardCardFace } from "../cards/WhiteboardCardFace";
import { useCardTitle } from "../hooks/useCardContainers";
import { useDrawing } from "../hooks/useDrawing";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { NodeConnectors } from "./NodeConnectors";
import type { CardNodeData } from "./nodeData";
import { useNodeConnectorWiring } from "./useNodeConnectorWiring";

/** A whiteboard card on the canvas: a cheap preview that opens the focus surface. */
export function WhiteboardNode({ data, selected }: NodeProps) {
  const { card, placement } = data as CardNodeData;
  const workspace = useCanvasStore((state) => state.workspace);
  const canEditLayout = useUiStore((state) => state.canEditLayout);
  const openCardFocus = useUiStore((state) => state.openCardFocus);
  const title = useCardTitle(card.id);
  const drawing = useDrawing(card.id);
  // A sketch is a card too: same connector dots, same gestures as a note.
  const connectors = useNodeConnectorWiring(card, placement.boardId);
  const [liveSize, setLiveSize] = useState<{ width: number; height: number } | null>(null);

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

  const width = liveSize?.width ?? placement.width ?? 320;
  const height = liveSize?.height ?? placement.height ?? 240;

  return (
    <div
      className="whiteboard-node"
      data-testid="whiteboard-node"
      data-connector-surface="true"
      style={{ width, height, position: "relative" }}
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
        label={title || "Whiteboard"}
        onOpen={() => openCardFocus(card.id)}
      />
      <NodeConnectors {...connectors} selected={Boolean(selected)} />
    </div>
  );
}
