import type { Annotation } from "@suite/graph";
import { annotationIdOf } from "@suite/graph";
import { AnnotationPassage } from "../cards/AnnotationPassage";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { registerFieldKind } from "./fieldKindRegistry";

/**
 * A card's link to the highlight it came from.
 *
 * Read-only, and the rule lives here rather than in a per-field switch: the anchor is the truth, and a card that could
 * rewrite its own quote would disagree with the mark it came from. So the editor is a face, not an input — a reader
 * retypes nothing, and the quote they see is the one in the book.
 *
 * **The face is the whole passage.** It used to be a dot and a truncated excerpt, which made the one place a reader
 * could deliberately put the quotation, a `Highlight` block in the body, the place that showed the least of it. It draws
 * the same component the card's header draws, so a template that embeds this field gets the passage itself, and the
 * header steps aside because the body already shows it.
 *
 * A highlight this build cannot find says so. That is the same honesty every reference gets: a viewer must never see a
 * broken box, and must never be told nothing when a passage exists elsewhere.
 */
export function AnnotationField({ value }: { value: unknown }) {
  const workspace = useCanvasStore((state) => state.workspace);
  const openCardFocus = useUiStore((state) => state.openCardFocus);
  const openAnnotation = useUiStore((state) => state.openAnnotation);
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

  const style = workspace?.listAnnotationStyles().find((entry) => entry.id === annotation.styleId);
  const title = workspace?.displayTitle(annotation.sourceCardId).trim() ?? "";
  const sourceName = title.length === 0 || title === "Untitled" ? "the book" : title;

  return (
    <AnnotationPassage
      annotation={annotation}
      style={style}
      sourceName={sourceName}
      variant="inline"
      onOpenSource={() => {
        // The passage, then the book: the same route the card's header offers, so the block is not a dead end.
        openAnnotation(annotation.id);
        openCardFocus(annotation.sourceCardId);
      }}
    />
  );
}

registerFieldKind({
  kind: "annotation",
  editor: AnnotationField,
  // The value is a passage, and the generic formatter can only print the word for it.
  rendersReadOnlyFace: true,
});
