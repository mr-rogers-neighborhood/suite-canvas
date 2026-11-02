import type { Annotation } from "@suite/graph";
import { partText } from "@suite/graph";
import type { ReactNode } from "react";
import { IconGlyph } from "../icons/IconGlyph";
import { slotLabel } from "../reader/HighlightFocus";
import { beginHighlightDrag } from "../reader/highlightDrag";

/**
 * One highlight, as both the book and the library show it.
 *
 * The two panels had grown a row each and had already drifted: the book's rows could be expanded to the whole passage and
 * ticked for a batch place, the library's could be removed and said where the card went, and neither had the other's. A
 * highlight is a highlight wherever it is listed, so there is one row and both lists mount it — what each list adds around
 * it (book grouping, a search, a batch bar) stays that list's business.
 *
 * The row never writes: every verb is a callback, because the two hosts own different documents and selections.
 */
export interface AnnotationRowProps {
  readonly annotation: Annotation;
  /** The kind's colour, resolved by the host, so the row does not reach for the palette. */
  readonly colour: string | undefined;
  /** The host's test id prefix, so each list keeps the ids its tests and handbook sections already name. */
  readonly testId: string;
  readonly expanded: boolean;
  readonly onToggleExpand: () => void;
  readonly onOpen: () => void;
  readonly onPlace: () => void;
  readonly onRemove?: (() => void) | undefined;
  /** What became of it — "Not a card yet", a card's title — where the host can say. */
  readonly where?: ReactNode;
  /** A tick for picking several at once, which only a panel with a batch place needs. */
  readonly pick?:
    | { readonly checked: boolean; readonly onToggle: () => void; readonly label: string }
    | undefined;
}

/** The words a row shows at a glance: the excerpt the medium reported, or the quote itself. */
export function wordsOf(annotation: Annotation): string {
  if (annotation.excerpt !== undefined && annotation.excerpt.length > 0) return annotation.excerpt;
  if (annotation.anchor.kind === "quote") return annotation.anchor.quote;
  if (annotation.anchor.kind === "page") return `Page ${String(annotation.anchor.page + 1)}`;
  return "A passage";
}

/** The passage in full, which a row's first line is not. */
function passageOf(annotation: Annotation): string {
  if (annotation.anchor.kind !== "quote") return wordsOf(annotation);
  return annotation.anchor.quote;
}

export function AnnotationRow({
  annotation,
  colour,
  testId,
  expanded,
  onToggleExpand,
  onOpen,
  onPlace,
  onRemove,
  where,
  pick,
}: AnnotationRowProps) {
  const words = wordsOf(annotation);
  const parts = annotation.parts ?? [];
  return (
    <li className="annotation-row-wrap" data-picked={pick?.checked ? "true" : undefined}>
      {pick === undefined ? null : (
        <input
          type="checkbox"
          className="annotation-row-pick"
          aria-label={pick.label}
          data-testid={`${testId}-pick-${annotation.id}`}
          checked={pick.checked}
          onChange={pick.onToggle}
        />
      )}
      <button
        type="button"
        className="annotation-row"
        data-testid={`${testId}-${annotation.id}`}
        onPointerDown={(event) => {
          // Travel makes it a drag, exactly as a painted mark does: one gesture means one thing wherever a highlight is.
          if (event.button !== 0) return;
          beginHighlightDrag(annotation.id, { x: event.clientX, y: event.clientY }, null);
        }}
        onClick={onOpen}
      >
        <span
          aria-hidden="true"
          className="annotation-row-dot"
          style={{ background: colour ?? "var(--accent)" }}
        />
        <span className="annotation-row-text" data-expanded={expanded ? "true" : undefined}>
          {words}
          {parts.length === 0 ? null : (
            <span className="annotation-row-parts">{`${String(parts.length)} parts`}</span>
          )}
        </span>
        {where === undefined ? null : <span className="annotation-row-where">{where}</span>}
        {annotation.note === undefined ? null : (
          <span className="annotation-row-mark" title="This highlight has a note">
            <IconGlyph icon="lucide:message-square" size={10} />
          </span>
        )}
        {annotation.cardId === undefined ? null : (
          <span className="annotation-row-mark" title="This highlight is a card">
            <IconGlyph icon="lucide:check" size={11} />
          </span>
        )}
      </button>
      <button
        type="button"
        className="views-icon-button"
        aria-label={expanded ? "Collapse this highlight" : "Show the whole passage"}
        aria-expanded={expanded}
        title={expanded ? "Collapse" : "Show the whole passage"}
        data-testid={`${testId}-expand-${annotation.id}`}
        onClick={onToggleExpand}
      >
        <IconGlyph icon={expanded ? "lucide:chevron-up" : "lucide:chevron-down"} size={12} />
      </button>
      <button
        type="button"
        className="views-icon-button"
        aria-label={`Place the highlight “${words.slice(0, 40)}” on the board`}
        title="Place on the board"
        data-testid={`${testId}-place-${annotation.id}`}
        onClick={onPlace}
      >
        <IconGlyph icon="lucide:import" size={12} />
      </button>
      {onRemove === undefined ? null : (
        <button
          type="button"
          className="views-icon-button"
          aria-label={`Remove the highlight “${words.slice(0, 40)}”`}
          title="Remove the highlight"
          data-testid={`${testId}-remove-${annotation.id}`}
          onClick={onRemove}
        >
          <IconGlyph icon="lucide:x" size={12} />
        </button>
      )}
      {expanded ? (
        <div className="annotation-row-full" data-testid={`${testId}-full-${annotation.id}`}>
          <span className="annotation-row-full-words">{passageOf(annotation)}</span>
          {parts.length === 0 ? null : (
            <ol className="annotation-row-full-parts">
              {parts.map((part) => (
                <li key={part.id}>
                  <span className="annotation-row-full-target">{slotLabel(part.target)}</span>
                  <span>{partText(annotation, part) ?? ""}</span>
                </li>
              ))}
            </ol>
          )}
          {annotation.note === undefined ? null : (
            <p className="annotation-row-full-note" data-testid={`${testId}-note-${annotation.id}`}>
              {annotation.note}
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}
