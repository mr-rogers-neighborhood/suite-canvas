import type { Drawing, WorkspaceDocument } from "@suite/graph";
import { useEffect, useState } from "react";
import { useCanvasStore } from "../store/useCanvasStore";

/**
 * Drawings are not part of the snapshot projection yet, so the card face and
 * focus surface subscribe to the document directly. The doc callback is the
 * only invalidation: a drawing write commits once and re-renders once.
 */
export function useDrawing(
  cardId: string | null,
  workspaceOverride?: WorkspaceDocument,
): Drawing | null {
  const storeWorkspace = useCanvasStore((state) => state.workspace);
  const workspace = workspaceOverride ?? storeWorkspace;
  const [held, setHeld] = useState<{ cardId: string | null; drawing: Drawing | null }>(() => ({
    cardId,
    drawing: cardId ? workspace.drawing(cardId) : null,
  }));

  useEffect(() => {
    const read = () => setHeld({ cardId, drawing: cardId ? workspace.drawing(cardId) : null });
    read();
    if (!cardId) return;
    return workspace.doc.subscribe(read);
  }, [cardId, workspace]);

  // A card switch renders before the effect re-reads, so deriving here keeps the
  // previous card's strokes off the new card for one frame.
  if (held.cardId !== cardId) return cardId ? workspace.drawing(cardId) : null;
  return held.drawing;
}
