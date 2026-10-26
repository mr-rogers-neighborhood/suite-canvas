import type { ReactNode } from "react";

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
 */
export function CardFocusSurface({
  title,
  onClose,
  insetRight = 0,
  children,
}: CardFocusSurfaceProps) {
  return (
    <section
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
