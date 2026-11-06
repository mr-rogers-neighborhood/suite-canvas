# ADR-0023: Selection projections share part of a board

- **Status:** accepted
- **Date:** 2026-10-23
- **Related:** [ADR-0022](./0022-share-projection-links.md), [ADR-0017](./0017-spatial-sections.md), `docs/architecture.md`

## Context

People want to share part of a board — the three cards that matter for a conversation — without
duplicating the workspace or handing out the board. The two existing scopes both miss: a board share
exposes every card on the board, and a card share loses the arrangement that made the cards worth
showing together.

The projection seam already rebuilds a self-contained subset of the workspace into its own room.
A board projection is a filtered copy of the workspace document; filtering it again by an explicit
set of card ids changes which cards are copied, not the boundary. The room, worker, publish and
revocation paths are inherited unchanged.

## Decision

1. **A selection share is a viewer-only board projection over fixed card ids.** It takes its place
   beside workspace, board and card. The ids are chosen when the link is created and stored with
   the share; there is no editor role in this phase.
2. **Sections travel automatically.** Membership is derived from geometry — `cardAnchor` and the
   smallest containing rectangle — so the projection copies every section whose rectangle contains
   a selected card's anchor, plus that section's ancestors. No multi-section selection UI is built:
   a section's presence follows from the cards the user picked.
3. **The id set is a fixed snapshot.** It is not re-evaluated against the board. Adding or removing
   a card means creating a new link, so a link keeps meaning what it meant when it was shared.
4. **References keep real titles with a "not shared" marker at the boundary.** A mention or
   property link between two selected cards stays live and navigable. A reference to a card outside
   the selection renders as an inert chip carrying the title the projection holds plus a "not
   shared" marker: the *shape* of the link is revealed, the card's contents and id-addressable
   identity are not.
5. **The real board id, name and geometry are preserved.** The projection is not a synthetic
   board; the viewer sees the same arrangement as the owner, with the unshared cards missing.

## Consequences

- **What the holder learns:** the selected cards and their content, the geometry of the sections
  those cards occupy, the titles of the outside cards they reference, and how many cards are
  selected.
  The ids of the selected cards are not returned to a link holder — only a count. The workspace id
  is never given to the holder; the projection room stands in for it.
- **What the holder cannot do:** write anything. The canvas is read-only — no drag, connect,
  delete or inline editing — and the share cannot be exchanged for a workspace link.
- **Sections are not resized or moved**, so membership inside the share is exactly the selected
  subset. A section that contains no selected card is absent; the viewer sees the owner's
  arrangement with the unshared cards missing.
- **Edges are copied only when both endpoints are selected.** An arrow to an unselected card does
  not appear, so its existence is not revealed.
- **Limits:** at most 200 card ids per selection share, enforced where the link is created. The
  100-active-shares-per-workspace cap is unchanged.
- **The editor role is deliberately deferred**, for two reasons. "Remove from board" in an editor
  draft means removing the owner's real placement, so a curated subset would shrink itself as
  editors tidy it. And a card the editor creates is not in the stored selection, so it would vanish
  from their own link after publishing. Neither is solvable without changing what a selection means,
  which this phase does not do.
