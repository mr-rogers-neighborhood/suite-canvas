# ADR-0060: Shape and rollup — a card's outline is paint, its header is its only chrome

- **Status:** proposed — direction recorded, nothing built
- **Date:** 2026-10-25
- **Related:** [ADR-0051](./0051-one-style-vocabulary-over-edges.md) (one style vocabulary),
  [ADR-0052](./0052-a-link-is-a-route.md) (a link is a route), [ADR-0017](./0017-spatial-sections.md)
  (spatial sections), [ADR-0057](./0057-fields-can-compose.md) (fields can compose),
  [ADR-0039](./0039-a-link-points-at-an-endpoint-of-a-kind.md) (a link points at an endpoint of a kind)

## Context

Four related notes from the product author:

> letting the user rollup cards like they can with groups, and allowing them to control how/when/how a
> title bar or header/footer … appears could be helpful. This makes me think of how GeneratePress lets
> you do these widget areas with all four sides of a page, interesting idea with multi-sided cards but
> could easily become complex if not careful. … I have no idea how we think about managing text being
> contained within/without a shape. Even more interesting, allowing the user to create their own shapes
> using our existing link primitives/system existing and planned.

Three forces meet here:

1. **Sides.** A card already has a title bar, and a section has a header pill. Both are "chrome pinned
   to an edge" — but the edge is hard-coded, and there is no way to say "put a footer here".
2. **Collapse.** The researched plugin's collapsible groups and Tana's rollups both reduce a thing to a
   summary line. We have neither, and sections with thirty cards are unmanageable at any zoom.
3. **Custom outlines.** ADR-0051 gave a card seven preset silhouettes and stopped. The author's
   instinct — build shapes out of links — is the interesting one, because we already have a route
   primitive with editable bends.

There is also a defect to settle rather than repeat: **the silhouette currently clips its own content.**
`clip-path` sits on the card element, so a diamond slices the corners off its title. A shape must not
make its own text unreadable.

## Decision

**A card's outline is paint; its four sides are where chrome can live; and a custom outline is a
closed route.**

1. **One header, at the top.** A card's only chrome is the header it already has: the type glyph,
   the title, the actions. There is no per-side strip table and no way to ask for a footer, a caption
   rail, or a second row of chrome (*Note 2026-10-26: the four-sided version of this rule is cut*).
   Content gets everything below the header. This is the fence the author worried about, drawn one step
   tighter than first proposed: **the header is not a place to configure, it is the card.**
2. **The header holds chrome, never a second body.** A glyph, a title, the actions — and the title
   editor, which is the title. It may not hold a field editor or a second body. One body per card stays
   true.
3. **Rollup is a state of the thing rolled up.** A card can be `collapsed`: it paints its header plus a
   summary and nothing else. The summary is derived, not authored — the first line of the body, or
   a count for a list field, rendered by the same formatter a chip uses. A section can be `collapsed`:
   its cards stop painting, keep their placements, and membership is untouched
   ([ADR-0017](./0017-spatial-sections.md)). **Collapsed state is document data**, so a collaborator sees
   the same board, not their own arrangement of it.
4. **A custom shape is a closed route.** An edge whose two ends are the same connector, whose bends are
   the outline, in `layer: "above"` with a fill. That is the whole feature: it reuses route geometry,
   bend editing, layering and per-side styling from
   [ADR-0052](./0052-a-link-is-a-route.md), and it is why the author's instinct is right — we already
   support a connector linking to itself, so "draw your own shape" is "draw a loop".
5. **Outline clips paint, never content.** The silhouette is painted on an underlay behind the content,
   not as a `clip-path` on the container. Text stays whole inside a diamond, a hexagon or a drawn
   outline. This also **corrects the current implementation**, which clips the element and therefore its
   own title.
6. **Text containment is two style values, not a mode.** `contentInset` (how far content sits from the
   outline) and `allowOverflow` (whether content may paint outside the outline). Default: inset applies,
   overflow is visible. Text is never clipped to fit a shape; if it does not fit, that is a size problem
   the user can see and fix.
7. **A shape with text is a card; a shape without text is a route.** One rule, so the user never wonders
   which of two things to draw. If you want to write in it, it is a card with a custom outline; if you
   want an empty region, a band, or a divider, it is a closed route.
8. **Rollup is a state of an existing card**, so it is additive: absent means today's behaviour, and an
   older document does not have it.

## Consequences

- **The GeneratePress idea is cut, cheaply.** It was going to be four sides, one strip each, ordered — a
  small table and a small layout engine. Dropping it costs nothing that exists today, and rule 1 now says
  the opposite of the rule it replaced (*Note 2026-10-26*).
- **Rollups make a dense board readable at a distance**, and they pair with the zoom breakpoints from
  A29: a collapsed card and a far zoom band are the same instinct at two scales.
- **Custom shapes need no geometry engine.** A closed loop of bends is already storable, editable and
  shareable; the new work is a fill on a route and a way to close one (join the last bend to the first).
- **A card's outline becomes a first-class paint value**, which means the silhouette field grows from an
  enum to `preset | route`, and every surface that resolves a silhouette reads both. That is a resolver
  change, not a schema break: the preset enum stays valid.
- **`collapsed` is document data, so two people can disagree about reading the board.** That is the
  correct trade: a collapsed section is a statement about the board's shape, and hiding it locally would
  make a shared screen misleading.
- **No new place for a field to render.** ADR-0057's four-place parity stays four; a collapsed card's
  summary is the one compact render, and it is derived from the body rather than configured.
- **Custom outlines are hard to author badly and easy to author uselessly.** A drawn shape with a
  self-intersecting outline is a visual mess, not an error; we accept it rather than validating geometry
  the user can see.

## Note 2026-10-25: promotion is not a new kind

The author asked whether a **sketch** can be promoted to a tab, the way a board or a portal can. A sketch
is already a card with its own focus surface (`openCardFocus`), so promotion is *a tab over an existing
card id*, not a new object class — the same shape as a portal tab, minus a target board. It follows from
this ADR's own rule (a shape with text is a card, a shape without text is a route): the sketch stays the
card, and the tab is a way of looking at it.

## Parked 2026-10-25: card faces

The author's father — the largest real-world user, building a Terry Pratchett-style universe with nested
book graphs — suggested cards could **flip** to a second side. It is recorded here because it is adjacent
to strips and would be decided by the same record shape, and parked for two reasons:

1. **It is a second body, not a second strip.** A face implies two documents per card, or one document with
   a face id, and either answer changes what "the card's content" means everywhere — the body editor,
   search, export, mentions and the strip layout.
2. **Nothing needs it yet.** The stated use (a map or a portrait on the reverse) is served today by a second
   card, an image attachment, or a portal. "A card with two sides" is a real feature; it is not an Alpha one.

If it returns, the first question is the one above — **a face is content or a card is content** — and that
is an ADR, not an implementation detail.

## Note 2026-10-26: the sides are cut

> An idea I think I want to drop as I can't see it serving a clear purpose. Multiple "widget areas" on
> cards. Just header styling is good.

The author withdrew the widget-area half of this ADR before any of it was built, so rule 1 now reads the
opposite way: **a card's chrome is its header, always at the top, and nothing else.** No strip table, no
per-side assignment, no footer rail, no section widget areas — the section keeps the header pill it has.

Two things follow, and both are simplifications rather than losses:

1. **The record shape stays flat.** There is no `strips` array to validate, order, migrate or explain, and
   no new field-rendering place for the kind registry to satisfy (ADR-0057's four-place parity stays
   four).
2. **Rollup survives untouched.** A collapsed card paints its header and a derived summary — which is
   what a strip was going to give it, minus the layout engine. The reason to keep it is unchanged: a
   board of thirty cards is unreadable at any zoom.

What remains of this ADR: **rollup** (rule 3), **custom outlines as closed routes** (rule 4), **outline
paint never clipping content** (rule 5, already implemented for the preset silhouettes), and **text
containment as two style values** (rule 6, still open). The title of the record changed with it: it was
"Shape, strip and rollup", and the strip is gone.

## Open questions (deliberately not settled here)

- ~~Whether strips may be reordered across sides, and whether a section's header pill becomes a strip.~~
  Moot: there are no strips (*Note 2026-10-26*). A section keeps its header pill.
- Whether a route can be **filled** only when closed, or whether an open route can sketch a region. The
  simpler rule is closed-only.
- Whether rollup summaries are configurable ("show this field") or always derived. Derived first.
- Should sections and other card kinds have the same **shape** granularity, and should a section have a
  "Fit" mode that grows its outline to enclose its content neatly? The widget-area half of this question
  is answered — no card has them, so a section has none either (*Note 2026-10-26*) — but "Fit" is about
  the outline, and the outline is still paint.

## Rejected alternatives

- **Widget areas on cards at all.** Four ordered strips were the fenced version of the GeneratePress
  idea; the author dropped even that, because a header is enough and a per-side table is a layout engine
  nobody asked to learn (*Note 2026-10-26*).
- **A shape object that holds cards.** Sections already hold cards (ADR-0017); a second container would
  need its own membership, linking and z-order story.
- **Shapes as SVG paths stored as a `d` string.** Opaque to editing and to the bend handles the user
  already understands; a route is the same picture in a shape the app can manipulate.
- **Clipping the container to the silhouette.** It is the obvious implementation and it is wrong: it
  slices the card's own text. Paint goes behind content.
- **Collapsible state in UI state only.** A shared board would then look different to each reader, and
  "collapsed" would not survive a reload on another device.
- **A separate "group" entity for rollups.** Sections are the container; adding a second one for the same
  job is how a user ends up with two overlapping ways to group.
