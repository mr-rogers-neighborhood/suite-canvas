import { useSyncExternalStore } from "react";

/**
 * The one link a reader isolated (ADR-0052 §7): everything else on the board
 * recedes so a single route can be worked on.
 *
 * This is UI state, never document data, and it stays out of `useUiStore`
 * because the store is shared with the neighbouring surfaces while a route is
 * not. The `data-isolate-edge` attribute on `<body>` is what lets CSS dim the
 * cards, sections and section links — surfaces this wave does not own — from
 * the one class a link inspector can set.
 */

let isolated: string | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** `null` clears the isolate; the id turns it on for that link only. */
export function setIsolatedEdge(edgeId: string | null): void {
  if (isolated === edgeId) return;
  isolated = edgeId;
  if (typeof document !== "undefined") {
    if (edgeId === null) delete document.body.dataset.isolateEdge;
    else document.body.dataset.isolateEdge = edgeId;
  }
  emit();
}

export function isolatedEdgeId(): string | null {
  return isolated;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function serverSnapshot(): string | null {
  return null;
}

export function useIsolatedEdgeId(): string | null {
  return useSyncExternalStore(subscribe, isolatedEdgeId, serverSnapshot);
}
