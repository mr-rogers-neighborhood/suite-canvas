import { type ReactNode, useEffect, useRef } from "react";
import { useFocusTrap } from "../dialogs/useFocusTrap";

export interface CardFocusSurfaceProps {
  title: string;
  /** Back button and Escape: leaves focus mode and restores the board viewport. */
  onClose: () => void;
  /**
   * Room kept free on the right while the inspector is open, so the drawer stays
   * clickable and the app chrome is never covered.
   */
  insetRight?: number;
  children: ReactNode;
}

/**
 * The full-canvas card surface. It expands over the app's canvas area — not the
 * browser window — so the title bar, board tabs and dock keep working. The card
 * inside is the same `CardPanel` the inspector renders.
 *
 * It reads as a modal because it is one for the board: the card lies over the
 * canvas and the chrome stays live. `role="dialog"` says so, `useFocusTrap` keeps
 * Tab in the sheet, and a sketch takes the initial focus because a drawing
 * surface only answers keys while it holds them.
 */
export function CardFocusSurface({
  title,
  onClose,
  insetRight = 0,
  children,
}: CardFocusSurfaceProps) {
  const panel = useRef<HTMLElement | null>(null);

  useFocusTrap(panel);

  // A sketch draws with the keyboard as well as the pointer, and its surface
  // answers only while it has focus. Its container is the drawing, not a
  // control, so it is made focusable here rather than in the card's own render.
  useEffect(() => {
    const sketch = panel.current?.querySelector<HTMLElement>('[data-testid="sketch-focus"]');
    if (!sketch) return;
    const target = sketch.querySelector<HTMLElement>("[tabindex]:not([tabindex='-1'])") ?? sketch;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus();
  }, []);

  return (
    <section
      ref={panel}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      className="card-focus"
      data-testid="card-focus"
      aria-label={`Focused card: ${title || "Untitled"}`}
      style={insetRight > 0 ? { paddingRight: insetRight } : undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="card-focus__sheet">
        <header className="card-focus__header">
          <button
            type="button"
            data-testid="card-focus-back"
            aria-label="Back to board"
            className="card-focus__button"
            onClick={onClose}
          >
            <span aria-hidden="true">{"\u2039"}</span>
            <span>Board</span>
          </button>
          <span className="card-focus__title" title={title}>
            {title || "Untitled"}
          </span>
          <button
            type="button"
            data-testid="card-focus-close"
            aria-label="Close card"
            className="card-focus__button"
            onClick={onClose}
          >
            {"\u00d7"}
          </button>
        </header>
        <div className="card-focus__body">{children}</div>
      </div>
    </section>
  );
}
