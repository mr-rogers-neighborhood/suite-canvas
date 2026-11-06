# ADR-0095: the library is the view surface

- Status: partial (reconsidering)
- Date: 2026-11-03
- Related: [ADR-0011](./0011-library-dock-and-card-chrome.md), [ADR-0037](./0037-a-saved-view-is-a-lens.md), [ADR-0043](./0043-a-view-is-a-lens-a-database-or-a-render.md), [ADR-0047](./0047-a-view-can-be-a-card-and-an-embed-is-one-concept.md), [ADR-0085](./0085-a-view-is-a-configuration-a-layer-and-a-projection.md), [ADR-0086](./0086-a-view-is-read-before-it-is-edited.md), [ADR-0096](./0096-a-query-is-an-expression-tree-with-a-text-surface.md), [`apps/canvas/src/library/`](../../apps/canvas/src/library/)
- Shipped: a rail of saved views in the drawer header; `+ View` creates a record; selecting a view renders `LibraryViewSurface` with `FilterBar`, the shared `ViewSurface`, and `DataTable`; the system tab strip is narrowed to Inbox, Cards, Media, Annotations and Trash; `Open large` expands the drawer; `ViewsLayer`, `ViewsContextDrawer`, `SurfaceControls`, `ViewsBar` and the `viewsEnabled` switch are deleted; columns, bulk edits, add row and cell editors are built.
- Remaining: the 10k performance pass is not done.

## Decision

**The library is where a view is found and read.** A saved view is a row in the drawer's rail, beside five
code-defined system lists, and the drawer body is that view's surface. A view stops being a separate
application behind a nav icon and becomes a place in the same drawer where cards are found.

The rail is flat and ordered. A view is one record with one query and one presentation; there is no
nesting, no dashboard and no multi-presentation tab. A reader who wants a variant duplicates the view.

System lists are code, not records: Inbox, All cards, Boards, Media, Annotations and Trash always exist,
cannot be deleted, and may have a row source that is not a card. A saved view is always a query over
cards. Boards stay orthogonal — a board is a set of placements, a view is a query, projection is a verb.

Reading is read-first. `LibraryViewSurface` opens on values, with `Edit` the explicit switch for cells.
The filter bar is the one filter surface: chips are a projection of the stored expression, and `</>`
shows the same expression as text.

## Rejected alternatives

- **A resizable side pane.** The inspector already owns the right side; a second pane would compete with
  the surface it is meant to sit beside.
- **Keeping views as a full-window mode with the drawer as a list.** That is the split this record ends:
  a view was reachable only through an icon, and the library's Views tab listed view *cards*, not views.
- **Nested collections or a view tree.** Boards already provide spatial and contextual grouping; a second
  hierarchy would duplicate board navigation and add parent/child, cycle and delete semantics.
- **One container whose layouts include the canvas.** Boards are placements, not a view layout; merging
  them would make every view a potential board and every board a query.

## Amendment 2026-11-03: the layer is gone

`Open large` now sets the drawer's `full` mode, and the projection float's Open opens the library on the
projected view instead of the layer. `ViewsLayer`, its context drawer, `SurfaceControls`, `ViewsBar` and
`views/availability.ts` are deleted. The advanced predicates the context drawer held moved into the
filter bar's `More` disclosure, which edits the same expression tree. The store is down to
`libraryViewId`, the pick in flight and its base; there is no mode, draft or hidden-column state left.

## Consequences

- **One door and one reading surface.** The dock's library button, a view card and the palette all land
  in the drawer; the layer is reached only as "open large", and can retire once that path is replaced.
- **Filters are shared.** The bar writes the view for everyone; the find box and `libraryViewId` are the
  reader's own state. There is no personal filter override.
- **Boards are no longer fake cards.** The `BOARD_TYPE_FACET` row and `kind: "board"` item remain only
  until the system Boards list lands; a board row is not a card query.
- **One engine.** System card lists and saved views both use `runViewQuery`; `libraryFilters.ts` is
  deleted, and Boards, Media and Trash are explicit row sources rather than fake card types.
