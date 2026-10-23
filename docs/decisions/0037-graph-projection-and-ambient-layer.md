# ADR-0037: The graph projection (and the ambient layer)

- **Status:** accepted
- **Date:** 2026-10-23
- **Related:** [ADR-0019](./0019-references-not-typed-links.md), [ADR-0030](./0030-scene-projection-lod-and-real-portals.md), [ADR-0034](./0034-ice-primary-rendering-engine.md), [ADR-0035](./0035-views-pins-and-portals.md), [ADR-0036](./0036-fractal-lod-and-icon-graph.md), [`docs/fractal-interface-research.md`](../fractal-interface-research.md), [`docs/roadmap/ice-parity.md`](../roadmap/ice-parity.md), `packages/scene/src/typeGraph.ts`, `apps/canvas/src/ice/iceCameraFlight.ts`

## Context

A View is a set of cards on one board. There are two questions a reader asks of it that the canvas
answers badly: *what is in here, by type?* and *where is the weight?* At reading zoom the cards
answer both by being read one at a time; zoomed out they become small sheets, and the answer is
"there is something", not "this is what it is".

The obvious answer — a graph — is the one this project has repeatedly refused in its spatial form:
a force-directed layout, or a graph mode with its own positions, would be a second layout
([ADR-0036](./0036-fractal-lod-and-icon-graph.md)), and references are never edges
([ADR-0019](./0019-references-not-typed-links.md)). What is left is a *projection*: the same
positions, aggregated, drawn over the canvas and dismissed when it has said what it has to say.

Three constraints already hold and frame the choice:

- The representation follows scale ([ADR-0036](./0036-fractal-lod-and-icon-graph.md)); a graph
  *mode* is rejected there and stays rejected.
- The canvas has exactly one position per object. A graph with its own layout would be a second
  spatial model.
- References are rows and predicates, never edges ([ADR-0019](./0019-references-not-typed-links.md)).

## Decision

The projection is an **overlay**: a control opens it, a control closes it, and the canvas underneath
is untouched in both directions. It is not a zoom band, not a mode, and not a place.


### 1. The vocabulary

| Term | Meaning | Precedent |
| --- | --- | --- |
| **Graph projection** | The type graph drawn *over* the canvas: one node per (container, type), positions derived from members. | World in Miniature (Stoakley et al., CHI '95). |
| **Graph view** | The canvas with that projection open. A toggle, not a zoom band. | Semantic zoom, but driven by an explicit control rather than by scale. |
| **Ambient layer** | Soft masses derived from the same projection, behind the cards, answering "where is the weight here?" without a legend. | Heat maps, but quiet enough to sit behind text. |
| **Depiction** | Derived 2.5D inside the projection: nesting depth as offset, scale and shadow. No perspective camera. | Layers, not a 3D scene. |
| **Type space** | A *semantic* projection: types as dimensions. A separate surface, never the canvas. | Hyperbolic, treemap and overview literature; retrieval, not layout. |
| **Navigation is movement** | Every navigation is a camera flight whose duration scales with distance; the only exception is naming a card in the library, drawer or table. | Flight, not teleport. |

"Unbounded descent" stays true in the product sense — portals nest until the depth cap of
[ADR-0036](./0036-fractal-lod-and-icon-graph.md), and no zoom limit is imposed by this decision. The
camera keeps whatever range ICE gives it; this ADR adds no floor and no ceiling.

### The ceiling and the membrane are **pinned, not adopted**

An earlier draft of this ADR made the top of the zoom range a *ceiling* with a *membrane*: rubber-band
resistance as you pushed past the zoom at which the View fits, a cue that built, a commit past a
threshold, and the same gesture to return. The mechanics are sound (iOS `bounces`, Android 12 stretch,
pull-to-refresh's commit, Apple sheet detents, Raskin's quasimode) and `iceMembrane.ts` existed and
was tested.

It was removed because it made the product harder to explain than the feature it introduced:

- **It invented an extent.** With no floor and no ceiling, "the zoom at which the View fits" was a
  boundary the canvas did not otherwise have, so one gesture behaved differently from the rest of the
  zoom range and had to be *taught*.
- **It competed with the wheel.** Every wheel event near the boundary had to be intercepted and
  damped, which is exactly the kind of cleverness that reads as lag when a user is just trying to
  zoom.
- **The graph does not need a scale to be useful.** The projection is worth opening at 60% as much as
  at 6%: it answers "what is in this View, by type" at any zoom. Tying it to a zoom band was a
  narrative choice, not a functional one.

The idea is recorded in [`docs/fractal-interface-research.md`](../fractal-interface-research.md) and
pinned in the roadmap: if the canvas ever grows a genuine top (a workspace overview that is not just
the same layout), a membrane is the right grammar for reaching it. Until then the projection is a
plain overlay.

### 2. The graph projection aggregates type nodes in their container

The projection is opened by the canvas zoom cluster's Graph control (`g`, and `Escape` to close). It
draws over the canvas: **the cards are not disturbed**, which is what makes it an overlay rather than
a different place.

- **Nodes.** One `type:<container>:<typeId>` node per (container, type) pair, inside the frame that
  holds those cards, plus one unfiled bucket per board for cards no section holds. A container node
  counts everything inside it.
- **Positions are derived, never authored.** A container's frame comes from its members' bounds; the
  type nodes sit on a deterministic grid ordered by type id, so two clients at the same revision draw
  the same graph and a re-render never shuffles it. The projection is
  `packages/scene/src/typeGraph.ts`; it stores nothing.
- **Counts only, no titles.** A node carries its type's glyph and the number of cards. A truncated
  title is worse than a number, and a number is the one label that survives at any scale. Labels are
  counter-scaled like pins, so they stay readable.
- **Containment edges only.** The one edge is container → cluster. References never become edges, at
  any zoom, even behind a modifier: this restates [ADR-0019](./0019-references-not-typed-links.md).
- **Nothing writes.** Reading the graph is a projection of the document; no gesture in the projection
  originates a document write.
- **Re-derived on a revision, never per frame.** Opening the projection builds it once; a document
  change rebuilds it.

### 3. Opening and closing is a flight, with the camera remembered

Opening the projection flies to frame it (`frameCameraFor`), and stores the camera the user came
from. Closing flies back to exactly that camera — even if they panned or zoomed inside the projection
— and the return is planned longer and gentler than the entry, so leaving feels like coming down. The
stored camera is overwritten only by a fresh entry.

This is not a mode in the sense [ADR-0036](./0036-fractal-lod-and-icon-graph.md) forbids: the canvas
keeps one spatial layout, the projection *is* that layout at a coarser resolution, and the toggle
changes what is drawn over it, never where anything is. Nothing is authored in the projection, and
leaving it restores the exact camera, so there is no second place to be.

### 4. Derived 2.5D, inside the projection only

Depth is computed, never stored. A container's nesting depth becomes a vertical offset, a slight
scale and a shadow, drawn on the same flat quads as everything else. Nested containers read as a
stack; nothing about the camera changes, and no renderer is added. The depth axis exists only in the
graph band — in every other band the canvas is flat, because depth there would be a second layout.

**True 3D in the canvas is rejected**, for four concrete reasons:

- ICE's `Camera` is `{x, y, zoom}`. There is no pitch or yaw, so 3D is a second renderer, not a
  camera tweak.
- The paper pass draws screen-aligned quads and rasters text per zoom band. Tilting them breaks that
  premise and the text with it.
- Picking, drag, snapping and alignment guides are all inverses of a 2D affine map. Every one of them
  would need a new depth-aware implementation.
- Occlusion destroys the property that makes a canvas work — everything is visible at once — and it
  costs collaborators a shared frame they can all reason about.

Derived depth keeps the stack legible without any of those costs, because it is still a projection
of the one 2D layout.

### 5. Type space is a separate surface, later

Real 3D, if it is ever wanted, belongs to **type space**: types as dimensions, cards as points,
orbit and columns rather than pan and zoom. It is retrieval, not layout, so it gets its own route and
its own camera. It must never claim to be the canvas and it writes nothing.

Entry criteria, all of which must hold before it is designed:

1. the graph band has shipped and been used;
2. the Types table shows demand for cross-type comparison rather than counts;
3. the canvas invariants — one layout, derived positions, no reference edges — are already covered by
   tests, so the second surface cannot quietly relax them.

### 6. Navigation is movement

Every navigation is a camera flight. There is no "jump the user there": you *travel* to the graph
band, you do not switch to it, and a cut would teach the user that the band is another place.

- **Duration scales with distance.** Pan contributes screen pixels travelled at the destination zoom;
  zoom contributes the log2 ratio, because 1× → 2× and 2× → 4× are the same perceptual step. Both are
  clamped, so a short hop is quick, a workspace-wide move takes long enough to keep orientation, and a
  zero-distance move resolves immediately. The planner is pure
  (`apps/canvas/src/ice/iceCameraFlight.ts`); the surface owns the frame loop.
- **One exception:** clicking a card in the library, a drawer or the Types table. That is the user
  naming a destination, so the card may come to them. Nothing else brings the canvas to the user.
- **No teleporting camera ops.** `zoomToFit`, `panTo` and `zoomTo` are used only through the flight
  helper, never as one-shot jumps. ICE's own `enterContainer`/`exitContainer` already animate and
  stay as they are. Portal entry keeps ADR-0036's short three-beat transition rather than becoming a
  long flight: the distance rule applies to canvas travel, and its ceiling means a workspace-wide
  move is still a move, not a cutscene.
- Under `prefers-reduced-motion` the flight collapses to an immediate camera write; the band change,
  and the commit rule, are unchanged.

## Consequences

- **The far end is not a special case.** Zoom has whatever range the engine gives it and no boundary
  of ours; the projection is available at any zoom, so nothing in the interaction depends on where
  the camera happens to be.
- **The invariant survives.** Aggregation derives every position from members' positions, so the
  canvas still has one position per object and nothing is authored in the graph band. If a graph node
  ever needed a position nobody could compute, the graph would have stopped being the same layout.
- **Legibility is bounded by the label rule.** Counts and glyphs only; nothing in the projection needs
  a font-size floor, so nothing can become the unreadable thing the projection replaced.
- **Cost moves to openings.** Aggregation runs when the projection opens and on a document revision,
  never per frame.
- **The overlay is honest about being one.** Cards stay drawn underneath, the crumb says "Graph view"
  and offers the way out, and the exact camera returns on close. A user who hates it loses one click,
  not their place.
- **Naming waits.** The UI word for a container follows the Board/View decision pinned in
  [`docs/roadmap/ice-parity.md`](../roadmap/ice-parity.md); the code noun stays `container`.

## Rejected alternatives

- **A ceiling with a membrane** (the previous draft, implemented and tested). Resistance, a cue, a
  commit threshold and a gesture to return is a beautiful grammar for reaching a top — but the canvas
  has no top, so the boundary had to be invented and taught, and damping every wheel event near it
  read as lag. Pinned above; revisit only if a genuine top appears.
- **Automatic band switching at a zoom threshold.** The projection would appear while the user was
  still reading cards, and a wheel wobble would flip it. The decision to open it is the user's.
- **A percentage readout or a zoom slider.** A slider implies two ends, and the canvas has none; a
  percentage of an unbounded extent is a number about the camera, not about the work. Two buttons,
  Fit View, and the content itself communicate depth better than either.
- **A 3D canvas.** Rejected above on camera, text raster, picking and occlusion grounds; it is also a
  second renderer for one scene.
- **Authoring positions in the graph.** Hand-placed graph nodes would be a second layout, and the
  second layout is what makes the zoom a magic trick. If a node's position is not derivable, the
  graph is not a projection.
- **A force-directed graph.** It optimises for the picture and against the door: the
  cluster you were about to zoom into moves, so the graph stops being a map of where things are.

## Relationship to earlier decisions

- [ADR-0034](./0034-ice-primary-rendering-engine.md) makes ICE the only renderer and keeps the camera
  `{x, y, zoom}`; that is why depth here is derived shading rather than a dimension of the camera.
- [ADR-0035](./0035-views-pins-and-portals.md) gives the top of the extent its name: the ceiling is
  *this View*, and the graph band aggregates what the View holds. Containers are the same sections the
  aggregation groups by.
- [ADR-0036](./0036-fractal-lod-and-icon-graph.md) supplies the bands, hysteresis and the icon field.
  This ADR continues that ladder below `icon`: the icon field is the last *card* LOD, and the graph
  band is the band after it.
