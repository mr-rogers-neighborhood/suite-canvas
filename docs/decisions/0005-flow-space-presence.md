# ADR-0005: Flow-space presence and live drag tracking

- **Status:** accepted; CRDT/presence mechanics amended by [ADR-0015](./0015-loro-as-crdt-engine.md); coordinate and instance scoping amended by [ADR-0030](./0030-scene-projection-lod-and-real-portals.md)
- **Date:** 2026-10-20

> **Amendment (2026-10-23, [ADR-0030](./0030-scene-projection-lod-and-real-portals.md)).** Presence
> stays in **scene coordinates**, not screen pixels: the derived scene maps a peer's board position
> into every visible instance of that board, through that instance's transform. A peer dragging a
> card is therefore drawn in all instances of the card, and a peer's caret belongs to the instance
> whose editor owns the Loro container. The ephemeral transport and the drag/live-position rule are
> unchanged.

## Context

Collaborator cursors drifted from the real pointer once the canvas was panned or zoomed, because
pointer positions were sent as raw screen pixels and drawn in a viewport-fixed overlay. Dragging
had a worse problem: positions were only written to the CRDT on drop, so a remote card appeared
to jump from its old spot to its new one, with nothing visible in between.

Remote carets had a third bug: every node editor shares one awareness channel, and
`yCursorPlugin` publishes a single `cursor` field. Each editor therefore tried to map the peer's
position into its own document, drawing carets in the wrong card.

## Decision

1. **All presence positions are React Flow flow coordinates** (`screenToFlowPosition`), rendered
   through React Flow's `ViewportPortal`. Pan and zoom are then handled by the canvas transform.
2. **Dragging broadcasts live position** on the `dragging` awareness field (throttled to ~40 ms),
   and the collaborator's card eases toward it per animation frame (`SMOOTHING = 0.22`).
   The CRDT is still written only on drag stop.
3. **Remote carets are filtered by focus**: `yCursorPlugin`'s `awarenessStateFilter` only renders
   a peer's cursor into the node named in that peer's `focus`.

## Consequences

- Cursors stay aligned at any pan/zoom level; the overlay is counter-scaled so labels keep a
  constant size.
- Collaborators see the card move continuously while it is dragged, with no disappear/reappear.
- Carets only appear in the card a peer is editing.
- Awareness traffic is small and throttled; document writes stay limited to drag end.
- Smoothing is intentionally simple (exponential ease); interpolation of real-time remote motion
  can be revisited if it feels laggy at higher latencies.
