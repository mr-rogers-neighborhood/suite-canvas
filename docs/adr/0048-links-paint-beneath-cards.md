# ADR-0048: Links paint beneath cards, and keep the dot they were dropped on

- **Status:** accepted
- **Date:** 2026-10-25
- **Related:** [ADR-0006](./0006-connectors-and-layers.md) (connectors and node layers),
  [ADR-0007](./0007-connector-links.md) (links between connectors),
  [ADR-0017](./0017-spatial-sections.md) (sections),
  [ADR-0039](./0039-a-link-points-at-an-endpoint-of-a-kind.md) (endpoint kinds)

## Context

A React Flow edge carries an invisible interaction stroke about 20px wide so that a 1.5px line can
be clicked at all. The canvas used to paint the whole edges layer *above* the cards, on the theory
that a card's stacking order must not hide a link. The cost only showed up in use:

- a press on a card that a link happened to cross was taken by the link, so the card could not be
  selected, dragged, or deselected — and a connector dot under the line could not start a
  connection at all, which reads as "this card cannot be wired";
- links touching a section are drawn by the canvas itself (a section is not a node), in a separate
  SVG layer with its own rules. It was z-index 0, i.e. tied with the nodes layer and winning on
  paint order, which produced the same stolen presses; at `-1` it vanished under the section it left
  from and could not be selected either;
- the same layer made its *visible* path clickable, so the visible 1.5px stroke sat on top of its own
  12px hit stroke and swallowed every press aimed at the line;
- a release on a dot was resolved by shape alone once the drop travelled through the geometric
  resolver, so the line left from whichever side faced the other end instead of the dot the user
  aimed at — the "wrong port" class of bug.

## Decision

1. **Links paint beneath the cards.** `.react-flow__edges` sits at `z-index: 1`: above a section's
   wash (`-1`), below the nodes layer (`3`). A link is a reading aid; the card is the thing you
   press. Any press over a card, a card's body or a connector dot reaches the card.
2. **The layer rises only while a link is being worked with.** React Flow renders its endpoint
   handles inside the edges SVG, so reconnection needs that layer on top: it goes to `4` while an
   edge is selected or hovered (`.react-flow__edges:has(.react-flow__edge.selected)`,
   `:has(.react-flow__edge:hover)`). Deselect, move the pointer away, and the lines drop back under
   the cards. `elevateEdgesOnSelect` is `false` so React Flow does not keep a single edge raised
   after the fact.
3. **A section link splits paint from hit-testing.** The visible `.section-link` path is
   `pointer-events: none`; the wider `.section-link__hit` stroke is the only affordance, and it
   claims the press before React Flow's pane can capture the pointer for camera dragging.
4. **A link end keeps the dot it was released on.** `connectorAtPoint` resolves a release against
   every connector within a screen-scaled radius (14px at any zoom) and does **not** require the
   point to be inside the entity's rect: a dot sits *on* the perimeter, so its centre is on the
   boundary and half the time a pixel outside it. A board end keeps the connecting portal's dot,
   and the dot is dropped instead when the board has several portals here and the line is painted
   through a different one.
5. **Several links may join the same two things.** Identity is the pair of dots (`linkKey`), not the
   pair of entities: a dot may fan out to several dots of one other card, and two links between the
   same entities on different dots are separate connections. Twice on the *same* pair of dots,
   in either direction, is a duplicate and is refused. Reading still groups them: one inspector row
   per other card, with every description listed under it.

## Consequences

- Selecting, dragging and wiring a card can no longer be blocked by a line crossing it — the
  reported "a card cannot be clicked until you click off it" stops being possible.
- A link passing over a card is drawn *behind* it, which is the conventional canvas reading and
  matches how the section links already behaved.
- Reconnection keeps working because the layer rises for exactly the moment it is needed, but a
  selected link's hit stroke can still cover a card; the cure is to deselect, and pressing elsewhere
  does that first.
- Dots are found by a small radius rather than by containment, so a release a few pixels off a dot
  still attaches to it. The radius is the only tuning knob.
- Anything that resolves a link end must go through `connectorAtPoint`/`linkEndConnector`, or it
  reintroduces the "wrong port" behaviour. `linkGeometry.test.ts` and
  `packages/graph/src/loro/connectionMatrix.test.ts` cover the matrix; `e2e/tests/connection-matrix.spec.ts`
  asserts the drawn ends for every ordered pair of kinds, in both gestures.

## Amendment 2026-10-25: beneath is the default, and one link may opt out

The rule in this ADR — links paint beneath cards so a 20px hit stroke never takes a card's press — becomes the
**default** rather than the only choice. [ADR-0052](./0052-a-link-is-a-route.md) adds `layer: "below" | "above"`
per link, and a link that opts into `above` raises its paint *and* its hit stroke together, so a link drawn
over a card is clickable where it is visible. Everything else here stands: the layer only rises while an edge
is selected or hovered, and `elevateEdgesOnSelect` stays off.
