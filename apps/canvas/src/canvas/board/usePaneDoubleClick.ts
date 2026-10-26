import { useEffect } from "react";

/** Elements whose own double-click must win over "new card here". */
const KEEPS_DOUBLE_CLICK =
  ".react-flow__node, .react-flow__edge, .react-flow__handle, [data-section-id], .ProseMirror, button, a, input, select, textarea, [role='button'], [role='menuitem']";

/**
 * A double-click on empty canvas creates a card at that point.
 *
 * React Flow has no pane double-click prop, so this binds the pane element it
 * creates. Only the bare pane counts: a card, an edge, a section or a control
 * keeps its own double-click meaning (open, edit, rename).
 *
 * The surface also turns `zoomOnDoubleClick` off, because otherwise the gesture
 * would both create a card and zoom the camera.
 */
export function usePaneDoubleClick(input: {
  store: { getState(): { domNode: HTMLDivElement | null } };
  enabled: boolean;
  onDoubleClick: (client: { x: number; y: number }) => void;
}): void {
  const { store, enabled, onDoubleClick } = input;

  useEffect(() => {
    if (!enabled) return;
    const pane = store.getState().domNode?.querySelector<HTMLElement>(".react-flow__pane");
    if (!pane) return;
    const handle = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(KEEPS_DOUBLE_CLICK)) return;
      event.preventDefault();
      onDoubleClick({ x: event.clientX, y: event.clientY });
    };
    pane.addEventListener("dblclick", handle);
    return () => pane.removeEventListener("dblclick", handle);
  }, [store, enabled, onDoubleClick]);
}
