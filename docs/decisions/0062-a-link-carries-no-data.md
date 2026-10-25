# ADR-0062: A link carries no data

- **Status:** accepted — a fence, not a feature
- **Date:** 2026-10-25
- **Related:** [ADR-0019](./0019-references-not-typed-links.md) (references, not typed links),
  [ADR-0039](./0039-a-link-points-at-an-endpoint-of-a-kind.md) (an endpoint of a kind),
  [ADR-0043](./0043-a-view-is-a-lens-a-database-or-a-render.md) (views, databases, renders),
  [ADR-0047](./0047-a-view-can-be-a-card-and-an-embed-is-one-concept.md) (view cards and embeds),
  [ADR-0052](./0052-a-link-is-a-route.md) (a link is a route), [ADR-0057](./0057-fields-can-compose.md)
  (fields can compose), [`docs/roadmap/v2.md`](../roadmap/v2.md)

## Context

The author raised the largest idea in the product so far and then answered it themselves:

> buttons/compute mechanisms (for embeds, dynamic data values, etc). Allowing links to carry data? Massive
> change, shelve for later. Basically crosses over into spreadsheet/automation/workflow engine territory,
> which could be awesome, but is something I've tried before and also was a complexity tarpit … should be
> relegated to v2 and beyond. I have not determined if any level of buttons/compute/enhanced interactivity
> and automation or rules engine/executable specification are desirable at all for an alpha, or even a
> beta. But maybe some primitive version could be scopable/usable in the alpha, and related to the
> query/views engine and the renders specifically (connect/reference fields on a card dynamically by
> drawing links to it from card, the literal example you can see on the react flow homepage).

The pattern the author points at is a canvas where a wire *carries a value*: draw a link from one card to a
field on another and the field reads it. (The React Flow homepage demo is client-rendered, so its source
could not be read; this ADR describes the pattern as the author described it, not the demo's internals.)

Three different things get called "compute" and they cost wildly different amounts:

1. **A link carries a value** — the field's value is derived from the other end. Cheap to *read*, ruinous
   to *reason about*: it creates dependency graphs, cycles, staleness, and "why does this say 7?" support
   conversations. This is the tarpit the author recognises.
2. **A button that runs an action** — create a card, apply a template, run a query. This is an automation
   surface, and it needs a permission model before it needs a UI.
3. **A query that aggregates over links** — "the average rating of everything this card links to". Read-
   only, computed at render, no stored derivation, no cycles to allow.

The third is the one that is genuinely scopeable, and it is also already most of the way to existing: a
render view (ADR-0043) computes from a query, and a link is a query predicate.

## Decision

**In Alpha and Beta, a link stores no data and drives no computation. A render may read links; nothing may
write through one.**

1. **A link's payload stays what it is**: two endpoints, a kind, a path, a route, a description, a label
   offset, a layer, a style. No value, no expression, no script, no action, no condition.
2. **No field is derived from another entity.** A field holds what someone typed or what an import
   fetched. "This field reads card X's field Y" is not expressible, so no cycle, no staleness, no cascade.
3. **A render view may aggregate over links, read-only.** "Average rating of linked cards", "count by
   kind", "list linked cards with a field" are *queries* over the graph, computed when the view renders,
   with nothing stored. This is the scoped primitive the author asked for, and it needs no new link field:
   it is a `ViewQuery` predicate that already has a relation by existing (ADR-0043).
4. **Nothing is interactive on a card except what is.** Buttons, checkboxes that write, and "click to run"
   affordances inside a published card are out of scope; a card is a document, not an app.
5. **Automation is a v2 decision with a named blocker.** Before any executable surface ships, a permission
   model has to answer: who may a shared board's button run as, and what may it touch? That question is
   recorded in the roadmap rather than answered here.
6. **The fence is checkable.** A schema test asserts an edge has no value-carrying field, so adding one is a
   deliberate ADR rather than a quiet field addition.

## Consequences

- **The graph stays a graph of statements.** Every link says "these two things are related, like this" —
  which is what makes them cheap to merge, cheap to explain and safe to hand to a stranger.
- **Aggregation lives in views, where it belongs.** A render already computes; giving it link predicates
  adds capability without adding a derived-value system.
- **The author's tarpit is avoided by construction.** There is no place in the document to put an
  expression, so no amount of enthusiasm can grow one incrementally.
- **Somebody will ask for computed fields.** The answer is a render or a fetch (ADR-0042), not a formula
  field, and this ADR is the record of that.
- **The v2 door stays open, and open in the right order**: first read-only aggregation (Alpha), then
  actions with a permission model, then, only if the first two prove out, values flowing through links.

## Rejected alternatives

- **A computed/derived field kind in Alpha.** It is the tarpit, and it would arrive before the permission
  model that makes even harmless automation safe.
- **A link with a `value` or `expression` attribute.** Every consumer of an edge would need to know whether
  it is data or statement; that ambiguity is worse than the feature is good.
- **"Buttons" as a card affordance without a permission model.** A shared board would become a way to run
  writes as somebody else.
- **Making aggregation a stored summary.** A stored aggregate is a cache that can lie; a render recomputes.
