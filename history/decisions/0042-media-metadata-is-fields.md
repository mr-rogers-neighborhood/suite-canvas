# ADR-0042: Media metadata is fields, not media types

- **Status:** accepted. Revises roadmap Bet D ("Sources, media, and annotations").
- **Date:** 2026-10-25
- **Related:** [ADR-0003](./0003-typed-object-graph.md), [ADR-0016](./0016-semantic-core.md), [ADR-0020](./0020-main-and-loro-plan-of-record.md) §2, [ADR-0041](./0041-alpha-core-is-a-closed-feature-set.md), [`docs/roadmap/v2.md`](../roadmap/v2.md) §6

## Context

Roadmap Bet D planned a **media** surface as card types: a `media` type per medium (film, book, game,
album) with its own properties, so that a card could represent a work with cover art, runtime, author
and so on.

The author's 2026-10-25 note proposes the opposite:

> External Data/Metadata as fields. So instead of special "Media" card types for movie, book, game,
> music metadata, you can insert the metadata as individual fields? Most people don't want to fetch
> every single metadata field for a given media anyways.

That is a sharp observation about behaviour: nobody wants *all* the fields. A person wants the runtime
on the one card they are deciding whether to watch, and the ISBN on the one they are trying to find in
a library. A media *type* hands them a fixed form instead.

ADR-0020 §2 already says **cards are objects and a new object class needs a reason**; ADR-0016 makes a
type a schema over fields. So the question is narrow: is "a film" a *kind of thing* (a type) or a
*thing with some fetched values* (a card with fields)?

## Decision

**Fetched metadata arrives as field values on ordinary cards.** There are no built-in media types.

1. **A metadata field is an ordinary field of an ordinary type.** It carries a value the user chose to
   have; nothing about the card's identity changes because the value was fetched.
2. **Fetching is an edit, not a product surface.** A "fetch metadata" action fills *selected* fields on
   *this* card. There is no library, no grid, no scanner, and no background enrichment of other cards.
3. **The user picks the fields first.** Any type may declare a metadata-capable field; the fetch offers
   only what that card's type declares, so the model never grows a second property space.
4. **Values are copied, never linked.** A fetched value is stored like a typed-in value. It does not
   track the external source, and nothing about the card breaks when the source disappears.
5. **Provenance is a field, not a hidden column.** If a workspace wants to know where a value came from,
   that is a field the type declares — visible, queryable and removable like any other.
6. **Annotations are not metadata.** A highlight on a PDF page or a video timecode is a *record bound to
   a source* that projects as a card ([ADR-0041](./0041-alpha-core-is-a-closed-feature-set.md)); it is not
   a field value. The two surfaces meet at the card: an annotation can be detached into an ordinary
   card, and a card can carry a source field.

## Rejected alternatives

- **Media card types (the previous Bet D plan).** A type per medium forks selection, trash, undo, the
  library, references, sharing, projections and export for something that is a property. It also bakes
  a taxonomy of media into the schema, which ages badly and cannot cover the long tail (a lecture
  series, a recipe, a dataset).
- **A `media` object class beside cards.** Contradicts ADR-0020 §2 and would need its own inspector,
  query predicates and export path.
- **Metadata as a linked record that stays in sync.** Turns an edit into a subscription: what happens
  when the source changes, disappears, or disagrees with the user's correction? The value the user sees
  must be the value stored.
- **Fetch everything the API returns.** The note's own observation: most fields are unwanted, and an
  unwanted field is noise in the inspector and a liability in queries.

## Consequences

- **Roadmap Bet D is rewritten.** Its media half becomes "metadata fields plus a fetch action"; its
  sources-and-annotations half survives unchanged and is Alpha core.
- **A "media" starting point is a preset, not a type.** A friendly creation entry may offer a bundle of
  fields (title, creator, year, cover), but it produces an ordinary type or an ordinary card with
  fields — nothing special survives the creation step.
- **Field kinds stay a closed set.** A metadata field uses an existing kind (text, number, date,
  select, `card`, `board`) plus, where needed, an attachment reference for cover art. Widening
  `fieldKinds` is a separate, explicit decision.
- **The fetch action needs a source per field.** Each metadata-capable field names where its value comes
  from; that is configuration on the type, not on the card.
- **No new object class means no new tests for one.** The behaviour lands as field writes, so undo,
  trash, library, references and export keep working with no changes.
