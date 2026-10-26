# ADR-0052: A link is a route

- **Status:** proposed — direction recorded, nothing built
- **Date:** 2026-10-25
- **Related:** [ADR-0007](./0007-connector-links.md) (connector links), [ADR-0008](./0008-live-links-and-path-styles.md)
  (live links, reconnection and path styles), [ADR-0039](./0039-a-link-points-at-an-endpoint-of-a-kind.md)
  (a link points at an endpoint of a kind), [ADR-0048](./0048-links-paint-beneath-cards.md) (links paint
  beneath cards), [ADR-0051](./0051-one-style-vocabulary-over-edges.md) (one style vocabulary),
  `apps/canvas/src/canvas/linkGeometry.ts`, `apps/canvas/src/components/LinkInspector.tsx`

## Context

ADR-0008 §3 made the path a **data** choice with four modes (`bezier`, `straight`, `step`, `smoothstep`).
The author now wants the line itself to be editable:

> Allow the user to manually reposition/add bend points to their links like a wireframing tool, regardless
> of its path mode. Also allow the user to choose layering options for the link, with the link then
> following the logical inverse bend around the card. … A way to isolate a specific link (the property
> inspector can help here) and provide it granular adjustments.

And, separately, on duplication:

> Though you can't connect the same connector to the same connector, you should be able to add another
> link going backward, that mirrors/inverses the existing one incoming/outgoing link. So each connector can
> connect to itself at most twice in either direction … They could even twist/mirror each other
> dynamically, when you do this, to make it seem intentional.

Three forces collide here:

1. **Modes versus manual.** If bends only apply in a "manual" mode, every mode becomes a special case and a
   bend silently stops working when someone changes the mode.
2. **Layering versus ADR-0048.** Links paint beneath cards so a 20px hit stroke never steals a card press.
   A user who wants a line to cross *over* a card is asking for an exception, and exceptions need a rule.
3. **Pairs.** Two links between the same two connectors are currently indistinguishable; a dynamic
   "mirror each other" rule would make two clients disagree about which line bends which way.

## Decision

**A link is a route over the canvas: endpoints, an optional polyline of bends, and a layer.**

1. **Bends are data, in flow coordinates, relative to the source anchor.** `bends?: {x,y}[]` on the edge.
   Relative to the source anchor so moving the source card translates the whole route instead of leaving
   bends behind. `reconnectEdge` and `reverseEdge` preserve them (a reversed link reverses the polyline).
2. **Every path style renders the same bends.** Bezier curves through the points; straight joins them;
   step and smoothstep join them with right angles. There is no "manual mode", and no mode in which a bend
   is ignored. A link with no bends renders exactly as it does today.
3. **One layer choice per link.** `layer?: "below" | "above"`, defaulting to `below`
   ([ADR-0048](./0048-links-paint-beneath-cards.md)). Choosing `above` raises that link's paint *and* its
   hit stroke, so a link over a card is clickable where it is visible — the reason the default exists.
4. **Bends belong to the link, not to its endpoints.** A bend list is edited per link, from the link
   inspector and from drag handles on the canvas while that link is selected.
5. **Reverse pairs are allowed and deterministic.** The same two connectors may carry a second link in the
   opposite direction. Each edge draws with a curvature offset derived from its own id, so both are legible
   and every client computes the same offset. There is no dynamic mirroring: a line that moves because a
   *peer* drew another link would make the board disagree with itself.
6. **Obstacle avoidance is a path mode the user opts into, never a default.** `path: "avoid"` routes the
   link around the cards and sections it would otherwise cross, rather than through them. It is one more
   value of the existing `path` enum, so it is stored per link, syncs, and is visible in the Path submenu.
   Three rules keep it from becoming the surprise that made it a rejected idea at first:
   - **Bends still win.** A link with bends renders its bends; turning avoidance on does not silently
     re-route a route somebody drew. Clearing the bends is what hands geometry back to the router.
   - **The computation is bounded and local.** A small grid over the link's bounding box plus a margin, a
     hard node budget, and a stored fallback: when the budget is exhausted the link renders as `bezier`.
     Nothing about a peer's board changes the result, because the obstacles are document data.
   - **It is per link.** A board-wide switch, or avoidance applied to links the user did not choose, would
     change a line under a reader mid-session. The default for every link stays `bezier`.
7. **The inspector is the control surface.** A selected link shows its ends (already), its path style
   (already), its bends (add, remove, drag), its layer, and **isolate**, which dims everything but this
   link so a dense board can be worked on one route at a time.

## Consequences

- **Geometry has one entry point.** `linkGeometry` gains a route builder shared by React Flow edges and the
  canvas-drawn section links, so a bent section link and a bent card link behave identically.
- **A bend matrix test becomes mandatory.** Four modes × zero/one/many bends, plus a reversed bent edge.
- **A link can now outrank a card**, and that is a deliberate exception with a name (`layer: "above"`), not
  an accident of z-index.
- **The outline gains a z-order lens** (A24) rather than a separate layer-mode surface: seeing what is above
  what is the same question for cards, sections and links.
- **Routing is opt-in, so it is a feature rather than a surprise.** The researched plugin routes by
  default and offers a grid A\*; here the same capability is one selectable mode with a bounded budget, so
  a writer who wants tidy lines asks for them and everyone else keeps a line where they put it.
- **One duplication rule to explain.** A second link is drawn offset because the edge id says so — stable,
  testable, and identical on every client.

## Rejected alternatives

- **A `manual` path mode.** The mode would have to keep the other four's meanings, and switching modes would
  discard or hide the route.
- **Bends stored in screen or absolute board coordinates.** Both break the moment a card moves.
- **Dynamic mirroring between a pair.** Non-deterministic across clients, and it makes an unrelated new link
  move an existing one.
- **Avoidance as the default, or a board-wide routing switch.** A line that re-routes itself because
  somebody else added a card is the failure mode this ADR's per-link default prevents.
- **A separate layer panel or layer-mode surface.** More surface for a question the outline can answer.
- **Unlimited stacking of the same connector pair.** Two directions is the limit that keeps a pair readable;
  more belongs in a section or a different dot.
