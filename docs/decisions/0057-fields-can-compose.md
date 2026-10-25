# ADR-0057: Fields can compose (rating, group, list)

- **Status:** proposed — direction recorded, nothing built
- **Date:** 2026-10-25
- **Related:** [ADR-0016](./0016-semantic-core.md) (semantic core), [ADR-0038](./0038-a-type-template-is-a-card.md)
  (a type template is a card), [ADR-0042](./0042-media-metadata-is-fields.md) (media metadata is fields),
  [ADR-0043](./0043-a-view-is-a-lens-a-database-or-a-render.md) (views), [ADR-0047](./0047-a-view-can-be-a-card-and-an-embed-is-one-concept.md)
  (one embed field), [ADR-0053](./0053-supertags-are-multi-type.md) (supertags), [ADR-0051](./0051-one-style-vocabulary-over-edges.md)
  (field styling), `packages/graph/src/schema.ts`, `apps/canvas/src/components/CardPanel.tsx`

## Context

ADR-0016 §4 fixed the field kinds to **structured scalars** — `text`, `number`, `date`, `select`,
`multiSelect`, `checkbox` (later `card`, `board`) — and made a field's kind immutable, "which avoids a
silent coercion rule and a bulk-rewrite path". Two author notes break that boundary, and both of them are
about *shape*, not coercion:

> a flexible "Rating" (or more abstracted if helps) field would be nice and would go along with the media
> fields so you can add a ratings system to any entity yourself, and use the external metadata for ratings
> where applicable … Could also combine with the icon system which would make it fun/flexible (use a tomato
> icon from iconify as the icons for your ratings you get from the open movie/tv db api)

> We also need array/list/repeater/group field(s)/object fields in some variation … this could maybe let use
> interweave note types and templates in a smart way

The cost of composition is not in the storage (Loro has maps and movable lists). It is in **rendering**:
every kind has to appear in the canvas node, the card body, the inspector and a database cell, and a kind
that renders in three of those four is a bug factory.

## Decision

**A field may compose, in two shapes, with one level of nesting.**

1. **`rating` is a number with a presentation.** `{ scale: number; half?: boolean; icon?: IconRef }` — the
   value stored is a number, so sorting, filtering and arithmetic keep working; the icon set changes only
   how it is drawn. External metadata maps onto it (`vote_average` 0–10 onto the card's own scale), which is
   why it ships with A19 rather than in a gate of its own.
2. **`group` is an object.** A set of named sub-values, each with its own kind, defined on the field itself.
   A citation, an address, a "where I left off" block are groups.
3. **`list` is an ordered repeatable.** Its item is a scalar kind, a `group`, or a `card` reference. A recipe
   is a list of groups; an itinerary is a list of `{ card, day }`.
4. **One level in Alpha.** A `group` may not contain a `list`; a `list` may contain a `group` whose
   sub-values are scalars. This keeps validation, merge and rendering testable, and deeper nesting is a
   later *additive* widening — the shape does not change, only the depth.
5. **Sub-values merge like top-level values.** A `list` is a `LoroMovableList`, so two people appending keep
   both and order converges. A `group` is a map keyed by sub-field id, so two people editing different
   sub-values keep both. Nothing is last-write-wins over a whole collection.
6. **A composing field owns its sub-schema.** Sub-fields live on the field definition, exactly as
   type-owned fields already work; there is still no shared field library (ADR-0016's rejection stands).
7. **Kind stays immutable**, and a composite kind cannot become a scalar (or the reverse). Changing shape is
   delete-and-recreate, as ADR-0016 already says for scalars.
8. **Four-place parity is the acceptance test.** Canvas, body, inspector and database cell come from one
   registry entry per kind. A kind that cannot render in all four does not ship.
9. **Required stays advisory** at every level: a list can be empty and a group can be incomplete, with the
   completeness dot reporting it.

### What this does *not* introduce

Composition is not inheritance. A card with two types unions their fields
([ADR-0053](./0053-supertags-are-multi-type.md)); a group is *data on a card*, not a nested type. The
author's "type class / type family / type hierarchy" question is answered by primitives that already exist:
a **family** is a tag every member carries (queryable, renamed in one write), a **class** is an additional
type whose fields union in. Inheritance would add a resolution order, an override rule and a deletion
cascade to gain what tags and union already give.

## Consequences

- **Inline records without a new entity.** A list of groups is how "a recipe has ingredients" exists without
  inventing a card type per concept, which is the same instinct as ADR-0038's template-is-a-card.
- **Views get harder in one place.** A database column over a composite field renders a summary (count, first
  value) rather than an editor; editing happens in the inspector. That keeps A20's editable cells scalar.
- **Rating is cheap and popular.** It is a number plus a presentation, so it lands with the media work.
- **Dormant values still revive.** A composite value is dormant like any other when its field or type goes
  away (ADR-0016 §6), which means a removed list is recoverable.
- **The registry is now load-bearing.** Every future kind pays four renders; that is the fence that keeps the
  kind list small.

## Rejected alternatives

- **Arbitrary nesting.** It turns every renderer into a tree walker and every validation into recursion,
  before one composite kind has shipped.
- **A `json` field kind.** A bag of unvalidated data defeats Zod validation at the only layer that enforces
  it.
- **Composition as inheritance** (a type that extends another). It introduces override and cascade rules for
  a result multi-type plus tags already produce.
- **Rating as a `select` of stars.** It would store an option id rather than a number, so no arithmetic, no
  averaging, and no mapping from external metadata.
- **A shared field library.** Unchanged from ADR-0016: shared fields need referential integrity, and deletion
  ownership stops being unambiguous.
