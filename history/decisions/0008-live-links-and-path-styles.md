# ADR-0008: Live links, reconnection, and path styles

- **Status:** accepted
- **Date:** 2026-10-21

## Context

Links attached to connectors, but three gaps remained:

1. Moving a connector only re-routed the link after the drop, so the link appeared to detach.
2. A link could only be redrawn by deleting it and connecting again.
3. Every link used the default curve, which reads poorly across dense areas of the canvas.

Connectors also need to be visible to collaborators while they move, and selected links should not be
invisible to peers.

## Decision

1. **Re-measure during the drag, not after.** `Connector` stores its live perimeter position in local
   state (so the dot moves immediately) and calls `updateNodeInternals(nodeId)` inside a
   `requestAnimationFrame` gate. React Flow then re-routes attached edges at frame rate without a
   CRDT write per pointer event; the CRDT is updated on drop only.
2. **Reconnect through the library.** `edgesReconnectable` + `onReconnect` reuse React Flow's
   reconnect handles and hit-testing. Drag either end of a link onto another connector. React Flow
   keeps the anchored end intact, so the moved end is inferred by comparing the payload against the
   old edge (`source`/`sourceHandle` unchanged ⇒ the target moved). A link may not point at its own
   node.
3. **Path style is data, not styling.** `path` (`bezier | straight | step | smoothstep`) is stored on
   the edge and mapped to React Flow's edge types through a single `EDGE_TYPE` lookup, so the choice
   persists, syncs, and can be changed later from the **Path** submenu.
4. **Presence covers connectors and links.** Moving a connector publishes `connector { nodeId,
   connectorId }` and selected link ids ride along in `selection.edgeIds`. Peers see a ring around
   the connector being moved and the selected link in the peer's colour.
5. **Selection suppresses edge pointer events.** While a connector is selected the board sets
   `.connector-active`, disabling pointer events on edges, `.react-flow__edge-interaction` and
   `.react-flow__edgeupdater`. React Flow's reconnect handle is a 10 px circle centred on the
   connector dot and would otherwise capture the drag meant to move the connector.

## Consequences

- Links stay visually attached to their connectors during a drag, with no CRDT churn.
- Links are editable (endpoints, direction, path) without being deleted and redrawn.
- Edge gesture conflicts are resolved by a single CSS switch instead of per-element hacks.
- Right-clicking a link immediately after its endpoints swap can briefly hit the pane, because React
  Flow drops the edge for a frame while handles re-register; the e2e helper retries instead of
  asserting on one frame.

## Amendment 2026-10-25: path styles now render a route

[ADR-0052](./0052-a-link-is-a-route.md) adds `bends` and `layer` to the edge. §3 above said path style is
data; it still is, and now the path it names renders one polyline: bezier curves through the bends,
`straight` joins them, `step`/`smoothstep` route right angles through them. There is no "manual" mode and no
mode in which a bend is ignored, so §3's four values keep their meaning and gain a route to follow.
`reconnectEdge` and `reverseEdge` preserve bends.
