import type { Annotation, AnnotationStyle, WorkspaceDocument } from "@suite/graph";
import { ANNOTATION_QUOTE_MAX_LENGTH } from "@suite/graph";
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
      // A selection longer than a highlight may be is refused here rather than thrown out of a click handler: a schema
      // parse that throws inside `onClick` is a press that does nothing and says nothing.
      if (
        input.anchor.kind === "quote" &&
        input.anchor.quote.length > ANNOTATION_QUOTE_MAX_LENGTH
      ) {
        return null;
      }
      try {
        return workspace.addAnnotation({
          sourceCardId,
          styleId: input.styleId,
          anchor: input.anchor,
          ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt }),
        });
      } catch {
        // The schema is the authority and the guard above is only the case we can name in advance. Anything else it
        // refuses is still a press that must not crash the reader.
        return null;
      }
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

/**
 * Every highlight in the workspace, re-read when one changes.
 *
 * The library's list is the reader's record of what they marked, so it wants all of them rather than one source's;
 * the same subscription and the same one listener, because a palette change and a highlight arrive together wherever
 * somebody is looking at either.
 */
export function useAnnotations(workspace: WorkspaceDocument | null): Annotation[] {
  const [annotations, setAnnotations] = useState<readonly Annotation[]>([]);

  useEffect(() => {
    if (workspace === null) {
      setAnnotations([]);
      return;
    }
    const read = () => setAnnotations(workspace.listAnnotations());
    read();
    return workspace.observeAnnotations(read);
  }, [workspace]);

  return [...annotations];
}
