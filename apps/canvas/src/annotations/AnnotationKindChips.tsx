import type { Annotation, AnnotationStyle } from "@suite/graph";
import { IconGlyph } from "../icons/IconGlyph";

/**
 * The kinds a highlight can be, as chips.
 *
 * Both lists offer the same three questions — everything, the ones that are not cards yet, one kind at a time — and both
 * had their own chip component to do it. One component, one vocabulary, and the chip is the `.style-chip` the style
 * editor already uses, so a kind reads the same in a filter as it does in a palette.
 */
export interface AnnotationKindChipsProps {
  readonly styles: readonly AnnotationStyle[];
  /** `null` is everything, `"unplaced"` is the ones with no card yet, anything else is a kind's id. */
  readonly kind: string | null;
  readonly onKind: (kind: string | null) => void;
  /** The host's test id prefix: `reader-filter` in the book, `library-annotation-filter` in the library. */
  readonly testId: string;
  readonly unplacedLabel?: string;
}

/** Whether a highlight belongs in a filter. Here rather than in each list, so the two cannot read a chip differently. */
export function matchesKind(annotation: Annotation, kind: string | null): boolean {
  if (kind === null) return true;
  if (kind === "unplaced") return annotation.cardId === undefined;
  return annotation.styleId === kind;
}

export function AnnotationKindChips({
  styles,
  kind,
  onKind,
  testId,
  unplacedLabel = "Not a card yet",
}: AnnotationKindChipsProps) {
  return (
    <div
      className="reader-mark-filters"
      role="toolbar"
      aria-label="Filter the highlights"
      data-testid={`${testId}s`}
    >
      <Chip
        label="All"
        active={kind === null}
        onPick={() => onKind(null)}
        testId={`${testId}-all`}
      />
      <Chip
        label={unplacedLabel}
        active={kind === "unplaced"}
        onPick={() => onKind("unplaced")}
        testId={`${testId}-unplaced`}
      />
      {styles.map((style) => (
        <Chip
          key={style.id}
          label={style.name}
          colour={style.color}
          active={kind === style.id}
          onPick={() => onKind(kind === style.id ? null : style.id)}
          testId={`${testId}-${style.id}`}
        />
      ))}
    </div>
  );
}

function Chip({
  label,
  colour,
  active,
  onPick,
  testId,
}: {
  label: string;
  colour?: string | undefined;
  active: boolean;
  onPick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      className="style-chip reader-mark-filter"
      data-testid={testId}
      data-checked={active ? "true" : undefined}
      aria-pressed={active}
      onClick={onPick}
    >
      {colour === undefined ? null : (
        <span
          aria-hidden="true"
          className="annotation-row-dot"
          style={{ background: colour, marginRight: 4 }}
        />
      )}
      {label}
      {active ? <IconGlyph icon="lucide:check" size={10} /> : null}
    </button>
  );
}
