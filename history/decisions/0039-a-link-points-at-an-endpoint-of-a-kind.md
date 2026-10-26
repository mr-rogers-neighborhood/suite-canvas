# ADR-0039: A link points at an endpoint of a kind

- **Status:** accepted
- **Date:** 2026-10-25
- **Related:** [ADR-0003](./0003-typed-object-graph.md), [ADR-0017](./0017-spatial-sections.md), [ADR-0019](./0019-references-not-typed-links.md), [ADR-0029](./0029-portal-board-field.md), [`packages/graph/src/links.ts`](../../packages/graph/src/links.ts), [`apps/canvas/src/canvas/linkGeometry.ts`](../../apps/canvas/src/canvas/linkGeometry.ts)

## Context

Until now `graphEdgeSchema.source` and `.target` were card ids and nothing else. Connectors were
card-only. So a user could link two notes, and could not link a note to the section it belongs to, a
board to another board, or a portal to anything at all.

Three things made the old shape untenable:

1. A portal is a card whose `board` property names another board. The clearest way to express "this
   board leads to that one" is a link between the two boards, which the record could not hold.
2. Sections are real records with stable ids and now their own connectors, but an edge could not
   point at one.
3. Every new endpoint kind was tempting to store as a second record class. That would have given the
   app three link models to keep in sync and would have broken backlink counting, undo and publish
   in ways nobody would notice until much later.

## Decision

**One edge record, with an optional kind per end.**

```ts
source: entityId, target: entityId
sourceKind?: "card" | "board" | "section"   // absent means "card"
targetKind?: "card" | "board" | "section"   // absent means "card"
```

1. **Additive, no migration.** An edge without kinds is a card-to-card link, which is what every
   existing document holds, so `ensureReferences`, portable export and publish keep working
   unchanged. `edgeEndpoints(edge)` is the single place the default is applied.
2. **A thing may link to itself through two different connectors.** A card or a
   section joining one of its own connectors to another draws a loop on the canvas. It
   means nothing semantically — a card is not related to itself, so nothing appears in
   its References — and it is allowed on purpose, because the gesture is obvious and
   refusing it reads as a bug. Two ends on the *same* connector are still refused: that
   is a zero-length link, not a loop.
3. **The kind is what makes an endpoint legal.** `addEdge` refuses an endpoint that does not exist
   in the workspace, and refuses a thing linking to itself *at the same kind*. A card and a section
   that share an id are different endpoints.
4. **Identity is the connection, not the row.** Two links between the same two endpoints on the same
   connectors are one connection, in either direction (`linkKey`). Drawing it twice is a no-op
   rather than a second record.
5. **A board endpoint is drawn through a portal.** A board has no position. Its rect on a board is
   the rect of the first portal card on that board pointing at it. No portal means no line — but the
   link stays in the document and in the inspector, which is what lets a link survive its portal
   being unplaced.
6. **Resolution is pure and separate from rendering.** `linkGeometry.ts` turns endpoints into rects
   and anchors with no React and no store, so the canvas, drag previews and tests share one answer.
7. **Deleting a container deletes links that point at it.** Deleting a board removes the links it
   owns (its placements' links, as before), links to the board itself, and nothing else.

## Rejected alternatives

- **Two link systems** (card edges plus a separate container-link record). Two owners of "who
  relates to whom" means backlinks, undo, publish and the reference index each need two code paths,
  and the second one is always the one that rots.
- **Containers become cards.** Would give a board a body, a title editor and a trash state it does
  not want, and would contradict [ADR-0010](./0010-workspace-boards-and-cards.md) — a board is a context, not
  content.
- **Resolve a board endpoint to a fixed coordinate.** Any coordinate is a lie the moment the portal
  moves. Anchoring to the portal instance is the only honest anchor.
- **Bake the resolution into `CanvasBoard`.** It would have made thread mode, drag previews and
  tests each re-derive geometry slightly differently.

## Consequences

- **Sections gain connectors** (`sectionSchema.connectors`), written with the same
  `{id, x, y}` shape and merge-safe nested map cards use. Sections are drawn in `SectionLayer`, not
  as React Flow nodes, so their dots are rendered there.
- **`listBoardEdges` resolves per kind.** A card endpoint must be placed on the board, a section
  must be on it, and a board endpoint needs a portal. Dormant links stay dormant, exactly like the
  card case that already shipped.
- **`references.arrowSources` counts card endpoints only.** A link to a board is not a backlink row
  on a card; conflating them would inflate the header chip.
- **`deleteBoard` gets an explicit card policy.** It previously trashed *every* card in the
  workspace that had no remaining placement, which was wrong for any multi-board workspace. It now
  trashes only cards that were on the deleted board and have nowhere else, which is the behaviour
  the library's "unplace" flow needs.
- **A link can outlive its target's visibility.** That is the point, and the inspector has to render
  a dangling link as disabled rather than hiding it.
