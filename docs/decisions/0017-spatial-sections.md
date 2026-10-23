# ADR-0017: Spatial sections

- **Status:** accepted; rendering amended by [ADR-0030](./0030-scene-projection-lod-and-real-portals.md)
- **Date:** 2026-10-21

> **Amendment (2026-10-23, [ADR-0030](./0030-scene-projection-lod-and-real-portals.md)).** The
> geometry model stands unchanged: a section is a stored rectangle, membership is derived from the
> header anchor, and nesting is derived by containment. Rendering point 8 describes one surface, not
> the contract: sections project as `SectionInstance`s in the derived scene, so the same background
> band and header layer paint on any `SceneSurface` and inside every board instance — including a
> live portal. Membership is recomputed per board, so the same card can be in different sections in
> different instances.

## Context

A board now contains typed objects, but no way to organize them spatially beyond individual
positions and connector links. The reference tools disagree about what a "group" is:

- **Obsidian Canvas groups** are containers. They own children, move them, nest, and can delete
  them. Membership is structural.
- **Heptabase sections** are labeled regions. Cards stay independent objects; membership is a
  consequence of where they sit, and the whiteboard can show a section outline.

Suite already rejects board-owned cards ([ADR-0010](./0010-workspace-boards-and-cards.md)) and treats
board state as a projection. A container that owns cards would reintroduce the coupling the product
is built to avoid. That makes the word **group** the wrong abstraction, not just the wrong label.

## Decision

1. **A section is a labeled rectangle on one board.** It stores `id`, `boardId`, `title`, geometry
   (`x`, `y`, `width`, `height`), `z`, an optional palette colour and timestamps. It never stores
   card ids, and no card or placement stores a section id.

2. **Membership is derived from geometry.** A card's anchor is its top-left header point
   (`x + 8`, `y + 8`). It belongs to the **smallest section containing that anchor**. Ties break by
   higher `z`, then section id. The anchor uses only stored placement coordinates, so every client
   derives the same membership during a collaborative drag; measured card heights do not change the
   answer.

3. **Nesting is derived by containment, not stored.** A section's descendants are the sections
   whose rectangles are fully inside it. Moving a section moves its card members and every contained
   section together, because all of them are part of the same region. Resizing or overlapping
   sections can change nesting; that is expected.

4. **Dragging a section moves its members.** The move plan is computed from stored geometry at drag
   start: the section, its contained sections, and the placements whose membership resolves into
   that set. Positions are committed in **one** `moveSectionsBatch` commit on release, so undo is one
   step. While the gesture runs, no CRDT writes happen; peers receive the section's live position
   through the ephemeral store, derive the same plan, and ease the members toward it.

5. **Dropping a card into a section expands the section to fit.** If the card's anchor is inside a
   section but the card's measured rectangle is not, the section (and any ancestors that contained
   it) grows to contain the card plus padding. This is a geometry write on drop, not a membership
   write. Cards that leave a section simply stop being members.

6. **Deleting a section deletes only the region.** Cards and placements stay exactly where they are.
   There is no confirmation because nothing owned is lost. Deleting a board deletes its sections
   with it.

7. **Sections are board-scoped and non-semantic.** They do not appear in type/tag queries, do not
   validate anything, and do not duplicate tags. A later explicit command may project a section into
   tags or properties, following the Semantic Canvas rule that projection is deliberate, not a live
   sync. A section is not a link target until relations exist.

8. **Rendering uses two flow-space layers, not React Flow nodes.** A background portal paints the
   rectangle beneath cards and edges; a header portal keeps titles, counts, resize handles and peer
   labels above them. This avoids teaching card selection, z-index elevation and delete semantics
   about a second node kind. If the portal layering proves unreliable, the fallback is a reserved
   z band for section nodes, but the semantic model does not change.

9. **Section state is UI state.** Selection, rename editing and per-card frontmatter expansion live
   in Zustand. Only geometry, title and colour are document state. The viewport never needs to know
   who has a card's frontmatter open.

## Consequences

- **A card can be in different sections on different boards**, which mirrors how a card can be
  positioned differently on each board.
- **Section membership changes without writes.** Dragging a card across a boundary is cheap and
  merge-safe; nothing needs to reconcile a section id after a concurrent move.
- **Section drags are bulk writes.** One commit moves N placements. This is acceptable because it is
  a single user gesture, field-granular per placement, and bounded by the size of the region.
- **Anchors make boundary behaviour predictable.** A card hanging outside a section is still a
  member if its header is inside; auto-expand makes that visually legible.
- **No stored parent** means a section can become nested or unnested by moving/resizing it. That is
  a feature for a spatial tool; outline and navigation surfaces must recompute containment.
- **Sections are not retrieval.** They help layout and board navigation, not cross-board queries.
  Types, tags and (later) views remain the semantic organization.

## Rejected alternatives

- **A group that owns cards.** It would make moving/deleting a region affect card existence and
  duplicate the ownership the board/placement model deliberately avoids.
- **Storing `sectionId` on each placement.** It makes membership explicit, but drag/drop must write
  membership, overlapping sections need an owner, and a geometry change has to reconcile records.
- **Deriving membership from the card centre or its full rectangle.** Both need measured heights,
  which can differ between clients and break the assumption that a section drag moves the same cards
  everywhere.
- **Sections as React Flow nodes.** Card selection, layer elevation, visibility culling and the
  card-only delete/trash logic would all need a second branch; the section model does not need node
  semantics.
- **Live section-to-tag projection.** It would rewrite card state as a side effect of layout, the
  failure mode the Semantic Canvas inspiration warns about.
