import type { Drawing } from "@suite/graph";
import { useCallback, useMemo } from "react";
import { relayUploader } from "../editor/pasteImages";
import { useDrawing } from "../hooks/useDrawing";
import { useCanvasStore } from "../store/useCanvasStore";
import { type WhiteboardCommit, WhiteboardSurface } from "./WhiteboardSurface";

/** The focus surface for one sketch card. */
export function WhiteboardFocus({
  cardId,
  readOnly = false,
}: {
  cardId: string;
  readOnly?: boolean;
}) {
  const workspace = useCanvasStore((state) => state.workspace);
  const drawing = useDrawing(cardId);
  // One uploader for the surface's life: it is a pure function of the session the
  // tab booted with, and null where a picture has nowhere to go.
  const upload = useMemo(() => relayUploader(), []);

  const commit = useCallback(
    ({ elements, order }: WhiteboardCommit) => {
      try {
        workspace.applyDrawing(cardId, elements, order);
      } catch (error) {
        console.warn("[sketch] could not save scene", error);
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

  return (
    <WhiteboardSurface drawing={effective} readOnly={readOnly} onCommit={commit} upload={upload} />
  );
}
