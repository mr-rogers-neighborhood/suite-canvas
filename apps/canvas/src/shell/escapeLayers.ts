import { useEffect, useRef } from "react";

/**
 * One Escape, one layer.
 *
 * Every surface that opens *over* the canvas — a dialog, the library, the
 * command palette, a context menu — answers Escape, and so does the canvas
 * itself: the board's key chain ends by dropping the selection. Left to their own
 * listeners, one keypress ran both (the canvas listener is on `window` and the
 * overlay's key handler, React or DOM, still lets the event bubble), so closing a
 * dialog also deselected the card behind it.
 *
 * The rule is a stack: the surface opened most recently takes the key, and the
 * canvas only acts when nothing is on the stack. The listener is registered in
 * the capture phase at import time, so it runs before the canvas's own handler
 * and can keep the event from reaching it.
 */
type Dismiss = () => void;

const layers: { dismiss: Dismiss }[] = [];
let listening = false;

/**
 * A text entry clears before it closes.
 *
 * The rule the library already had (`Escape` empties the query, the next one
 * closes) generalised: while the caret is in a field, Escape belongs to that
 * field, whoever owns the layer underneath it. The exception is a modal dialog,
 * because a dialog is the thing Escape is *for* — a field inside one would
 * otherwise trap the reader in it.
 */
function ownsEscape(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const field = target.closest('input, textarea, [contenteditable="true"], .ProseMirror');
  if (!field) return false;
  return field.closest('[role="dialog"]') === null;
}

const dispatch = (event: KeyboardEvent) => {
  if (event.key !== "Escape" || layers.length === 0) return;
  if (ownsEscape(event.target)) return;
  // Claimed: the top layer consumes this keypress and the canvas chain below
  // never sees it. `stopPropagation` in the capture phase stops the bubble-phase
  // listeners, which is where every canvas and component handler lives.
  event.stopPropagation();
  layers[layers.length - 1]?.dismiss();
};

const listen = () => {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("keydown", dispatch, true);
};

/** Adds a layer for as long as the returned function has not been called. */
export function pushEscapeLayer(dismiss: Dismiss): () => void {
  listen();
  const layer = { dismiss };
  layers.push(layer);
  return () => {
    const index = layers.indexOf(layer);
    if (index >= 0) layers.splice(index, 1);
  };
}

/**
 * Registers `dismiss` while `active`. The ref keeps a re-rendered handler from
 * re-registering, which would move a long-open layer above a newer one and invert
 * the order the stack exists to guarantee.
 */
export function useEscapeLayer(dismiss: Dismiss, active = true): void {
  const latest = useRef(dismiss);
  latest.current = dismiss;
  useEffect(() => {
    if (!active) return;
    return pushEscapeLayer(() => latest.current());
  }, [active]);
}

/** How many layers would answer Escape right now. For tests and diagnostics. */
export const escapeLayerCount = () => layers.length;
