# ADR-0043: A view is a lens, a database or a render

- **Status:** accepted
- **Date:** 2026-10-25
- **Related:** [ADR-0037](./0037-a-saved-view-is-a-lens.md), [ADR-0003](./0003-typed-object-graph.md), [ADR-0019](./0019-references-not-typed-links.md), [ADR-0041](./0041-alpha-core-is-a-closed-feature-set.md), [`packages/graph/src/views.ts`](../../packages/graph/src/views.ts)

## Context

ADR-0037 made a saved view a **lens**: applying it selects the cards a query matches and dims the rest,
in place, on the canvas.

The author's note asks for two more presentations of the same thing:

> In "Views", have "Lens" and "Database", and "Render" views/modes? So you can use the lens system,
> view/edit your library and properties and create sorted database tables etc, and then render rich
> 2d/3d data visualizations, from your canvas/card data.

Three presentations, one question. The risk is obvious: three query languages, three matchers, three
answers to "which cards are in this view". ADR-0037 already fought that battle once, when the library
kept its own facet matcher next to the engine.

## Decision

**A view is a saved query plus a presentation kind.** The query is shared; the presentation is not.

1. **One `ViewQuery`, evaluated by `runViewQuery`.** A lens, a database and a render ask the same
   function the same question. There is no second matcher and no per-kind predicate language.
2. **`kind: "lens" | "database" | "render"` on the saved view.** The kind changes how the result is
   shown, never which cards are in it. Switching kind on an existing view keeps the query.
3. **A lens paints the board.** The result is *highlighted in place*: matching cards stay live and the
   rest dim. This is ADR-0037, unchanged, and remains the default kind.
4. **A database is a table.** Rows are the result; columns are the fields the query's types declare
   plus a fixed identity column. Cells are editable where the underlying field is editable, and an edit
   is the same `WorkspaceDocument` mutation the inspector uses. Sorting and grouping are query
   properties, so a database view and a lens over the same query agree row for row.
5. **A render is a visualization.** The result is drawn as a chart or as a graph — 2D first (bars,
   counts over a group field, a diagram of links among the result), 3D only once the 2D shape and the
   data contract are settled. A render is read-only by default; it is a *reading* of the workspace, not
   another editor.
6. **Kind-specific options are additive and namespaced.** A database view may carry column widths and
   a frozen column; a render may carry a chart type and an axis mapping. These live in the view record
   and never leak into `ViewQuery`, so the shared part stays shared.
7. **Views stay UI-adjacent records, not derived data.** A saved view is stored on the document (it is
   shared state: two people should see the same saved views), but the *result* is always derived on
   read. Nothing caches a result set.

## Rejected alternatives

- **A separate query builder per kind.** Three ways to ask one question, and the first divergence is
  permanent. This is exactly the drift ADR-0037 deleted.
- **A database as a second library.** The library is a drawer for finding a card; a database view is a
  table over a saved question, with the query visible and editable. Merging them would give the library
  a query editor and the database a dock.
- **Render first, or render as the headline.** A visualization is only as good as its query; building it
  before the table exists means inventing the data contract twice.
- **3D from the start.** 3D graph layouts are a rendering project, not a data one. The data shape
  (nodes, edges, a value per node) is identical to the 2D diagram, so 2D proves it first.
- **Cache results for speed.** A cached result is a second source of truth that goes stale on a peer's
  edit. The query is cheap; the document is the truth.

## Consequences

- **`savedViewSchema` gains `kind` plus an optional options bag.** Additive: an existing view with no
  kind reads as a lens, so no migration is needed.
- **The Views menu becomes a list of views grouped by kind**, and creating one asks for the kind before
  the query.
- **The database presentation reuses the inspector's field rendering.** A cell editor that disagrees
  with the inspector is a bug, and sharing the component is the only way to keep them honest.
- **A render needs a small chart layer.** It is the last of the three because it needs both the query
  and a settled column model from the database view.
- **`libraryFilters.ts` must be folded into `runViewQuery`** before a database view ships, or the
  library and the table will disagree about the same filters.
