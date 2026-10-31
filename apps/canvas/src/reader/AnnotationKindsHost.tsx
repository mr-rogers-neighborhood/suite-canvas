import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { AnnotationKindsDialog } from "./AnnotationKindsDialog";

/**
 * The kinds editor, wherever it was opened from.
 *
 * The library's Annotations tab, the raise surface in a book and the card panel all open the same dialog, so it belongs
 * to the shell and reads its own flag. Mounting it inside the drawer made it the drawer's: closing the drawer it was
 * opened from unmounted the dialog, and the drawer's escape layer closed both at once.
 */
export function AnnotationKindsHost() {
  const open = useUiStore((state) => state.annotationKindsOpen);
  const close = useUiStore((state) => state.closeAnnotationKinds);
  const workspace = useCanvasStore((state) => state.workspace);
  if (!open || workspace === null) return null;
  return <AnnotationKindsDialog workspace={workspace} onClose={close} />;
}
