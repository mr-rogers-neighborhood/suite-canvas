# ADR-0053: Supertags are multi-type

- **Status:** proposed — direction recorded, nothing built
- **Date:** 2026-10-25
- **Related:** [ADR-0014](./0014-semantic-model.md) (semantic model), [ADR-0016](./0016-semantic-core.md)
  (semantic core), [ADR-0037](./0037-a-saved-view-is-a-lens.md) (a saved view is a lens),
  [ADR-0057](./0057-fields-can-compose.md) (fields can compose), [ADR-0040](./0040-a-board-and-a-section-are-identities.md)
  (boards and sections are identities), `packages/graph/src/schema.ts`,
  `apps/canvas/src/components/CardPanel.tsx`, `apps/canvas/src/components/TypeSettingsDialog.tsx`

## Context

ADR-0016 §2 already stores type membership as a set plus a primary:

> `cards.<id>.types` is a `LoroMap<typeId, true>` and `cards.<id>.primaryTypeId` names the primary. …
> The UI exposes a single-select picker for now; the graph layer accepts N types.

and §3 fixed the rule that keeps that safe: **the primary type owns presentation, additional types only
add fields, and no code may branch on a combination of types.** ADR-0016's own consequences call enabling
multi-type "a UI change".

The author has now asked for it directly, under Tana's name:

> Tana-like supertags to act as field modifiers or template modifiers for cards? … maybe we should also
> allow them to have tags?

There is a second, quieter ask behind it: *"type classes, type families, type hierarchies, multi-types
(supertags). Which of these … could be useful for the end user, using the same verbiage or with friendlier
verbiage?"*

## Decision

**A card may carry several types. The primary owns what it looks like; the others only add fields.**

1. **Presentation belongs to the primary.** Glyph, colour, creation template and canvas renderer come from
   the primary type. Adding a type can never change how a card looks, only what it can record.
2. **Fields union in type order.** The inspector groups fields under their type, in the order types were
   added with the primary first. Two types defining "Status" show two grouped rows; they are never merged and
   never renamed to disambiguate.
3. **Required is per type and stays advisory.** Letting a second type block a write would turn a schema
   choice into an editing dead end (ADR-0016's own reasoning, unchanged).
4. **No code branches on a combination.** Anything that needs "a card that is a book *and* a film" is a tag or
   a field, not a conditional. This rule, not the picker, is what keeps the implementation linear.
5. **Creation stays single-type.** A type template still creates a card with one type (ADR-0038); adding a
   second type is an edit made in the inspector.
6. **Boards and sections get tags too.** An optional tag list on the board and section records. Tags never
   imply membership and never carry fields; with supertags in place a tag is a *queryable* grouping, so a
   section tag becomes a lens target rather than decoration.
7. **Vocabulary for the user.** "Type" stays the word for a schema-bearing thing a card can have several of;
   "tag" stays a label with no fields. We do **not** introduce "class", "family", "refinement" or "dependent"
   into the interface: a family is a tag every member carries, a class is a second type, and that is the
   whole mapping.

## Consequences

- **The inspector gets taller.** Fields grouped by type, collapsible, primary first; a card with three types
  is a long panel, and that is honest about what it records.
- **Views gain a real grouping primitive.** A lens can filter by type *or* tag, and a database can group by a
  tag that has no fields — the thing tags could not do before supertags.
- **Dormant values do the heavy lifting.** Removing a type hides its fields without erasing their values
  (ADR-0016 §6), which is what makes trying a second type non-destructive.
- **The one-way rule is now load-bearing.** A component that reads `card.primaryTypeId` for presentation is
  correct; one that reads `card.types` to decide behaviour is the bug this ADR exists to prevent.
- **Field-name collisions are visible, not resolved.** Two "Status" rows under two types is a schema smell the
  user can see and fix; silently merging them would hide it.

## Rejected alternatives

- **Inheritance / type families as first-class schema.** A resolution order, an override rule and a deletion
  cascade, to reach the same place tags plus field union already reach.
- **A "supertag" record distinct from a type.** It is the same idea with a second name and a second storage
  shape; ADR-0016 already chose the one shape.
- **Merging same-named fields across types.** It makes two independent schemas secretly share a value, and
  deleting one type would strand the other's data.
- **Per-combination renderers** ("book + film shows a special card"). Every combination is a test, and the
  count is unbounded.
- **Multi-type at creation.** It multiplies the creation dialog before the basic loop is in daily use.
