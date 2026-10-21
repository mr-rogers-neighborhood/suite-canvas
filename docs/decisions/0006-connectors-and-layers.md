# ADR-0006: Node-owned connectors, magnetic placement, and layer order

- **Status:** accepted
- **Date:** 2026-10-20

## Context

Cards need connection points and stacking control. React Flow's built-in handles are fixed to
edge positions (`top`/`right`/`bottom`/`left`), cannot be moved per node, and are not part of the
CRDT — so a handle moved by one collaborator would not exist for anyone else.

Dragging a handle also has two distinct meanings: pulling a connection out of a card, and moving
the handle itself. Conflating them makes the connection gesture unreachable.

## Decision

1. **Connectors are node data.** `connectors: { id, x, y }[]` lives on the node in the CRDT, with
   `x`/`y` as 0..1 fractions of the card. New notes start with four side midpoints, and older
   documents are backfilled on read.
2. **Two-gesture interaction.** Click selects a connector and reveals a dashed circular grab
   handle; dragging that handle repositions it. The dot itself is reserved for future connection
   gestures.
3. **Magnetic, not snapped.** Positions are free along the perimeter. On release the connector
   gravitates to the nearest of 8 anchors (4 corners + 4 side midpoints) only when within a small
   radius; otherwise the free position is kept.
4. **Layering is a `z` integer per node.** `moveNodeLayer` reindexes all nodes in order and React
   Flow renders `zIndex: node.z`.
5. **Empty cards keep card dimensions** (`224×72` logical) so a blank note reads as a card.
6. **Selection is presence.** Peers broadcast selected node ids; cards outline in a peer's color,
   with dragging > editing > selecting priority.

## Consequences

- Connector layout is collaborative and survives reload.
- Connection gestures remain available for the dot.
- Magnetism feels forgiving without forbidding deliberate placement.
- Layer changes are O(n) writes, which is fine at current document sizes; a fractional ordering
  scheme can replace it if documents grow large.
- Presence traffic grows slightly (an array of selected ids), throttled by awareness batching.
