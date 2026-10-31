import type { Annotation, AnnotationStyle } from "@suite/graph";
import { useCallback, useEffect, useState } from "react";
import { useCanvasStore } from "../store/useCanvasStore";

/**
 * A book's highlights and the palette, kept in step with the document.
 *
 * One subscription for both, because a highlight and a colour arrive together in every surface that shows
 * them: a palette that updated a frame before the marks would repaint a chapter with the wrong colours.
 */
export interface Highlights {
  readonly annotations: readonly Annotation[];
  readonly styles: readonly AnnotationStyle[];
  readonly add: (input: {
    styleId: string;
    anchor: Annotation["anchor"];
    excerpt?: string;
  }) => Annotation | null;
  readonly remove: (id: string) => void;
  readonly restyle: (id: string, styleId: string) => void;
  /** Re-read after a change the subscription did not announce, like a promotion. */
  readonly refresh: () => void;
}

export function useHighlights(sourceCardId: string): Highlights {
  const workspace = useCanvasStore((state) => state.workspace);
  const [annotations, setAnnotations] = useState<readonly Annotation[]>([]);
  const [styles, setStyles] = useState<readonly AnnotationStyle[]>([]);

  const read = useCallback(() => {
    if (workspace === null) {
      setAnnotations([]);
      setStyles([]);
      return;
    }
    setAnnotations(workspace.listAnnotationsOf(sourceCardId));
    setStyles(workspace.ensureAnnotationStyles());
  }, [workspace, sourceCardId]);

  useEffect(() => {
    read();
    if (workspace === null) return;
    return workspace.observeAnnotations(read);
  }, [workspace, read]);

  const add = useCallback(
    (input: { styleId: string; anchor: Annotation["anchor"]; excerpt?: string }) => {
      if (workspace === null) return null;
      return workspace.addAnnotation({
        sourceCardId,
        styleId: input.styleId,
        anchor: input.anchor,
        ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt }),
      });
    },
    [workspace, sourceCardId],
  );

  const remove = useCallback(
    (id: string) => {
      workspace?.deleteAnnotation(id);
    },
    [workspace],
  );

  const restyle = useCallback(
    (id: string, styleId: string) => {
      workspace?.setAnnotationStyle(id, styleId);
    },
    [workspace],
  );

  return { annotations, styles, add, remove, restyle, refresh: read };
}
