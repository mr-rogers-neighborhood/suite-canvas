# ADR-0085: a view is a configuration, a layer and a projection

- **Status:** accepted
- **Date:** 2026-10-31
- **Related:** [ADR-0037](./0037-a-saved-view-is-a-lens.md), [ADR-0043](./0043-a-view-is-a-lens-a-database-or-a-render.md), [ADR-0047](./0047-a-view-can-be-a-card-and-an-embed-is-one-concept.md), [`packages/graph/src/views.ts`](../../packages/graph/src/views.ts), [`apps/canvas/src/views/ViewsLayer.tsx`](../../apps/canvas/src/views/ViewsLayer.tsx)

## Context

ADR-0043 made a view three presentations of one query, and the first pass at building them treated the
three as peers: a lens was a kind beside a collection and a render, the editor was a panel, and "applied"
lived in two places at once. The author's note named the problem: views felt cluttered because one object
was being dressed as three, and "the view layer" was a layer of the product that had no layer.

## Decision

**A view is a configuration with two surfaces.**

1. **The configuration is shared.** A view's context, kind and presentation are document data. A view card
   holds only the id, so editing the view redraws every card that names it, for everyone. That is the
   existing card semantics, applied to a new object.
2. **A projection is not.** Which view this reader has cast over their board is a reading position: per
   browser, per workspace, remembered across reloads, and never written. Two people on one board should
   disagree about it exactly as they disagree about the camera.
3. **Projecting is a verb, not a kind.** `kind` answers how a result is read (`collection` or `render`).
   Any view can be projected. `"lens"` survives only as a parse-compatible legacy value, read as a
   collection, whose payload supplies a projection's default board and toggles.
4. **The layer is a mode.** A view is read in a full-window surface with its own chrome: a rail of saved
   views with live thumbnails, the presentation, a context drawer, and a picking state where the layer gets
   out of the way so cards can be chosen on the board.
5. **Editing a saved view is live.** The layer writes through field-level setters, so concurrent edits to
   different facets converge. There is no Save and no lock: `Done` leaves, `Discard my edits` restores the
   opened record as a visible write. A **new** view is a local draft until `Create`.
6. **No locking for schemas either.** Types already merge per field. A lease would add an expiry and
   takeover protocol and would still miss the case that matters — two people in one editor with a stale
   view of the schema. The guards belong to the operations: removing a field reports what it holds, a kind
   change asks, duplicate names are flagged, and undo and history are the recovery.

## Rejected alternatives

- **Projection saved on the view.** It would make a reader's reading position a shared edit, so one person
  projecting a view would fade everyone's board. The author asked for exactly the opposite.
- **A lease on the whole record.** It prevents simultaneous editors and not simultaneous *mistakes*, and a
  lock that outlives a closed tab is worse than the conflict it prevents.
- **A panel instead of a mode.** Tried: a 560px sheet whose live preview sat behind it for two of the three
  kinds. A view is a surface, so it gets the window.
- **Keeping `lens` as a kind beside projection.** Two ways to say "show these cards on the board", and no
  way for a collection to use the good one.

## Consequences

- **One object, two renders.** The layer and the projection read the same `SavedView`; nothing needs to be
  kept in step, and a view card is a third reader of the same record.
- **The library stops being filtered by a projection.** Its filters are the reader's own, which removes the
  second source of "what is applied".
- **A saved view is a live document.** Two people in one view see each other's edits land, and a discard is
  a write everyone sees. That is the price of having no locks.
- **The view field kind stays unwired.** ADR-0047 imagined a card pointing at a view; the layer is the
  authoring and reading surface, and a view card already presents one. Wiring the field is a separate,
  smaller decision about the inspector's shape.

## Amendment 2026-10-31 (a later pass): the layer got a mode, and picking joined the projection

[ADR-0086](./0086-a-view-is-read-before-it-is-edited.md) amends this one in four places. The layer's single
undifferentiated state became read and edit, with read as the default. Picking stopped being a fourth surface
with its own bar and became a projection being built, run through the same float that explains a cast view.
That float replaced the bar at the bottom of the board, which had been sitting behind the dock. And
`duplicateView` and `deleteView` are now reachable from the rail, which is where a record's verbs belong.

What stands from this record: configurations are shared, states are not; a saved view is edited field by
field; a new view is a draft until Create; and there is no locking anywhere, because the expensive conflicts
are deletions and those need a semantic guard rather than a lease.
