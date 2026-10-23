# ADR-0037: The ceiling and the graph band

- **Status:** accepted
- **Date:** 2026-10-23
- **Related:** [ADR-0019](./0019-references-not-typed-links.md), [ADR-0030](./0030-scene-projection-lod-and-real-portals.md), [ADR-0034](./0034-ice-primary-rendering-engine.md), [ADR-0035](./0035-views-pins-and-portals.md), [ADR-0036](./0036-fractal-lod-and-icon-graph.md), [`docs/fractal-interface-research.md`](../fractal-interface-research.md), [`docs/roadmap/ice-parity.md`](../roadmap/ice-parity.md), `packages/scene/src/typeGraph.ts`, `apps/canvas/src/ice/iceCameraFlight.ts`

## Context

The bands stop before the canvas does. [ADR-0036](./0036-fractal-lod-and-icon-graph.md) ends at
`icon` (0.12–0.35) and culls everything below 0.12; leave the wheel alone and the surface keeps
zooming into an empty field. Zoomed far enough out, a workspace becomes a scatter of small sheets:
you can see that there is something, not what it is or how it is organised. That is the far end of
the range, and nothing in the current design owns it.

The vocabulary is the real gap. "Zoom out" presumes a top, but the canvas never says where the top
is, what it looks like, or what happens when you reach it. The user's framing names the shape
exactly: **a ceiling you could break through, with an infinite floor.** Descent has no limit —
portals nest and the camera can always go deeper. Ascent is bounded: above the current View there is
nothing to see, so the top of the range is a *boundary*, not more empty space.

"Ceiling" here is our word, not a term of art. No HCI paper formalises unbounded descent against
bounded ascent; the systems that come closest are unbounded in both directions (hyperbolic browsers,
fractal art), and the systems with a bounded top clamp hard (maps, strategic-zoom RTS cameras). The
vocabulary below is therefore defined rather than cited; the evidence and the nearest neighbours are
in [`docs/fractal-interface-research.md`](../fractal-interface-research.md).

Three constraints already hold and frame the choice:

- The representation follows scale ([ADR-0036](./0036-fractal-lod-and-icon-graph.md)); a graph
  *mode* is rejected there and stays rejected.
- The canvas has exactly one position per object. A graph with its own layout would be a second
  spatial model.
- References are rows and predicates, never edges ([ADR-0019](./0019-references-not-typed-links.md)).

## Decision

### 1. The vocabulary

| Term | Meaning | Precedent |
| --- | --- | --- |
| **Floor** | Descent has no limit: portals nest, boards contain boards, the camera can always go deeper. | Hyperbolic browser (Lamping & Rao, CHI '95) gives every level constant area; treemaps recurse unboundedly inside a fixed root. |
| **Ceiling** | Ascent is bounded: the top of the extent is "this workspace" (or the current View). There is nothing above it to see. | Space-scale diagrams (Furnas & Bederson, CHI '95) are the analytical tool for a bounded zoom extent. |
| **Membrane** | How the ceiling *behaves*: rubber-band resistance as you push, a cue that builds, commit past a threshold, and the same gesture to return. | iOS `bounces`, Android 12 stretch, and pull-to-refresh's "past a threshold, the gesture commits". Apple sheet detents are the best-named soft ceiling. |
| **Breakthrough** | The commit that crosses from canvas to the top band. | Raskin's *quasimode*: a sustained physical action is what makes a state change deliberate rather than accidental. |
| **Graph band** | The zoom range at the ceiling where aggregation is drawn — a **band**, not a mode. | SupCom's strategic zoom changes representation at the top of its range; Mapbox's globe switches material by zoom. |
| **Graph view** | What the canvas *is* at that band: the same layout, aggregated. | World in Miniature (Stoakley et al., CHI '95). |
| **Type space** | A *semantic* projection: types as dimensions. Not spatial, not the canvas. | Hyperbolic, treemap and overview literature; retrieval, not layout. |

The words are recorded because the rest of this ADR follows from them: a bounded top gets a
membrane, a membrane needs a commit, a commit needs a band, and a band must be the same layout.
"Unbounded descent" means there is no product-level floor — not that the cycle stub and depth cap of
[ADR-0036](./0036-fractal-lod-and-icon-graph.md) go away. A legal document can still contain A→B→A,
and the view still stops expanding at the cap.

### 2. The graph band aggregates type nodes in their container

`graph` begins exactly where the card LOD culls: enter at zoom ≤ 0.12, leave at ≥ 0.13. Sharing the
cull threshold is the point — there is no zoom range in which the canvas shows nothing — and while the
graph is committed the surface suppresses card faces, so the two representations never overlap. Band
choice is computed once per
camera change, never per frame.

- **Nodes.** One `type:<container>:<typeId>` node per (container, type) pair, inside the frame that
  holds those cards, plus one unfiled bucket per board for cards no section holds. A container node
  counts everything inside it.
- **Positions are derived, never authored.** A container's frame comes from its members' bounds; the
  type nodes sit on a deterministic grid ordered by type id, so two clients at the same revision draw
  the same graph and a re-render never shuffles it. The projection is
  `packages/scene/src/typeGraph.ts`; it stores nothing.
- **Counts only, no titles.** A node carries its type's glyph and the number of cards. A truncated
  title is worse than a number, and a number is the one label that survives at this scale. Labels are
  counter-scaled like pins, so they stay readable across the band.
- **Containment edges only.** The one edge is container → cluster. References never become edges, at
  any zoom, even behind a modifier: this restates [ADR-0019](./0019-references-not-typed-links.md).
- **Nothing writes.** Reading the graph is a projection of the document; no gesture in this band
  originates a document write.

### 3. The membrane: resistance, cue, commit, return

At `z_ceiling` — the zoom at which the whole View fits — further wheel input does not move the
camera. It accumulates a `pull` in 0..1 with rubber-band damping, so the first notch moves almost
fully and later notches move less. A ring and a label build from the first frame of pull, not at the
threshold: the cue is what distinguishes an intentional push from a stuck wheel.

- **Commit** at `pull ≥ 0.65` held, sustained. The camera continues past the lid into the graph band
  as one motion; the cue is consumed by the transition rather than replaced by it.
- **Return** by the same gesture: pushing the other way at the top of the graph band, `Escape`, or
  the same control. Exit at `pull ≤ 0.35`.
- **Hysteresis both ways**, plus a ~220 ms settle, so wheel wobble at either boundary never flaps.
- **The canvas zoom cluster's Graph control is the same transition** as a camera action — a flight to the
  ceiling that commits — never a state toggle.
- **The graph is an overlay in time, not in space.** Entering stores the camera the user came from;
  leaving flies back to exactly that camera, even if they panned or zoomed inside the graph. The
  stored camera is overwritten only by a fresh entry, so a return is always to where they were, never
  to "roughly the ceiling".
- **The exit is a descent, not a cut.** The return flight is planned longer and gentler than the way
  in, and the cue holds a "Returning" state until it lands: the same geometry that makes the ceiling
  feel like a place makes leaving it feel like coming down.

This is not a mode switch. Representation still follows scale ([ADR-0036](./0036-fractal-lod-and-icon-graph.md)):
the band is a function of zoom. The gesture decides only *whether you commit* to the top band, the
way pull-to-refresh decides whether a list refreshes and does not decide what a list is. Both the
button and the overscroll end up moving the camera, which is the test that keeps this honest: if the
two paths produced different states, it would be a mode.

### 4. Derived 2.5D, in the graph band only

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

- **The far end has an owner.** The empty field below `icon` is replaced by the graph band, and the
  top of the range is a boundary with a behaviour rather than a clamp with a shrug.
- **The invariant survives.** Aggregation derives every position from members' positions, so the
  canvas still has one position per object and nothing is authored in the graph band. If a graph node
  ever needed a position nobody could compute, the graph would have stopped being the same layout.
- **Legibility is bounded by the label rule.** Counts and glyphs only; nothing at the ceiling needs a
  font-size floor, so nothing can become the unreadable thing the band replaced.
- **The cue is load-bearing.** If the ring and label are thin, the membrane reads as a bug: the canvas
  appears stuck. The cue starts on the first frame of pull and the return affordance is visible.
- **Cost moves to band changes.** Aggregation runs on band change and on document revision, never per
  frame; the band is resolved once per camera change, so this is a handful of passes, not a budget.
- **The gesture and the control must agree.** Both produce the identical camera result; a test that
  compares them is the guard against the membrane quietly becoming a toggle.
- **Naming waits.** The UI word for a container follows the Board/View decision pinned in
  [`docs/roadmap/ice-parity.md`](../roadmap/ice-parity.md); the code noun stays `container`.

## Rejected alternatives

- **A hard clamp at the ceiling.** Simplest to build and the honest default of every map library, but
  it makes the top of the range a wall: the user cannot tell whether they are at the ceiling or
  whether the canvas has stalled, and there is no gesture that says "go on".
- **Automatic band switching at a zoom threshold.** The graph would appear while the user was still
  reading the icon field, and a wheel wobble would flip it. Representation changes on scale; the
  *decision* to enter the top band is the user's.
- **A graph-mode toggle.** Two states with two camera behaviours is a second surface wearing the
  first one's clothes. It contradicts ADR-0036 and it would make the zoom discontinuous by definition.
- **A 3D canvas.** Rejected above on camera, text raster, picking and occlusion grounds; it is also a
  second renderer for one scene.
- **Authoring positions in the graph.** Hand-placed graph nodes would be a second layout, and the
  second layout is what makes the zoom a magic trick. If a node's position is not derivable, the
  graph is not a projection.
- **A force-directed graph at the ceiling.** It optimises for the picture and against the door: the
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
