# ADR-0051: One style vocabulary over the edges of a surface

- **Status:** proposed — direction recorded, nothing built
- **Date:** 2026-10-25
- **Related:** [ADR-0046](./0046-the-shell-derives-its-colour.md) (the shell derives its colour),
  [ADR-0016](./0016-semantic-core.md) (types, fields, tags), [ADR-0017](./0017-spatial-sections.md)
  (spatial sections), [ADR-0040](./0040-a-board-and-a-section-are-identities.md) (boards and sections
  are identities), [ADR-0048](./0048-links-paint-beneath-cards.md) (links paint beneath cards),
  [ADR-0052](./0052-a-link-is-a-route.md) (a link is a route),
  `apps/canvas/src/styles/global.css`, `packages/graph/src/schema.ts`

## Context

Theming was scoped as "rules over tokens" ([ADR-0046](./0046-the-shell-derives-its-colour.md)): role
tokens, a rule layer, a shell with no palette of its own. The author then widened the notes:

> Styling allows for setting solid, dashed, dotted, and seamless styles for any of the four corners of a
> card, and for a link, a section, and all card types. … They can also do this for fields to set fields
> backgrounds, borders, etc. There's only a few "edges", around cards, sections, fields, and links. Same
> with colors, backgrounds, etc. The canvas itself, and the tabs even share this property. We can use this
> to maximize customization while keeping the styling system simple and useful.

Two separate costs are hiding in that paragraph:

1. **The style record.** If per-side borders, dash animation, silhouettes, seamless backgrounds, an
   opacity floor and per-surface text scale arrive one at a time, each one is a schema write with its own
   migration, and every surface built before the last write has to be revisited. That is the expensive
   shape.
2. **The style editor.** Per-side controls on seven surfaces is a large UI. If it ships at once it is a
   large risky surface; if it ships per surface, users see an inconsistency for a while.

The author chose the full model, first: *"full_now — build the whole paint system as its own gate before
other work"*. This ADR is the model; the gate (A29) stages the editors.

## Decision

**Every paintable thing is a surface with four edges, and one record styles them all.**

1. **Seven surfaces, four edges.** A card, a section, a board (the canvas), a field, a link, and a shell
   region (app bar, tab, dock, drawer) are surfaces. Each has `top`, `right`, `bottom`, `left` edges.
   Links have two ends rather than four sides; their "edges" are the stroke and its ends.
2. **One optional record, written where it differs.** `SurfaceStyle` may sit on a card, section, board,
   link or field definition. Absent means inherit; present means override that surface only.
3. **Roles, never values.** A style names a colour role or a token. No hex colour, no CSS class string,
   no selector is ever stored in the document (ADR-0046's rejection of a CSS-variables editor stands).
4. **Defaults derive.** Border colour, hover tint and lens dimming follow from surface + ink, so a style
   author sets intent and the system computes the rest.
5. **The opacity floor is a constant.** `opacity` clamps at a token constant. Hovering or selecting a
   faded surface restores full opacity *for the reader only* — a paint decision, never a document write,
   so a collaborator cannot "fix" someone's card by touching it.
6. **Direction is geometry's default.** A dashed or dotted edge animates along the surface's own
   direction: a link along its path, a box clockwise from its top edge. `flow: "reverse"` is an explicit
   per-edge exception, not the default, because two edges animating opposite ways by accident is how a
   board starts to look broken.
7. **Shape is paint, not structure.** A silhouette never changes hit-testing, link anchors, section
   membership or stacking. Sections already hold cards; a section gains a silhouette, never a new role.
   This is also why "shape objects" from the researched plugin are not adopted (they have no containment
   semantics either — their shape is a CSS mask on a text node).
8. **Seamless is a first-class background.** `surface: "none"` paints nothing but keeps the content, so
   bare text and drawings can sit on the canvas. It is not the same as `opacity: 0`; a seamless surface is
   still hit-testable and still revealed by hover.
9. **Text scale is a style value**, per surface, independent of camera zoom. It is the answer to "let me
   make this card's text bigger without zooming the board".
10. **The record lands whole; the editors stage.** Schema first (so no migration), then cards and links,
    then sections/boards/fields, then shell regions and named rules.

### The record

```ts
interface SurfaceStyle {
  surface?: ColourRole;   // background paint; "none" = seamless (bare content on canvas)
  ink?: ColourRole;
  shape?: ShapeKind;      // rect | pill | diamond | parallelogram | circle | document | database
  radius?: number;
  sides?: Partial<Record<"top" | "right" | "bottom" | "left", EdgeStyle>>;
  opacity?: number;       // clamped at a floor; hover/selection restores full
  textScale?: number;     // per-surface text size, independent of camera zoom
  icon?: IconRef;
}

interface EdgeStyle {
  paint: "solid" | "dashed" | "dotted" | "none";
  width?: number;
  colour?: ColourRole;
  flow?: "none" | "forward" | "reverse"; // dash animation; default derives from geometry
  speed?: number;
}
```

## Consequences

- **No migration later.** A surface built after this inherits the vocabulary; the alternative was
  revisiting every surface every time a style property was added.
- **One Style tab component.** Cards, sections, portals and links share one editor, so "Details / Content /
  Style" is consistent across entity kinds rather than three bespoke panels.
- **A bigger canvas becomes possible.** Zoom range and per-scale content breakpoints ride this gate,
  because the painter is where "stop drawing detail below this scale" has to live.
- **The rule layer arrives last, not first.** Named rules and themes (ADR-0046 §3) are a *scope* over this
  record; the record has to exist before a rule has anything to assign.
- **Harder to reverse than it looks.** Fields and edges gain optional style maps; a later "style is
  per-kind only" decision would need a migration, which is why this is an ADR rather than a note.
- **A theme cannot express everything.** Any layout property that is not surface, ink, edge, shape, opacity
  or scale is out of scope by construction; that is the fence that keeps this from becoming a page builder.

## Rejected alternatives

- **A CSS-class vocabulary the user spells** (the WordPress/Bricks model). ADR-0046 already rejected it;
  a stored class string would also break the "document truth, no CSS authoring" rule.
- **Per-side styles as a separate record per side.** It multiplies the schema and makes "no border" and
  "inherited border" indistinguishable.
- **Shape objects that hold cards.** Sections already hold cards and already clip content; a second
  container identity would need its own membership rules, link endpoints and z-order story.
- **Opacity without a floor.** The author asked for it and the failure mode is a card that is invisible to
  its owner and, worse, to a collaborator who did not set it.
- **Two independent dash directions on every surface.** Chaotic in practice; geometry owns the default.

## Amendment 2026-10-25: the silhouette is painted behind the content

§7 said a shape is paint, not structure. That was right and the first
implementation was wrong: `clip-path` sat on the surface element, which clips
every descendant, so a diamond card sliced the corners off its own title. The
fill, the outline and the silhouette now live on an underlay behind the content
and the element's own box stays a plain rectangle
([ADR-0060](./0060-shape-strip-and-rollup.md) §5). A shape must never make its own
text unreadable, and the same rule applies to a portal's miniature.
