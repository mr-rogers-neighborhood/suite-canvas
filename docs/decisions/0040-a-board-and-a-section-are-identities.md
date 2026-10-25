# ADR-0040: A board and a section are identities, not types

- **Status:** accepted
- **Date:** 2026-10-25
- **Related:** [ADR-0003](./0003-typed-object-graph.md), [ADR-0010](./0010-workspace-boards-and-cards.md), [ADR-0017](./0017-spatial-sections.md), [ADR-0038](./0038-a-type-template-is-a-card.md), [ADR-0039](./0039-a-link-points-at-an-endpoint-of-a-kind.md)

## Context

Boards and sections now take part in links and need somewhere to be inspected, which raised a
predictable question: should they be *objects* in the same sense cards are — with types, fields,
templates and maybe a body?

They are tempting to promote. A card is `{typeIds, properties, tags, title, content}`; a board is
`{name}` and a section is `{title, rect, color}`. Giving all three the same shape would let one
inspector, one query engine and one template system serve everything.

## Decision

**Cards are the only typed object. Boards and sections get small fixed inspectors.**

1. **No types, no fields, no templates for boards or sections.** The inspector exposes exactly what
   the records hold: a name/title, a colour, a cover image (boards), and links. Nothing else.
2. **The record stays minimal.** `boardSchema` gains `color?` and `coverAttachmentId?`;
   `sectionSchema` gains `connectors?`. No `properties`, no `typeIds`, no content document.
3. **Links are the composition mechanism.** A board links to boards, sections and cards; a section
   links likewise. Composition is expressed by links between identities, not by sharing a schema
   that pretends they are the same kind of thing.
4. **A portal is still a card.** It keeps its built-in type, its `board` field, its connectors and
   its role as the drawn handle on a board. Its inspector leads with **Open board**, because its
   content is elsewhere.
5. **Templates stay a card feature.** A "board template" is a later feature built on board
   duplication (copy the board, its sections, placements and edges), not on giving boards a body and
   a template reference.

## Rejected alternatives

- **Boards and sections become typeable.** Three property-bearing record classes, three query
  surfaces, three template paths, and a `Board` that has to answer what a `board` field on a board
  means. Every one of those is a place for the two models to disagree.
- **Everything is a card.** A board would gain a title editor, a truncated body and a trash state it
  never wanted, and sections would stop being derived spatial regions, contradicting
  [ADR-0017](./0017-spatial-sections.md). It also breaks the one-document cost model: the canvas
  renders every placement, and a region is not content.
- **A generic "object" base schema.** Abstraction with no second implementation is just a field that
  every inspector has to ignore.

## Consequences

- **The inspector is a union, not a generic.** `CardInspector` keeps its shape; portals and sections
  get `ContainerPanel` variants that share the drawer's chrome and nothing else.
- **A portal's primary action is not "Edit".** The generic card inspector would open a card focus
  surface for a pointer. The portal variant opens its board instead.
- **Sketches stay cards.** A sketch is a card type with its own editor and so keeps the full card
  inspector, gaining an "Open sketch" action and a framed/seamless display toggle. It does not
  become a field kind, because a field would make the drawing a property value rather than content
  with its own undo history.
- **Board duplication is the prerequisite for board templates.** It is pinned to a later stage; the
  current record shape neither blocks it nor pretends to support it.
- **Query predicates address cards only.** Linking to a board does not make boards query results;
  that would need a second result type in `runViewQuery` and is out of scope.
