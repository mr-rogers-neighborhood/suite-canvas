# ADR-0041: A link may end on a Board

- **Status:** accepted
- **Date:** 2026-10-24
- **Related:** [ADR-0039](./0039-boards-are-containers-views-are-cameras.md), [ADR-0035](./0035-views-pins-and-portals.md), [ADR-0034](./0034-ice-primary-rendering-engine.md)

## Context

A link has always joined two cards: `graphEdgeSchema.source`/`target` name cards, and
`listSubtreeEdges` resolves each end to a placement before the surface draws it. That made
"this card leads to that card" expressible and nothing else.

The canvas is read from above as well as inside. The question a reader asks at the plane is *"which
Board does this belong to, and what does this Board relate to?"* — an Atlas board pointing at the
Sources board, a card pointing at the frame it should move into. With card ends only, none of that is
sayable, and the two workarounds both defect:

- **A hidden portal card per Board.** It fabricates document content that the reader never made,
  duplicates the Board's identity, and has to be kept in step with renames and deletes.
- **A link to "any card inside the Board".** It picks one card arbitrarily, so the relation is really
  to the frame but is stored as a bet on a card staying placed.

## Decision

A link end may name a **Board** instead of a card, and the schema says so per end
(`sourceKind`/`targetKind`, absent = card, so every existing edge reads unchanged — additive-first):

- **The flag is per end and optional.** `sourceKind: "board"` alone, with the Board's id in
  `source`, is a frame end; a link may have one, both or neither.
- **A Board end attaches to a wall, not a connector.** A frame has no perimeter to hang a connector
  on. The anchor is the midpoint of the side facing the other end (`boardSideAnchor` in
  `@suite/graph`), recomputed every frame from the two ends' middles — which is also why the anchor is
  *not* stored: it is a reading of the two rects, and storing it would let a moved frame disagree with
  its own link.
- **Resolution is by plane.** A card end is present when its placement is on the plane being drawn; a
  Board end is present when the frame itself is on that plane (`listBoardEdges` reads a Board's
  children as its plane's frames, `listSubtreeEdges` reads the subtree). An end that is not present
  leaves the link dormant rather than deleted, like any other off-plane end.
- **Publishing carries the flag.** `edgeFields` and the publish comparison include the kinds, so a
  re-ended edge is one endpoint change rather than a delete and a create.
- **ICE draws it from the wall.** The surface hands each end to `suite.edge` either as a card
  (placement + connectors) or as a frame (`boardId`, resolved to a world rect on every `sync`), and
  the kind aims a frame end at the other end's middle.

## Consequences

Easier: the Board tree is linkable at every level — Board↔card, card↔Board, Board↔Board — and the
gesture is the one that already exists (the dots a card offers are now the four wall midpoints a frame
offers). The endpoint flag costs two optional fields and two comparisons, and a predicate
(`edgeEndsPlaced`) that every reader of edges shares.

Harder, and knowingly accepted:

- **A grabbed wall is not necessarily the wall drawn.** The link leaves the side *facing* the other
  end, not the side the reader dragged from. Storing the grabbed side would be a second field and a
  second authority over the same reading; the derived rule is one rule.
- **A link into a frame is not drawn inside it.** A card inside Board A linked to Board A itself has
  its ends on two planes; it draws on the ancestor plane (from the card's world anchor to the wall).
  Drawing it *clipped at the wall* from inside is the next slice, not this one.
- **`dormant` edges still accumulate.** A link whose frame is deleted hides and revives; removing it
  is the reader's call.
