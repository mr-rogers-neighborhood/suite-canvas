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
export type LinkMode = "connect" | "thread";

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
