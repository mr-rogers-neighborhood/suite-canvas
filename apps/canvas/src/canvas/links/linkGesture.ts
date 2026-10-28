import type { EdgeEndpointKind } from "@suite/graph";

/** Where a gesture is starting from or aiming at. */
export interface LinkEndpointRef {
  kind: EdgeEndpointKind;
  id: string;
  connectorId?: string | undefined;
}

/**
 * What a plain click on a connector does. `connect` drags one link; `thread`
 * chains them. Shift-click chains either way, which is the Autodesk gesture.
 */
/**
 * How the next click is read, whichever gesture is about to make it
 * (ADR-0061,
 * ADR-0063).
 *
 * The mode is the *link* tool: `place` draws one link per pair of clicks, `thread`
 * chains from the dot just clicked, and `fan` links every click from one fixed origin.
 * Dragging from a dot to a dot draws one link in any mode.
 */
export const canvasModes = ["place", "thread", "fan"] as const;
export type CanvasMode = (typeof canvasModes)[number];

/** What each mode does to a click on a dot: the label, and the sentence behind it. */
export const MODE_NAMES: Record<CanvasMode, { label: string; title: string }> = {
  place: {
    label: "Place",
    title: "Place: click two dots to draw one link",
  },
  thread: {
    label: "Thread",
    title: "Thread: each click chains from the dot you just clicked",
  },
  fan: {
    label: "Fan",
    title: "Fan: every click links from the same origin dot",
  },
};

/**
 * The cycle the button walks: place → thread → fan → place. One reader, so the pill and
 * anything else that offers "the next mode" cannot disagree about what it is.
 */
export function nextMode(mode: CanvasMode): CanvasMode {
  const index = canvasModes.indexOf(mode);
  return canvasModes[(index + 1) % canvasModes.length] ?? "place";
}

/** True for the modes that keep drawing instead of placing one thing at a time. */
export function isChainingMode(mode: CanvasMode): boolean {
  return mode !== "place";
}

/** A link being drawn, before it has a second end. */
export interface LinkDraft {
  from: LinkEndpointRef;
  to?: LinkEndpointRef | undefined;
  /** True when the draft came from thread mode, so the UI can style it. */
  chained: boolean;
}

/** The endpoint a draft starts from, or null when there is no draft. */
export function draftSource(draft: LinkDraft | null): LinkEndpointRef | null {
  return draft?.from ?? null;
}

/** True when two endpoint refs would produce the same link end. */
export function sameLinkEndpoint(left: LinkEndpointRef, right: LinkEndpointRef): boolean {
  return (
    left.kind === right.kind &&
    left.id === right.id &&
    (left.connectorId ?? "") === (right.connectorId ?? "")
  );
}

/**
 * The connector a finished link stores for one end, given the node it was
 * released on and the node that end is drawn through.
 *
 * A board is drawn through the portal that opens it. When one board is opened by
 * two portals on the same board, the released portal's dot does not exist on the
 * node the line is painted through, and React Flow silently drops a link whose
 * handle id it cannot find — so that dot is not stored. Every other end keeps the
 * dot it was released on, which is what makes a link land on the port aimed at
 * rather than the side facing the other end.
 */
export function linkEndConnector(
  releasedNode: string | null | undefined,
  drawnNode: string | null | undefined,
  connectorId: string | null | undefined,
): string | undefined {
  if (!connectorId) return undefined;
  if (releasedNode && drawnNode && releasedNode !== drawnNode) return undefined;
  return connectorId;
}
