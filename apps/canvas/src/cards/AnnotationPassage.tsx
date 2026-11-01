import type { Annotation, AnnotationStyle } from "@suite/graph";

/**
 * A highlight's words, wherever they are shown.
 *
 * The passage is one thing with one reading, so it is one component: the spine in the kind's colour, the words in full,
 * and underneath them the kind and the book. The card's header draws it, and a body's `Highlight` property block draws
 * the same thing, which is the point — a reader who wants the quotation in the middle of their template gets the
 * passage and not a summary of it, and a reader who does not gets it above the body.
 *
 * **Full, never clamped.** A two-line clamp was what forced the card to be a fixed box with the quotation cropped; a
 * highlight is usually one sentence, and the sentence is the reason the card exists.
 *
 * Pure: it takes the record and the palette, and renders nothing it was not given.
 */
export interface AnnotationPassageProps {
  annotation: Annotation;
  /** The kind, so the spine and the name carry its colour and its word. */
  style: AnnotationStyle | undefined;
  /** The book's own title, already resolved by the caller (which knows about "Untitled"). */
  sourceName: string;
  /** The book's button, when the surface can navigate; the block in a body cannot. */
  onOpenSource?: ((event: { stopPropagation: () => void }) => void) | undefined;
  /** `inline` reads as part of a body's sentence; `block` is the card's own header. */
  variant?: "block" | "inline";
}

/** What a highlight says, in its own words. */
export function passageTextOf(annotation: Annotation): string {
  if (annotation.excerpt !== undefined && annotation.excerpt.length > 0) return annotation.excerpt;
  return annotation.anchor.kind === "quote" ? annotation.anchor.quote : "";
}

export function AnnotationPassage({
  annotation,
  style,
  sourceName,
  onOpenSource,
  variant = "block",
}: AnnotationPassageProps) {
  const words = passageTextOf(annotation);
  const kindName = style?.name ?? "Highlight";

  return (
    <span
      className="annotation-passage"
      data-testid="annotation-passage"
      data-variant={variant}
      style={{ borderColor: style?.color ?? "var(--accent)" }}
    >
      <span
        aria-hidden="true"
        className="annotation-passage-spine"
        style={{ background: style?.color ?? "var(--accent)" }}
      />
      <span className="annotation-passage-text">
        <span className="annotation-passage-words" data-testid="annotation-passage-words">
          {words}
        </span>
        {annotation.note === undefined ? null : (
          <span className="annotation-passage-note" data-testid="annotation-passage-note">
            {annotation.note}
          </span>
        )}
        <span className="annotation-passage-where">
          <span>{kindName} from</span>
          {onOpenSource === undefined ? (
            <span className="annotation-passage-source">{sourceName}</span>
          ) : (
            <button
              type="button"
              className="annotation-passage-source annotation-passage-link nodrag nopan"
              data-testid="annotation-strip-source"
              title={`Open ${sourceName}`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenSource(event);
              }}
            >
              {sourceName}
            </button>
          )}
        </span>
      </span>
    </span>
  );
}
