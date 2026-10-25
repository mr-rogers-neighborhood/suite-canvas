# ADR-0047: A view can be a card, and an embed is one concept

- **Status:** accepted
- **Date:** 2026-10-25
- **Related:** [ADR-0016](./0016-semantic-core.md), [ADR-0029](./0029-portal-board-field.md), [ADR-0031](./0031-whiteboard-cards-and-loro-binding.md), [ADR-0038](./0038-a-type-template-is-a-card.md), [ADR-0040](./0040-a-board-and-a-section-are-identities.md), [ADR-0041](./0041-alpha-core-is-a-closed-feature-set.md), [ADR-0043](./0043-a-view-is-a-lens-a-database-or-a-render.md)

## Context

ADR-0043 gave a saved view three presentations: a lens on the canvas, a database table, a render.
The author then asked the natural next question:

> View cards, and/or view fields … similar to portals/sketches, except it opens up a view and can
> render it in place on the canvas. That also begs the other question: Sketch fields to embed
> sketches, portal fields to embed outlines/links to boards, render fields, etc.

Two products are hiding in that sentence, and they have very different costs:

1. **A card that *is* a view** — a node on the canvas that paints a table or a chart in place,
   refreshed from a query. Cheap: it is the portal/sketch pattern again (a card whose node paints
   something other than text), and ADR-0043 already produces the data.
2. **A field kind per embeddable thing** — `sketch`, `portal`, `render`, `view`, `board-outline`, …
   Each new kind is a schema branch that has to be validated, formatted, rendered in four places
   (canvas node, card body, inspector, database cell), published, redacted, searched and exported.
   That cost is multiplicative, not additive.

The canvas already renders non-text cards: `PortalNode` paints a miniature of another board,
`WhiteboardNode` paints a drawing preview. So the first product has a working precedent; the second
is where this becomes a trap.

## Decision

**A view can be a card. An embed is one concept with one field kind.**

1. **A view card is a card.** Its primary type paints the view instead of a text body, exactly as a
   portal paints a miniature. It references a **saved view by id**, so the query is authored once and
   shared by every place that shows it. No new object class ([ADR-0020](./0020-main-and-loro-plan-of-record.md) §2).
2. **A view card is read-only.** It renders; it does not edit cells, rows or the query. Editing a view's
   *query* happens where views are authored, and editing a *value* happens in the card's inspector or
   on the card itself. A live editable grid on the canvas would make every mousemove a document write
   and every peer a scroll position.
3. **One `embed` field kind**, not one per thing. Its value is `{ kind, id, options? }` where `kind`
   is drawn from a **closed registry**: `card`, `view`, `sketch`, `section`, `board`. Adding a kind
   is an edit to this ADR because every consumer must decide how it renders.
4. **One renderer registry, four surfaces.** The canvas node, the card body, the inspector and a
   database cell all resolve an embed through the same function. A new embed kind is implemented once
   and appears everywhere; a surface that renders an embed its own way is a defect.
5. **Embeds are inert values with a presentation.** A `card` or `board` property keeps meaning what
   ADR-0029 says (a reference, not an owner); an `embed` value is displayed, never navigated to
   implicitly. Opening one is an explicit action, and it uses the existing camera/board machinery.
6. **Bodies stay cheap.** An embedded view in a card body renders a **capped, virtualized head** of
   its result (a count plus the first rows) and opens the full view on demand. A body is rendered in
   three places at once (canvas twin, inspector, focus surface), so an unbounded table in a body is a
   performance bug, not a feature.
7. **Recursion is a rendering problem, not a data one.** A view card whose query matches itself, or an
   embed that contains the card containing it, stops with a visible stub and a working open action —
   the same rule portals use for cycles.
8. **Projection scope applies.** A published or shared board resolves embeds only within the
   projection; anything out of scope renders as *Unavailable*, never as a fetch. This is ADR-0022's
   existing rule, applied to one more surface.

## Rejected alternatives

- **A field kind per embeddable thing** (`sketch`, `portal`, `render`, `outline`, …). Five kinds means
  five validation rules, five formatters, five publish paths, five search behaviours, and five
  renderers per surface. One `embed` with a registry costs one of each.
- **Making `board` and `card` fields render embeds.** Those are references ([ADR-0019](./0019-references-not-typed-links.md));
  overloading their display would change what a portal *is* and break the rule that a `board` value is
  inert. Embeds get their own field.
- **An editable spreadsheet on the canvas.** Turns a reading surface into an editor with per-cell
  writes, per-cell presence and a second undo story.
- **A nested live canvas inside a card.** This is the scene-surface idea ADR-0036 removed; an embed is
  a rendering with no camera of its own.
- **Snapshot-only embeds.** A snapshot goes stale and nothing tells the reader. A live head with a cap
  is both cheaper to reason about and honest about what it is showing.

## Consequences

- **`fieldKinds` gains `embed`.** Additive: existing documents have no such value, and a card whose
  type does not declare the field never renders one.
- **A view card type becomes possible from existing parts** — a type like any other ([ADR-0038](./0038-a-type-template-is-a-card.md)),
  a `view` property naming the saved view, and a node component. Board templates can ship one.
- **Every embed kind needs a scope check.** The publish validator and the projection builder must
  treat an embed exactly like a reference when deciding what to copy, or a share leaks a board it
  excluded.
- **The `embed` field is not a link.** It draws nothing and is not an edge; if a user wants a line,
  ADR-0039's links are the tool.
- **Database cells can render embeds read-only**, which is the cheapest way to see "what is this
  project" in a table without opening each row.

## Assumptions to confirm

Recorded here rather than hidden, because each one is a product call rather than a technical one:

1. **Presentation is per card, not per type.** A view card carries which kind it shows, defaulting to
   its type's choice, so one type can serve a table card and a chart card.
2. **Body embeds are live with a cap**, not snapshots (decision 6).
3. **`board`/`card` values stay inert**; only `embed` renders (rejected alternative 2).
