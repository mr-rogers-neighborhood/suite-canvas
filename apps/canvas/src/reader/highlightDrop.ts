import { useEffect } from "react";

/**
 * The one place a carried highlight can be put down.
 *
 * The board registers the dropper because the board is the only thing that knows a screen point as a flow point.
 * Everything that can carry a highlight then ends its gesture in the same way: the release asks the dropper, and the
 * dropper decides whether the pointer was over the board. Before this, the reader's own `pointerup` and the drop
 * layer's `pointerup` both fired and the result depended on which listener was registered first — a race that showed
 * up as a highlight that simply evaporated.
 */
export type HighlightDropper = (annotationId: string, at: { x: number; y: number }) => void;

let dropper: HighlightDropper | null = null;

export function registerHighlightDropper(next: HighlightDropper): () => void {
  dropper = next;
  return () => {
    if (dropper === next) dropper = null;
  };
}

/** Offer a carried highlight to the board. A release anywhere else drops it, which is what cancelling looks like. */
export function dropHighlight(annotationId: string, at: { x: number; y: number }): void {
  dropper?.(annotationId, at);
}

/** An effect that keeps `drop` registered for as long as the calling component is mounted. */
export function useHighlightDropper(drop: HighlightDropper): void {
  useEffect(() => registerHighlightDropper(drop), [drop]);
}
