import type { Annotation, AnnotationStyle } from "@suite/graph";
import { partText } from "@suite/graph";
import { IconGlyph } from "../icons/IconGlyph";

/**
 * The marks a reader has made in this book, in the order they were made.
 *
 * This is where a highlight lives when it has not been placed: the book is the thing it came out of, so the book is
 * where a reader looks for the ones they have not decided about yet. Pressing one raises it, which is where it can be
 * taken apart and placed; a highlight that became a card says so, so "what have I already used" is answerable at a
 * glance rather than by remembering.
 */
export interface BookHighlightsProps {
  annotations: readonly Annotation[];
  styles: readonly AnnotationStyle[];
  onOpen: (annotationId: string) => void;
  /** A press that travels picks the highlight up, and the board's drop layer decides where it lands. */
  onCarry: (annotationId: string, point: { x: number; y: number }) => void;
}

export function BookHighlights({ annotations, styles, onOpen, onCarry }: BookHighlightsProps) {
  if (annotations.length === 0) {
    return (
      <p className="reader-note" data-testid="book-highlights-empty">
        <IconGlyph icon="lucide:highlighter" size={13} />
        Select a sentence and pick a colour. Your highlights collect here.
      </p>
    );
  }

  const placed = annotations.filter((annotation) => annotation.cardId !== undefined).length;

  return (
    <div className="reader-marks" data-testid="book-highlights">
      <p className="reader-marks-count">
        {annotations.length} {annotations.length === 1 ? "highlight" : "highlights"} · {placed} on
        the board
      </p>
      <ul className="reader-marks-rows">
        {annotations.map((annotation) => {
          const style = styles.find((entry) => entry.id === annotation.styleId);
          return (
            <li key={annotation.id}>
              <button
                type="button"
                className="reader-mark"
                data-testid={`book-highlight-${annotation.id}`}
                onPointerDown={(event) => {
                  // Travel makes it a drag, exactly as a painted mark and a library row behave: one gesture means one
                  // thing wherever a highlight is shown.
                  const start = { x: event.clientX, y: event.clientY };
                  const move = (moving: PointerEvent) => {
                    if (Math.hypot(moving.clientX - start.x, moving.clientY - start.y) < 4) return;
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", stop);
                    onCarry(annotation.id, { x: moving.clientX, y: moving.clientY });
                  };
                  const stop = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", stop);
                  };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", stop);
                }}
                onClick={() => onOpen(annotation.id)}
              >
                <span
                  aria-hidden="true"
                  className="reader-mark-dot"
                  style={{ background: style?.color ?? "var(--accent)" }}
                />
                <span className="reader-mark-text">{wordsOf(annotation)}</span>
                {annotation.cardId === undefined ? null : (
                  <span className="reader-mark-placed" title="This highlight is a card">
                    <IconGlyph icon="lucide:check" size={11} />
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What a highlight says: its excerpt, or the parts it was broken into when those are all it has. */
function wordsOf(annotation: Annotation): string {
  if (annotation.excerpt !== undefined && annotation.excerpt.length > 0) return annotation.excerpt;
  if (annotation.anchor.kind !== "quote") return "A passage";
  const parts = annotation.parts ?? [];
  if (parts.length === 0) return annotation.anchor.quote;
  return parts
    .map((part) => partText(annotation, part))
    .filter((text): text is string => text !== null)
    .join(" · ");
}
