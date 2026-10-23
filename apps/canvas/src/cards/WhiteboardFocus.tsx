import type { Drawing } from "@suite/graph";
import { useCallback } from "react";
import { useDrawing } from "../hooks/useDrawing";
import { useCanvasStore } from "../store/useCanvasStore";
import { type WhiteboardCommit, WhiteboardSurface } from "./WhiteboardSurface";

/** The focus surface for one whiteboard card. */
export function WhiteboardFocus({
  cardId,
  readOnly = false,
}: {
  cardId: string;
  readOnly?: boolean;
}) {
  const workspace = useCanvasStore((state) => state.workspace);
  const drawing = useDrawing(cardId);

  const commit = useCallback(
    ({ elements, order }: WhiteboardCommit) => {
      try {
        // Whole-scene replacement is one commit; the element-level path lands
        // with the batch drawing API.
        workspace.setDrawing(cardId, elements, order);
      } catch (error) {
        console.warn("[whiteboard] could not save scene", error);
      }
    },
    [workspace, cardId],
  );

  const effective: Drawing = drawing ?? {
    cardId,
    elements: [],
    order: [],
    version: 1,
    updatedAt: 0,
  };

  return <WhiteboardSurface drawing={effective} readOnly={readOnly} onCommit={commit} />;
}
