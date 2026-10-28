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

/** True when the link joins exactly these two ends, in either direction. */
export function joinsEndpoints(
  edge: GraphEdge,
  source: LinkEndpoint,
  target: LinkEndpoint,
): boolean {
  const ends = edgeEndpoints(edge);
  return (
    (sameEndpoint(ends.source, source) && sameEndpoint(ends.target, target)) ||
    (sameEndpoint(ends.source, target) && sameEndpoint(ends.target, source))
  );
}

/** True when `source` is the link's *far* end, so the two ends arrive swapped. */
export function joinsReversed(edge: GraphEdge, source: LinkEndpoint): boolean {
  return !sameEndpoint(edgeEndpoints(edge).source, source);
}

/** True when neither end names a dot: the line was drawn before its dots were known. */
export function isUnpinned(edge: GraphEdge): boolean {
  return edge.sourceConnector === undefined && edge.targetConnector === undefined;
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
 * Identity of a relationship: the two things it joins, on one board.
 *
 * Not the dots. A link is a fact about a pair — "this note supports that concept" —
 * and re-drawing it somewhere else on the cards is the same fact, not a new one. Keying
 * by the dots meant every place, unplace and re-place that put a card on a different
 * side wrote another relationship between the same two things, which drew as a pile of
 * lines and read as a bug in the gesture that made them.
 *
 * The board is part of the key, because two boards hold two independent sets of
 * relationships over the same cards.
 */
export function pairKey(edge: GraphEdge): string {
  return pairKeyOf(edge.boardId, edgeEndpoints(edge).source, edgeEndpoints(edge).target);
}

/** `pairKey` for endpoints that are not a record yet: what `addEdge` is about to write. */
export function pairKeyOf(boardId: string, source: LinkEndpoint, target: LinkEndpoint): string {
  const describe = (endpoint: LinkEndpoint) => `${endpoint.kind}:${endpoint.id}`;
  const ends = [describe(source), describe(target)].sort();
  return `${boardId}|${ends[0]}|${ends[1]}`;
}
