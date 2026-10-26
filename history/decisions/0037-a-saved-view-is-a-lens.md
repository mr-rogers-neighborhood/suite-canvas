# ADR-0037: A saved view is a lens over the canvas

- **Status:** accepted
- **Date:** 2026-10-25
- **Related:** [ADR-0003](./0003-typed-object-graph.md), [ADR-0019](./0019-references-not-typed-links.md), [`packages/graph/src/views.ts`](../../packages/graph/src/views.ts), [`apps/canvas/src/canvas/useCanvasLens.ts`](../../apps/canvas/src/canvas/useCanvasLens.ts)

## Context

A saved view was a query that opened the library drawer. `applyView` copied the query into the
library's own facet state and set `libraryOpen`; the canvas never heard about it. So "show me the
characters with no owner" produced a list in a panel while the board behind it kept looking exactly
the same.

Two problems followed from that. The library grew its own matcher (`libraryFilters.ts`) next to the
engine in `@suite/graph`, and a user had to translate a spatial arrangement into a list to answer a
question the canvas could have answered in place.

## Decision

**A saved view is a lens over the canvas.** Applying one selects cards *and* marks the rest.

1. **One evaluator.** `runViewQuery` in `@suite/graph` is the only matcher. The lens calls it with
   the active board; the library and the Views menu call the same function. A view cannot mean two
   things.
2. **Dim, never remove.** Off-lens cards keep their position, their interactions and their editor;
   they recede to `--lens-dim-opacity`. The spatial context is the point of a canvas, and hiding it
   would make the lens a filter that destroys the arrangement the user built.
3. **Sections and edges follow their members.** An arrow dims when either endpoint is off the lens;
   a section dims when none of its cards is on it. Neither is removed.
4. **A lens is UI state.** `activeViewId` already existed; no `lens` field is written to the
   document and no result set is stored. `exitView` clears the lens with the view.
5. **Derived indexes may be repaired, never written by the query.** `backlink` and `relation`
   predicates read the derived reference index; the canvas calls `ensureReferences()` in an effect
   while a lens is on, so the query itself stays a pure read.

## Rejected alternatives

- **Filter the board instead of dimming.** Removing cards breaks the geometry the user arranged,
  moves sections, and makes an accidental lens feel like data loss.
- **A second matcher for the canvas.** Exactly the drift `docs/roadmap/v2.md` §3.6 calls a bug in
  one engine.
- **Store the lens on the board.** A lens is a question, not a property of the document; two people
  in one workspace are allowed to ask different ones.
- **Make dimming a lock.** Dimmed cards stay clickable and draggable. A reading aid that blocks
  editing would be a mode, and modes are what this ADR is trying to avoid.

## Consequences

- **A view finally changes the board.** The app bar shows the lens name and a one-click exit, the
  same affordance the library already had.
- **`CardNodeData.dim` is part of the card's identity.** The canvas reuses a card's data object when
  nothing visible changed, so `dim` must join that comparison; a stale `dim` would leave the lens
  painted on the wrong cards.
- **The query schema had to grow** for a lens to be worth looking at: property, presence and
  relation predicates, plus text scope. That work is `viewPredicates.ts` and it is shared with the
  library's future filters.
- **`libraryFilters.ts` still carries its own facet matcher.** Converting the drawer to
  `runViewQuery` is a separate change with its own e2e surface; until then the two must agree, which
  is a test rather than an assumption.
