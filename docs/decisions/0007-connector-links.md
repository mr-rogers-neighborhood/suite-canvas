# ADR-0007: Links between connectors, with direction control

- **Status:** accepted
- **Date:** 2026-10-20

## Context

Cards already expose movable connectors, but nothing could be attached to them. Links also need to
say *which* connector they leave from, and whether they are one-way or bidirectional.

## Decision

1. **Connector dots are React Flow handles.** `Connector` renders a `<Handle id={connector.id}>`
   positioned at the connector's perimeter fraction, with `ConnectionMode.Loose` on the canvas so
   any connector can start or receive a connection. This reuses React Flow's hit-testing, drag line,
   and edge routing instead of reimplementing them.
2. **Edges reference connectors.** `source`/`target` carry node ids and
   `sourceConnector`/`targetConnector` carry handle ids; edges render with `sourceHandle` and
   `targetHandle` so they attach exactly where the user dropped them.
3. **Direction is a boolean.** `bidirectional` renders an arrow at both ends; reversing swaps
   endpoints and connectors together.
4. **The grab handle sits under the dot.** The dashed ring used to reposition sits at a lower
   z-index than the dot, so both gestures stay available: drag the ring to move, drag the dot to
   connect.
5. **Layer actions clear selection.** React Flow raises selected nodes, which would mask an explicit
   "send to back"; deselecting after the action makes the result visible while keeping the
   selection elevation people like.

## Consequences

- Connections are created and rendered through the library rather than bespoke pointer math.
- Link direction is editable after the fact without redrawing the edge.
- Connector repositioning and connection gestures no longer compete for the same drag.
- Legacy edges (without `bidirectional`) are backfilled to one-way on read.
