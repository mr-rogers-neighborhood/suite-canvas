import {
  type AnnotationRead,
  annotationExcerpt,
  resolveAnnotationIn,
} from "../canvas/annotations/annotationRecord";
import { messageFor } from "../i18n";

export interface AnnotationReaderProps {
  /** What the card carries, as `readAnnotation` read it. */
  read: AnnotationRead;
  /** The source's plain text and title, or null when the source is gone. */
  source: { title: string; text: string } | null;
  /** The route the reader offers back to the source. */
  onOpenSource?: ((cardId: string) => void) | undefined;
}

const STATE_WORDS = {
  intact: "Anchored",
  shifted: "Follows the source",
  ambiguous: "Two matches",
  stale: "Stale",
} as const;

/**
 * The reader half of ADR-0072: what an annotation says about the source it points into.
 *
 * The three states a reader has to tell apart are "the passage is where the card says",
 * "the passage moved and the card followed", and "the passage is gone". Only the last one
 * asks the reader to do anything, which is why it is the only one that shows a sentence
 * from the catalogue: a shifted range resolves silently, and saying so would be noise.
 *
 * The excerpt is read from the source at the resolved range, never from the stored quote,
 * so the panel cannot show text the source does not have. A card whose source is gone still
 * shows its own quote, because that is what the reader wrote.
 */
export function AnnotationReader({ read, source, onOpenSource }: AnnotationReaderProps) {
  if (!read.ok) {
    return (
      <section
        className="flex max-w-[340px] flex-col gap-1 rounded-xl border border-[var(--hairline)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--ink)]"
        data-testid="annotation-reader"
        data-state="incomplete"
        aria-label="Annotation"
      >
        <span className="text-[var(--ink-muted)]" data-testid="annotation-problem" role="status">
          {messageFor(read.code, { fields: read.fields.join(", ") })}
        </span>
      </section>
    );
  }

  const resolution = resolveAnnotationIn(read.record, source);
  const excerpt = annotationExcerpt(source?.text ?? "", resolution, read.record);

  return (
    <section
      className="flex max-w-[340px] flex-col gap-1.5 rounded-xl border border-[var(--hairline)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--ink)]"
      data-testid="annotation-reader"
      data-state={resolution.state}
      aria-label="Annotation"
    >
      <header className="flex items-center gap-2">
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">
          {source ? source.title : "Source missing"}
        </span>
        <span className="shrink-0 rounded-full bg-[var(--segmented-bg)] px-1.5 text-[11px]">
          {STATE_WORDS[resolution.state]}
        </span>
      </header>

      <blockquote className="m-0 leading-snug" data-testid="annotation-excerpt">
        <span className="text-[var(--ink-muted)]">{excerpt.before}</span>
        <mark className="bg-yellow-200/60 text-[var(--ink)] dark:bg-yellow-500/30">
          {excerpt.quote}
        </mark>
        <span className="text-[var(--ink-muted)]">{excerpt.after}</span>
      </blockquote>

      {resolution.code ? (
        <span className="text-[var(--ink-muted)]" data-testid="annotation-problem" role="status">
          {messageFor(resolution.code)}
        </span>
      ) : null}

      {source && onOpenSource ? (
        <button
          type="button"
          className="w-fit rounded-lg px-1.5 py-0.5 text-left underline decoration-[var(--hairline)] hover:bg-black/5 dark:hover:bg-white/10"
          data-testid="annotation-open-source"
          onClick={() => onOpenSource(read.record.sourceCardId)}
        >
          Open source
        </button>
      ) : null}
    </section>
  );
}
