import type { CardContainers, CardPresence } from "@suite/graph";
import { useCallback, useSyncExternalStore } from "react";
import { useCanvasStore } from "../store/useCanvasStore";
import { useCard } from "../store/workspaceStore";

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

/**
 * How this workspace knows a card: its record is here (`card`), only a
 * projection's title stub is (`stub`, so the reference is real but unshared), or
 * nothing at all is (`missing`, as after a delete). The title observer is the
 * same one `useCardTitle` uses, so a rebuild that drops a stub re-renders.
 */
export function useCardPresence(cardId: string): CardPresence {
  const workspace = useCanvasStore((state) => state.workspace);
  const card = useCard(cardId);
  const subscribe = useCallback(
    (listener: () => void) => (cardId ? workspace.observeTitle(cardId, listener) : () => undefined),
    [workspace, cardId],
  );
  const get = useCallback(() => (cardId ? workspace.hasTitle(cardId) : false), [workspace, cardId]);
  const titled = useSyncExternalStore(subscribe, get, get);

  if (card) return "card";
  return titled ? "stub" : "missing";
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
