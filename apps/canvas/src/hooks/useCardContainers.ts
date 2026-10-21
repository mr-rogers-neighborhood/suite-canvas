import type { CardContainers } from "@suite/graph";
import { useCallback, useSyncExternalStore } from "react";
import { useCanvasStore } from "../store/useCanvasStore";

/**
 * Text container ids for one card. Separate from the workspace snapshot so a
 * peer creating a body does not re-render every card on the board.
 */
export function useCardContainers(cardId: string): CardContainers {
  const workspace = useCanvasStore((state) => state.workspace);
  const subscribe = useCallback(
    (listener: () => void) => workspace.observeContainers(cardId, listener),
    [workspace, cardId],
  );
  const get = useCallback(() => workspace.cardContainers(cardId), [workspace, cardId]);
  return useSyncExternalStore(subscribe, get, get);
}
