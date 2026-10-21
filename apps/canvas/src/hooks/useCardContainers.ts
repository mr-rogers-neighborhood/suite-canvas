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

/** Live display title, including the body-first-line fallback. */
export function useCardTitle(cardId: string): string {
  const workspace = useCanvasStore((state) => state.workspace);
  const subscribe = useCallback(
    (listener: () => void) => (cardId ? workspace.observeTitle(cardId, listener) : () => undefined),
    [workspace, cardId],
  );
  const get = useCallback(
    () => (cardId ? workspace.displayTitle(cardId) : ""),
    [workspace, cardId],
  );
  return useSyncExternalStore(subscribe, get, get);
}
