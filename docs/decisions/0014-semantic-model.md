# ADR-0014: Semantic model — types, fields, relations, sections and views

- **Status:** accepted; types, fields, tags and properties implemented by [ADR-0016](./0016-semantic-core.md)
- **Date:** 2026-10-21

## Context

The current model is flat: a card has a closed `kind`, a free-text body, and `edges` that are both
a semantic statement and a board drawing, scoped to one board. That is enough for a canvas and not
enough for a thinking tool. It cannot answer "what is this?" or "show me every project", so
retrieval stays spatial: a card is only findable if you remember which board you put it on.

Adding types naively creates the opposite failure. Every new kind of thing (person, meeting,
project, paper, journal) would bring its own ad-hoc properties and its own ad-hoc links, and each
board would assign its own meaning to a connector. Properties would drift per card, no query could
be written once, and the number of special cases would grow combinatorially with the number of
object kinds. A type has to be strong enough to define fields and drive dashboards, yet light
enough to apply while writing.

The tools we borrow from show the two ways this goes wrong. A uniform "everything is a node" graph
makes "object" and "placement" indistinguishable. Layout-driven tools (Semantic Canvas-style)
project board structure back into card properties continuously, so moving a card rewrites it and
two collaborators fight over fields neither meant to edit.

What we need: typed objects, typed links that exist independently of where they are drawn, and a
shell that organizes itself from the graph — without turning the core into a CMS. The full
direction is in [design-inspirations.md](../design-inspirations.md); this ADR records the decisions
that are confirmed.

## Decision

1. **One schema-bearing primary type per card, plus freeform tags.** A card stores exactly one
   `typeId`; types own field definitions, defaults and affordances. Tags are workspace records with
   a name and optional colour, and a card may carry many; they are labels without schemas, used for
   retrieval, never for validation. Multiple supertags are **deferred and additive**: the migration
   is `typeId` → `typeIds` with property values namespaced by field id. The first model must not be
   ambiguous, so one type validates a card, owns its dashboard and decides its required fields.

2. **Fields are structured scalars only.** A field definition has an id, name, kind, required flag,
   default and kind-specific options. The supported kinds are text, number, date, select,
   multi-select, checkbox and relation. There are no arbitrary per-card property keys: a card's
   `properties` map is keyed by field id and may only contain fields its type declares.

3. **Field values are field-granular.** `properties` is a `Y.Map` with one key per field, and an
   update writes that one key. A whole-record write would resolve two people editing different
   fields last-write-wins for all of them, which is the failure
   [ADR-0012](0012-field-granular-records.md) removed for cards. The same rule covers tags (one key
   per tag id, so concurrent add/remove of different tags never clobbers) and every record family
   below.

4. **A relation is a workspace-level typed statement.** `relations` holds `id`, `relationTypeId`,
   `fromCardId`, `toCardId`, optional typed properties and `createdAt`. A relation exists whether or
   not any board draws it; it is therefore not scoped to a board and not created by drawing.

5. **Relation types are workspace records, not a closed enum.** A relation type defines its label
   and inverse label, directed/symmetric behaviour and optional constraints (allowed source and
   target types, cardinality). "References", "relates to" and "tagged" become seeded relation types,
   so adding "contradicts" needs no schema release. A label on a drawing is a display override, not
   the semantic type.

6. **Relation fields are views, never copies.** A relation field is a typed query over the relation
   store. Relation targets are not duplicated into card properties, and backlinks are derived from
   relations; two stores would drift and need reconciliation.

7. **An edge placement is how a relation is drawn on one board.** `edgePlacements` holds `boardId`,
   `relationId`, `sourceConnector?`, `targetConnector?`, `path`, `bidirectional`, optional label
   override and `z`. This mirrors cards/placements: at most one placement per (board, relation), so
   "the drawing of this relation on this board" stays unambiguous. Unplacing a card suspends
   drawings whose endpoint is absent — today's dormant-edge behaviour — without deleting the
   relation. Deleting a relation deletes its placements; deleting a board deletes only its
   placements. Several relations of different types may connect the same pair of cards.

8. **Sections are board-local spatial containers with derived membership.** A section stores
   geometry and presentation only (`id`, `boardId`, `title?`, `x`, `y`, `width`, `height`, `z`,
   `color?`). Membership is computed from placement geometry at read time — topmost section by `z`,
   then smallest area, so a card belongs to at most one section — and is never written to the card
   or the placement. An explicit, idempotent **apply section as tags/properties** command may
   project a section once and report what it changed; that is a command, not a live projection loop.

9. **Views are workspace-level saved queries.** A view stores its name, filter AST, sort, optional
   group-by, presentation and optional pinned board. Results are read-only projections evaluated
   from stored facts; a view never owns its result set and never writes to a card. Applying a view's
   result as tags or placements is an explicit command, like applying a section.

10. **Groups are not a fourth object type.** A group is a section when it only groups spatially. If
    something must have identity, content or its own links, it becomes a card — a group/MOC card
    kind — later. Adding a container type now would recreate the object/placement ambiguity.

11. **Derived facts are never stored as authority.** Home board (oldest placement), section
    membership, view results, backlinks and relation-field values are computed. A stored copy is a
    cache with an invalidation problem, allowed only if it is discardable and rebuildable from the
    stored facts.

12. **Publishing is a projection over types and relations.** Routes, slugs, templates and web
    taxonomies are not card properties, because they exist only for a website and would constrain
    reuse. Publication state (draft/published/unlisted) belongs to a publication record keyed by
    card id in a separate layer, and the core exposes a deterministic, versioned bundle.

13. **The card document is the ACL boundary; the index holds summaries.** Card-level sharing is a
    core requirement, so the semantic model assumes that title, `typeId`, tags and scalar properties
    are indexable and live in the workspace index, while body rich text lives in the per-card
    document. This is the target split recorded separately (ADR-0013, once written); title stays in
    the index as a deliberate exception so library rows and queries never load a body.

14. **Relations and edge placements are field maps too.** Both are stored as nested `Y.Map`s with
    one key per field: changing a relation's endpoint, its label or a drawing's connectors are
    independent keys. Whole-record writes are reserved for seeding and migration, exactly as in
    [ADR-0012](0012-field-granular-records.md).

**Scope.** This ADR records the target model. Sections, views, relations and edge placements are
still target. Types, fields, tags and properties are implemented by [ADR-0016](./0016-semantic-core.md),
which also records the storage decision (type membership as a merge-safe set plus a primary id).
Today's board-scoped `edges` conflate statement and drawing. The migration will turn each edge into a relation (its
endpoints, its `kind` mapped to a seeded relation type, its label) plus an edge placement (board,
connectors, path, bidirectional as an arrowhead option). Identical relations created on different
boards are not auto-deduplicated; merging them is an explicit user action.

## Rejected alternatives

- **Multiple supertags first.** It makes the first model ambiguous: which type validates the card,
  which dashboard owns it, what happens when two types define `status` differently, and which
  fields are required. One type plus freeform tags covers the same retrieval need; `typeIds` can
  arrive additively with namespaced property values.
- **Live section-to-property writes.** Dragging a card would rewrite the card, so layout would
  become a silent schema mutation and two collaborators would conflict over fields neither edited.
  Projection is an explicit command.
- **Duplicating relations into card properties.** An id array beside the relation store drifts on
  every delete, re-target and concurrent edit, and backlinks then need reconciliation between two
  truths.
- **Everything-is-a-node.** A uniform node graph makes "object" and "placement" ambiguous: a
  relation would become a card that still needs a drawing, and nothing would say which node owns a
  schema.
- **Making sections and views one concept.** They differ in scope (board vs workspace), in the
  source of membership (geometry vs query) and in what may write. Merging them forces one to fake
  the other's semantics.
- **Storing view results, backlinks or section membership.** A stored result is a cache that goes
  stale and lies silently.
- **A hard-coded relation `kind` enum.** Every new verb would need a schema release, and users
  could not name their own relationships; relation types as records avoid that.

## Consequences

- **Migration.** A schema bump converts `edges` into relations plus edge placements, maps the
  closed card `kind` to a seeded type, and seeds the built-in relation types. It must be
  deterministic and safe to run twice, and must not stamp a version on a document that has not
  hydrated, following ADR-0010/ADR-0012. Existing drawings survive as placements; duplicate
  statements remain until merged by hand.
- **UI.** The card inspector becomes the home of type, fields, tags, relations, backlinks and
  placement references. The footer's keyed sections (ADR-0011) are the seam. Boards render edge
  placements joined to relations, so link menus act on the drawing for layout and on the relation
  for meaning and deletion. Type dashboards and the view builder read the index, not card bodies.
  Section and apply commands need visible, undoable effects.
- **Queries.** Views evaluate over index summaries without loading a card document. Relation fields
  and backlinks evaluate over the relation store. Filters reference field ids, so renaming a field
  or a relation type rewrites no cards. Derived values are recomputed, never cached as truth.
- **Concurrency.** Per-field maps mean independent edits merge: two people can retarget different
  relations, add different tags, or edit different properties of one card. Concurrent additions of
  the same relation produce duplicates rather than a lost write, which is acceptable and dedupable
  by command. Section moves write `x`/`y` only; apply commands are idempotent, so running one twice
  is harmless.
- **Remains open.** The supertag rule for required fields, conflicting field kinds and dashboard
  ownership; whether one relation may have more than one drawing per board; section overlap and
  nesting; whether relations carry typed properties in v1; whether relation types are seeded or
  fully user-defined; the index/card-document split and its cross-document sequences (ADR-0013);
  and board-level sharing. These are recorded in
  [design-inspirations.md §11](../design-inspirations.md#11-open-questions) rather than resolved by
  implication.
