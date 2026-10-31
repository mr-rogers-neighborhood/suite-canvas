import { type Annotation, annotationIdOf } from "@suite/graph";
import { useCanvasStore } from "../store/useCanvasStore";
import { registerFieldKind } from "./fieldKindRegistry";

/**
 * A card's link to the highlight it came from.
 *
 * Read-only, and the rule lives here rather than in a per-field switch: the anchor is the truth, and a card that
 * could rewrite its own quote would disagree with the mark it came from. So the editor is a face, not an input —
 * a reader retypes nothing, and the quote they see is the one in the book.
 *
 * A highlight this build cannot find says so. That is the same honesty `R11` asks of every reference: a viewer
 * must never see a broken box, and must never be told nothing when a passage exists elsewhere.
 */
function AnnotationField({ value }: { value: unknown }) {
  const workspace = useCanvasStore((state) => state.workspace);
  const annotationId = annotationIdOf(value);
  const annotation: Annotation | undefined =
    annotationId === null ? undefined : workspace?.getAnnotation(annotationId);

  if (annotation === undefined) {
    return (
      <span className="annotation-field annotation-field--missing" data-testid="annotation-missing">
        This passage is gone
      </span>
    );
  }

  const styles = workspace?.listAnnotationStyles() ?? [];
  const style = styles.find((entry) => entry.id === annotation.styleId);
  return (
    <span
      className="annotation-field"
      data-testid="annotation-field"
      title={annotation.excerpt ?? style?.name ?? "Highlight"}
    >
      <span
        aria-hidden="true"
        className="annotation-field-dot"
        style={{ background: style?.color ?? "var(--accent)" }}
      />
      <span className="annotation-field-text">
        {annotation.excerpt ?? style?.name ?? "Highlight"}
      </span>
    </span>
  );
}

registerFieldKind({ kind: "annotation", editor: AnnotationField });
