# ADR-0012: Field-granular CRDT records

- **Status:** accepted
- **Date:** 2026-10-22

## Context

Workspace records were stored as whole values: `cards.set(id, card)`, `placements.set(key, placement)`,
`edges.set(id, edge)`. Yjs merges *values*, not object properties, so two clients that edited
different parts of one record resolved last-write-wins for the entire object.

This was not theoretical. With two clients on one connector, client A moved a connector while client
B added a different one; both wrote the full card, one write won, and the other client's change
vanished with no error. The same applied to a card being dragged (x/y) while its peer resized it
(width/height), and to `moveLayer`, which rewrote a range of placements as whole records.

The granularity we already promise elsewhere is finer than that: presence streams drags, resizes,
connector moves, and link drags at ~25 Hz, and nothing about the persisted shape should contradict
what a user sees while dragging.

## Decision

Store every record as a nested `Y.Map` of fields, one key per fact:

- `cards` / `edges`: `Y.Map<Y.Map<unknown>>` keyed by record id.
- `placements`: keyed by `${boardId}/${cardId}`, same nested-field shape.
- `cards.connectors`: a `Y.Map<Y.Map<unknown>>` keyed by connector id, so moving one connector and
  adding another are independent keys — not elements of one array.

Reads materialise typed objects (`cardFromFields`, `placementFromFields`, `edgeFromFields`) so the
rest of the app keeps working with `Card`/`Placement`/`GraphEdge`. Writes go through field-level
operations: `mutateCard`, `mutateEdge`, `updatePlacementPosition`, `updatePlacementSize`,
`moveConnector`, `addConnector`, `removeConnector`, `reconnectEdge`. `setCard`/`setEdge` survive only
as whole-record escape hatches for seeding and migration.

`schemaVersion` becomes 2 and `migrateRecordsToFieldMaps` rewrites v1 documents in place. Migrations
still refuse to stamp a version on a document with nothing to migrate, because that may just mean
this client has not hydrated yet.

Two supporting invariants came out of the same audit:

- Materialising a card must never mint data. Default connectors are written at creation; a read that
  synthesised connector ids would hand out new handles on every render and orphan every link.
- A link whose connector no longer exists cannot be drawn, so deleting a connector deletes its links
  and `listBoardEdges` also filters such links out of older documents.

## Consequences

- Concurrent edits to different fields of one record merge instead of clobbering each other; the
  regression suite drives two documents through conflicting edits and asserts both survive.
- `observe` reports per-field changes (`section`, `action`, `key`, materialised `value`) and now uses
  `observeDeep`: top-level keys give add/delete, nested events give updates.
- Record values are no longer reference-stable — every read materialises a new object, so selectors
  must compare by id or by value rather than identity.
- Storage is slightly larger (one map per field), which is the price of per-field merging.
