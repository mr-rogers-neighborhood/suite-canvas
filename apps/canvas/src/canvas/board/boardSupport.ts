import { type GraphEdge, resolveSurfaceStyle } from "@suite/graph";
import { type Edge, MarkerType } from "@xyflow/react";
import type { EdgeDescriptionData } from "../EdgeDescription";
import { linkStroke } from "../surfacePaint";

/** Pointer samples published to peers land at most once per this window. */
export const DRAG_THROTTLE_MS = 40;

/**
 * Whether a selection box has genuinely left a section's frame.
 *
 * Exact containment is too strict: the geometry runs screen → flow through a
 * zoom transform, so a box drawn eight pixels inside a border can land a few
 * units outside it and the scope would lift mid-gesture. A box has to clear the
 * frame by a visible margin before it stops being "inside".
 */
const SCOPE_EXIT_TOLERANCE = 16;

/**
 * True when a right-click landed in rich text that is being edited. The
 * browser's native menu (copy, paste, spelling) is more useful there than the
 * card menu. A read-only ProseMirror body keeps the card menu, which is how
 * right-clicking a card without an active editor reaches it. Field mentions
 * and property blocks handle their own context menu earlier and stop
 * propagation, so they still open the app menu.
 */
export function isEditorTarget(event: { target: EventTarget | null }): boolean {
  const target = event.target as HTMLElement | null;
  const editor = target?.closest<HTMLElement>(".ProseMirror");
  if (!editor) return false;
  return editor.isContentEditable || editor.getAttribute("contenteditable") === "true";
}

/** Client coordinates of a mouse or touch event, when it carries any. */
export function clientPoint(event: MouseEvent | TouchEvent): { x: number; y: number } | null {
  if ("clientX" in event) return { x: event.clientX, y: event.clientY };
  const touch = event.touches[0] ?? event.changedTouches[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

/**
 * A selection as one comparable key. Sorted, so two sets that name the same
 * cards compare equal: neither the store echo nor React Flow promises the
 * other's order.
 */
export function selectionKeyOf(ids: readonly string[]): string {
  return [...ids].sort().join(",");
}

/**
 * Publishes a gesture's pointer samples at most once per `DRAG_THROTTLE_MS`,
 * plus a trailing sample so a pointer that stops still lands on every peer.
 */
export function followPointer(
  screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number },
  publish: (position: { x: number; y: number }) => void,
) {
  let lastSent = 0;
  let pending: { x: number; y: number } | null = null;
  let trailing: ReturnType<typeof setTimeout> | null = null;

  const follow = (event: PointerEvent) => {
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const wait = DRAG_THROTTLE_MS - (performance.now() - lastSent);
    if (wait <= 0) {
      lastSent = performance.now();
      publish(position);
      return;
    }
    pending = position;
    if (trailing !== null) return;
    trailing = setTimeout(() => {
      trailing = null;
      if (!pending) return;
      lastSent = performance.now();
      publish(pending);
      pending = null;
    }, wait);
  };

  const stop = () => {
    if (trailing !== null) clearTimeout(trailing);
    trailing = null;
    pending = null;
  };

  return { follow, stop };
}

export function toFlowEdge(
  edge: GraphEdge,
  /** React Flow node ids both ends are drawn through (a portal stands in for a board). */
  link: { source: string; target: string },
  selected: boolean,
  data: Pick<EdgeDescriptionData, "onLabelDrag" | "onLabelEdit">,
  peerColor?: string,
): Edge {
  const marker = {
    type: MarkerType.ArrowClosed,
    width: 18,
    height: 18,
    ...(peerColor ? { color: peerColor } : {}),
  };
  // A link's own paint (ADR-0051 §1: one stroke, `sides.top`) rides React Flow's
  // edge style — but only when the link was actually styled. A peer's colour is
  // presence, not document state, so it wins while it lasts.
  const style = edge.style
    ? {
        ...linkStroke(resolveSurfaceStyle(edge.style, "link")),
        ...(peerColor ? { stroke: peerColor } : {}),
      }
    : peerColor
      ? { stroke: peerColor, strokeWidth: 2 }
      : {};

  return {
    id: edge.id,
    source: link.source,
    target: link.target,
    type: "description",
    // One edge component renders every routing style; path and label placement
    // travel with it, along with the callbacks that make the label draggable.
    data: {
      path: edge.path,
      ...(edge.labelOffset === undefined ? {} : { labelOffset: edge.labelOffset }),
      ...data,
    } satisfies EdgeDescriptionData,
    selected,
    ...(edge.sourceConnector ? { sourceHandle: edge.sourceConnector } : {}),
    ...(edge.targetConnector ? { targetHandle: edge.targetConnector } : {}),
    ...(edge.label ? { label: edge.label } : {}),
    style,
    markerEnd: marker,
    ...(edge.bidirectional ? { markerStart: marker } : {}),
  };
}

export function leavesSection(
  section: { x: number; y: number; width: number; height: number },
  box: { x: number; y: number; width: number; height: number },
): boolean {
  const slack = SCOPE_EXIT_TOLERANCE;
  return (
    box.x < section.x - slack ||
    box.y < section.y - slack ||
    box.x + box.width > section.x + section.width + slack ||
    box.y + box.height > section.y + section.height + slack
  );
}
