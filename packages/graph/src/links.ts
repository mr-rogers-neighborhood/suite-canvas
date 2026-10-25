import type { EdgeEndpointKind, GraphEdge } from "./schema.js";

/** One end of a link: what it names and which kind of thing that is. */
export interface LinkEndpoint {
  kind: EdgeEndpointKind;
  id: string;
}

/**
 * Both ends of a link, with older documents read as card-to-card links. Every
 * caller that needs to know what an edge points at goes through this, so the
 * "absent kind means card" rule lives in exactly one place.
 */
export function edgeEndpoints(edge: GraphEdge): { source: LinkEndpoint; target: LinkEndpoint } {
  return {
    source: { kind: edge.sourceKind ?? "card", id: edge.source },
    target: { kind: edge.targetKind ?? "card", id: edge.target },
  };
}

export function sameEndpoint(left: LinkEndpoint, right: LinkEndpoint): boolean {
  return left.kind === right.kind && left.id === right.id;
}

/** True when the link has this endpoint at either end. */
export function edgeTouches(edge: GraphEdge, endpoint: LinkEndpoint): boolean {
  const ends = edgeEndpoints(edge);
  return sameEndpoint(ends.source, endpoint) || sameEndpoint(ends.target, endpoint);
}

/**
 * A link from a thing to itself. It is refused *unless* it is a card joining two
 * of its own connectors: that draws a loop on the canvas, means nothing
 * semantically, and is deliberately allowed because users expect the gesture to
 * work. Two ends on the same connector are still refused — that is a zero-length
 * link, not a loop.
 */
export function isSelfLink(
  source: LinkEndpoint,
  target: LinkEndpoint,
  connectors?: { source?: string | undefined; target?: string | undefined },
): boolean {
  if (!sameEndpoint(source, target)) return false;
  const from = connectors?.source;
  const to = connectors?.target;
  return !(from && to && from !== to);
}

/**
 * Identity of a drawn connection, ignoring direction: two links between the
 * same endpoints on the same connectors are duplicates.
 */
export function linkKey(edge: GraphEdge): string {
  const ends = edgeEndpoints(edge);
  const describe = (endpoint: LinkEndpoint, connectorId?: string) =>
    `${endpoint.kind}:${endpoint.id}:${connectorId ?? ""}`;
  const left = describe(ends.source, edge.sourceConnector);
  const right = describe(ends.target, edge.targetConnector);
  return [left, right].sort().join("|");
}
