# ADR-0019: References, not typed links

- **Status:** accepted
- **Date:** 2026-10-21

## Context

The semantic-model plan ([ADR-0014](./0014-semantic-model.md), `docs/design-inspirations.md` §4.4)
called for splitting `edges` into workspace-level **relations** and board-level **edge placements**,
with relation types as workspace records. The argument was that a drawing and a statement are
different things, and that typed relations are the semantic core of a PKM.

Reviewing the reference product changed that conclusion. Heptabase — the closest model for a
canvas-first PKM — deliberately has **no link types**:

- Whiteboard connections are untyped arrows whose only semantics is a free-text **description**
  (`v1.34.2` "Fix the issue where users cannot edit the connection description"; double-click to
  edit it).
- Meaning comes from three other places: **`@` mentions** in card text, which produce block-level
  backlinks (`v1.31.0` "Backlinks from Text Properties / Elements / Nodes / Arrows / Sections");
  a **Relation Property** whose *name* carries the semantics (`v1.30.0`); and tags, properties and
  sections.
- **A mention never draws a connection.** Backlinks are a reference list, not a placement, so
  "which board would this link be drawn on?" never arises. A drawing is an opt-in spatial act.

The second argument is about payoff. A link-type registry only earns its cost once something
*queries* the types: "everything that contradicts X", dashboards grouped by relation, relation
columns in a table. Suite has no views or queries yet. Until it does, a type picker adds a decision
to every drawn link, a settings surface to maintain, and an invitation to constraint thinking
(allowed source/target types) that users must then keep true — with nothing to show for it.

The same meaning is available today at zero per-link cost: **name the property**. A field called
"Contradicts" pointing at a card says more than a colour-coded arrow, and it is index data, so a
future dashboard can filter on it without opening a body.

## Decision

1. **No relation types, no constraints, no relation records.** `edges` stay board-scoped drawings.
   They gain a free-text **description**, editable by double-clicking the arc or from the edge menu.

2. **References are workspace-level and come from content.** `@` inserts a mention atom in a title
   or body. A derived index `references.<fromCardId>` records which cards that card mentions, so
   backlinks are O(1) to start from and never a second source of truth.

3. **The index is derived, rebuildable and non-undoable.** Every client maintains it from document
   changes (origin `struct:index-refs`, skipped by the same listener to avoid recursion, coalesced
   per frame). It is never hand-edited, never included in an undo step, and `rebuildReferences()`
   can reconstruct it from content.

4. **Backlinks are read-only and unioned at read time** from: mentions, `card`-valued properties,
   board/section appearances, and arrows touching the card. Nothing is stored twice, and no
   backlink cache exists outside `references`.

5. **A `card` field kind carries user-defined semantics.** The field's name is the relation type.
   Values may dangle (a trashed or purged card renders as unavailable) rather than blocking writes.

6. **Semantic links never create placements.** A mention, a property value or a backlink is a
   reference. Only dragging a card onto a board (or placing it from the Library) creates a placement.

7. **A property block in the body is a view, never a store.** It holds a `fieldId` and writes
   through `setProperty`/`clearProperty`; deleting the block deletes the view. Property values stay
   in the card index so facets, queries and dashboards never parse rich text.

8. **No schema writes from the editor.** Field creation stays in type settings, because the body
   editor's undo stack deliberately excludes structural origins; allowing it there would produce an
   "I inserted something and undo did not remove it" failure.

## Consequences

- The typed-relations plan is not implemented; `edges` are unchanged and there is no migration and
  no schema bump.
- "What links here?" becomes answerable from four sources with one panel, and every row navigates.
- Adding relation types later remains possible **without a migration**: if a query layer arrives and
  typed links earn their cost, a `relationTypeId` can be added to `edges` as a field, with derived
  backlinks unchanged.
- The body editor gains atoms (`mention`, later `date`) and, behind the same mechanism, inline
  property views. The atom round-trip is covered by `apps/canvas/src/editor/loroAtom.test.ts`.
- Heptabase-style affordances we did not build yet stay deliberately out: dragging a mention onto a
  board to place it, unlinked mention detection, and block-level backlinks inside a single card.
- The undo split (structural vs per-editor) is confirmed rather than unified; the ADR records why
  (predictable per-surface history) and the rule that keeps it from surprising users.
