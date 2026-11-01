import type { Annotation, Card, WorkspaceDocument } from "@suite/graph";
import { annotationIdOf } from "@suite/graph";
import { IconGlyph } from "../icons/IconGlyph";
import { passageNodes, sourceTitle } from "../reader/promote";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";

/**
 * The highlight a card came from, or null for a card that came from nowhere.
 *
 * Read from the card's own `annotation` property rather than by scanning every highlight: the promotion writes that
 * value, so it is the fact, and a face that scanned the document would walk the whole record set on every paint.
 */
export function annotationOfCard(
  workspace: WorkspaceDocument | null,
  card: Card,
): Annotation | null {
  if (workspace === null) return null;
  const field = workspace
    .getType(card.primaryTypeId)
    ?.fields.find((entry) => entry.kind === "annotation");
  if (field === undefined) return null;
  const id = annotationIdOf(card.properties[field.id]);
  return id === null ? null : (workspace.getAnnotation(id) ?? null);
}

/**
 * A card that came out of a book.
 *
 * The passage sits above the body, not instead of it: the reader writes **around** the passage, and a face that owned
 * the whole card would take away the writing that is the point. The spine carries the kind's colour, so two cards from
 * the same page are told apart before either is read.
 *
 * **Reopen** goes back to the book — the reader's own place in it is remembered, so the passage they came from is on
 * the page they left. **Keep it** de-links and hands the passage over: promotion writes no body, because the body
 * belongs to the type's template, so de-linking is the one moment the words have to be written into it. The card
 * becomes an ordinary note the reader owns, and the highlight may produce another card later.
 */
export function AnnotationCardFace({ card }: { card: Card }) {
  const workspace = useCanvasStore((state) => state.workspace);
  const openCardFocus = useUiStore((state) => state.openCardFocus);
  const annotation = annotationOfCard(workspace, card);

  if (annotation === null || workspace === null) return null;
  const style = workspace.getAnnotationStyle(annotation.styleId);
  const source = workspace.displayTitle(annotation.sourceCardId).trim();
  const sourceName = source.length === 0 || source === "Untitled" ? "the book" : source;

  return (
    <div className="annotation-strip" data-testid="annotation-strip">
      <span
        aria-hidden="true"
        className="annotation-strip-spine"
        style={{ background: style?.color ?? "var(--accent)" }}
      />
      <span className="annotation-strip-text">
        <span className="annotation-strip-passage" data-testid="annotation-strip-passage">
          {annotation.excerpt ??
            (annotation.anchor.kind === "quote" ? annotation.anchor.quote : "")}
        </span>
        <span className="annotation-strip-where">
          <span>{style?.name ?? "Highlight"} from</span>
          <button
            type="button"
            className="annotation-strip-link nodrag nopan"
            data-testid="annotation-strip-source"
            title={`Open ${sourceName}`}
            onClick={(event) => {
              event.stopPropagation();
              openCardFocus(annotation.sourceCardId);
            }}
          >
            {sourceName}
          </button>
        </span>
      </span>
      <span className="annotation-strip-actions">
        <button
          type="button"
          className="views-icon-button nodrag nopan"
          aria-label="Reopen the passage in the book"
          title="Reopen in the book"
          data-testid="annotation-strip-reopen"
          onClick={(event) => {
            event.stopPropagation();
            openCardFocus(annotation.sourceCardId);
          }}
        >
          <IconGlyph icon="lucide:book-open" size={12} />
        </button>
        <button
          type="button"
          className="views-icon-button nodrag nopan"
          aria-label="Keep this card without the highlight"
          title="Keep it: the passage stays, the link goes"
          data-testid="annotation-strip-keep"
          onClick={(event) => {
            event.stopPropagation();
            // One gesture, one undo step: the passage, the record's link and the app's own field all leave together.
            workspace.batch("annotation:detach", () => {
              const passage = passageNodes(
                annotation.anchor.kind === "quote" ? annotation.anchor.quote : null,
                {
                  cardId: annotation.sourceCardId,
                  title: sourceTitle(workspace, annotation),
                },
              );
              // Appended, never replacing: a card that came from a highlight is already a card the reader writes in,
              // and de-linking must not throw that writing away.
              workspace.setBodyNodes(card.id, [...workspace.bodyNodes(card.id), ...passage]);
              workspace.setAnnotationCard(annotation.id, null);
              const field = workspace
                .getType(card.primaryTypeId)
                ?.fields.find((entry) => entry.kind === "annotation");
              // The app is clearing its own field: it is read-only to the reader, which is the point of the field.
              if (field !== undefined)
                workspace.setProperty(card.id, field.id, null, { asApp: true });
            });
          }}
        >
          <IconGlyph icon="lucide:unlink" size={12} />
        </button>
      </span>
    </div>
  );
}
