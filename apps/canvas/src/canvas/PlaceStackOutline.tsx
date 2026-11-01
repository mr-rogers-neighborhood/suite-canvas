import { useCallback, useEffect } from "react";
import { IconGlyph } from "../icons/IconGlyph";
import { useCanvasStore } from "../store/useCanvasStore";
import { ModeButton } from "./links/ModeControl";
import { usePlaceStackStore } from "./placeStack";

/**
 * What is in the reader's hand, and in what order it will go down.
 *
 * A stack is placed one press at a time, in the order it was built, which makes "which of these goes first" a decision
 * the reader can only make *before* the first press and has no way to see. This is that view: the queue in order, with a
 * nudge for each row, a remove, and the two keys that flip it.
 *
 * It reads the store, so it appears for every way a stack can be picked up — the library's **Place cards**, a book's
 * **Place N** — without either of them knowing it exists. Its own presses are safe because `PlaceStackCursor` ignores a
 * press aimed at a control, which is why the pill stays clickable too.
 */
export function PlaceStackOutline() {
  const queue = usePlaceStackStore((state) => state.queue);
  const move = usePlaceStackStore((state) => state.move);
  const rotate = usePlaceStackStore((state) => state.rotate);
  const remove = usePlaceStackStore((state) => state.remove);
  const stop = usePlaceStackStore((state) => state.stop);
  const workspace = useCanvasStore((state) => state.workspace);

  /**
   * `[` and `]` flip the stack.
   *
   * Bound here rather than on the board because this panel only exists while a stack is in hand, which is exactly the
   * window the keys belong to. A press inside a field is not a flip: the reader is typing, not choosing an order.
   */
  const onKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "[" && event.key !== "]") return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, select, [contenteditable="true"]') !== null
      ) {
        return;
      }
      event.preventDefault();
      rotate(event.key === "]" ? "forward" : "back");
    },
    [rotate],
  );

  useEffect(() => {
    if (queue.length < 2) return;
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queue.length, onKey]);

  if (queue.length === 0 || workspace === null) return null;

  return (
    // A named region, not a control: the rows inside it are the controls.
    <section
      className="place-outline"
      data-testid="place-outline"
      aria-label="The stack in your hand"
    >
      <header className="place-outline-head">
        <span className="place-outline-title">{queue.length} to place, in this order</span>
        <button
          type="button"
          className="views-icon-button"
          aria-label="Put the stack down"
          title="Stop placing"
          data-testid="place-outline-stop"
          onClick={stop}
        >
          <IconGlyph icon="lucide:x" size={12} />
        </button>
      </header>
      {/* The same control the canvas pill draws, from the same store: what a press attaches to is a decision this
          gesture needs, and it used to live under a panel that covered it. */}
      <div className="place-outline-mode">
        <span className="place-outline-mode-label">Links</span>
        <ModeButton testId="place-outline-mode" className="place-outline-mode-button" />
      </div>
      <ol className="place-outline-rows">
        {queue.map((cardId, index) => {
          return (
            <li
              key={cardId}
              className="place-outline-row"
              data-first={index === 0 ? "true" : undefined}
            >
              <span className="place-outline-index">{index + 1}</span>
              <span className="place-outline-name" title={workspace.displayTitle(cardId)}>
                {workspace.displayTitle(cardId)}
              </span>
              <span className="place-outline-actions">
                <button
                  type="button"
                  className="views-icon-button"
                  aria-label="Move this card earlier"
                  title="Earlier"
                  data-testid={`place-outline-up-${cardId}`}
                  disabled={index === 0}
                  onClick={() => move(cardId, index - 1)}
                >
                  <IconGlyph icon="lucide:arrow-up" size={11} />
                </button>
                <button
                  type="button"
                  className="views-icon-button"
                  aria-label="Move this card later"
                  title="Later"
                  data-testid={`place-outline-down-${cardId}`}
                  disabled={index === queue.length - 1}
                  onClick={() => move(cardId, index + 1)}
                >
                  <IconGlyph icon="lucide:arrow-down" size={11} />
                </button>
                <button
                  type="button"
                  className="views-icon-button"
                  aria-label="Take this card out of the hand"
                  title="Leave it in the inbox"
                  data-testid={`place-outline-remove-${cardId}`}
                  onClick={() => remove([cardId])}
                >
                  <IconGlyph icon="lucide:x" size={11} />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="place-outline-hint">
        Press the board to put one down. <kbd>[</kbd> and <kbd>]</kbd> flip the order.
      </p>
    </section>
  );
}
