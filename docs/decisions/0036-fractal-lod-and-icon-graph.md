# ADR-0036: Fractal LOD, icon fields and navigation

- **Status:** accepted
- **Date:** 2026-10-23
- **Related:** [ADR-0030](./0030-scene-projection-lod-and-real-portals.md), [ADR-0033](./0033-interactive-scene-surface.md), [ADR-0034](./0034-ice-primary-rendering-engine.md), [ADR-0035](./0035-views-pins-and-portals.md), [`docs/fractal-interface-research.md`](../fractal-interface-research.md), [`docs/roadmap/ice-parity.md`](../roadmap/ice-parity.md)

## Context

The scene surface already has discrete bands and hysteresis: `full` ≥ 0.75, `compact` 0.35–0.75,
`icon` 0.12–0.35, `hidden` < 0.12. It collapses a card to a glyph at distance and a portal to a
layout-encoded icon. The ICE surface has the same problem in a harder form: the DOM card is a real
Tiptap editor, the GPU body is a paper program, and the camera can move continuously through a
nested board whose effective scale is the product of every portal transform.

Two failure modes matter more than frame rate:

- **Flicker.** A threshold with no dwell makes a card mount and unmount repeatedly while the user
  rests near the boundary. Each mount is a Tiptap editor and a Loro subscription, so flicker is
  expensive and visually obvious.
- **Lostness.** An infinite canvas has no edges. At far zoom the user needs to see structure, not
  text, and needs a way back to a known place. Removing content is what makes the structure legible;
  removing all orientation is what makes the canvas unusable.

The user's direction is:

- far zoom becomes an **icon/object graph**, then canvas, smoothly;
- the far field is **spatial icons**, not invented graph edges;
- icon → card is a **crossfade** with hysteresis;
- the canvas keeps the Suite shell and card model.

“Fractal” here means recursive positional structure: nested containers, aligned slots, repeated
layout rules and a visible depth. It does not mean drawing a graph of references over the map.

### Research basis

The design borrows from the ZUI canon, not from a literal fractal-layout literature. The useful
findings are: semantic zoom is representation substitution, not scaling; low-detail motion frames
with a settle pass are the load-bearing performance pattern; portals are live event-routed views;
short animated transitions reduce orientation errors; overviews help preference and orientation but
do not reliably improve accuracy; and icon legibility depends on size and luminance contrast more
than colour. There is no peer-reviewed study of a continuous icon-graph ↔ editable-card morph, so
the crossfade and icon field are exploratory. The evidence, caveats and sources are in
[`docs/fractal-interface-research.md`](../fractal-interface-research.md).

## Decision

### 1. Bands are discrete and screen-aware

This is **scale-driven continuity**, not a mode switch. The icon field is the same spatial canvas at
low resolution, derived from the same card and portal positions. Hysteresis is only a boundary
stabilizer inside that continuous scale; it does not create a second view. A force-directed graph
layout, a separate “graph mode” or a toggle between graph and canvas is out of scope.

The effective scale remains the product of the camera and ancestor portal scales, but the band is
resolved from both effective scale and the object's **screen footprint**:

| Band | Condition | Face |
| --- | --- | --- |
| `full` | effective scale ≥ 0.75 **and** screen width ≥ 180 px | GPU paper + real `NodeCard` DOM overlay |
| `compact` | effective scale 0.35–0.75, or full scale with a footprint below 180 px | GPU paper + static title/glyph/chips |
| `icon` | effective scale 0.12–0.35 | type glyph at the object's exact footprint; container glyph encodes layout mode |
| `hidden` | effective scale < 0.12 or outside the cull region | nothing |

The screen-width condition prevents a card inside a deeply scaled portal from mounting a full
editor at a size no one can read. The band is stored per instance and is never recomputed as a
continuous function each frame.

### 2. Hysteresis is one-way at the boundary

Hysteresis is a debounce on the band boundary, not the product idea. The product is that the canvas
keeps its spatial model at every scale; the debounce exists so a wheel wiggle or a pointer resting on
a threshold does not mount and unmount editors.

- Downgrade immediately when the lower threshold is crossed.
- Upgrade only when the higher threshold is crossed **and** the state has held for 100 ms.
- A card that changes band cannot change again for 250 ms unless it leaves the viewport.
- A selected card, the focused card and a card with an active editor are pinned one band higher
  until the gesture ends. This is a semantic exception, not a camera trick; it prevents the editor
  disappearing under the caret.
- `prefers-reduced-motion` replaces the crossfade with an immediate band switch.

### 3. Crossfade in place, never relayout

- On upgrade, mount the DOM card at its final geometry with opacity 0, wait one animation frame,
  then fade it in over 140 ms while the GPU paper fades out. The card is interactive only when the
  fade completes.
- On downgrade, fade the DOM card out over 120 ms and unmount it; keep the GPU face at full opacity.
- Crossfade runs only for objects crossing a band. It never runs for every visible card, never
  changes the scene projection and never triggers a layout pass.
- The crossfade is cancelled if the band reverses; the latest band wins.
- A focused editor never fades out while it has focus. It collapses only after blur or an explicit
  camera gesture, and then through the same one-way hysteresis.

### 4. Two-phase frames: coarse while moving, exact at rest

- **Motion frame:** while the camera is moving, draw GPU proxies only. Do not mount a new DOM editor
  during a pan or zoom. Edges and labels follow the same rule: type glyphs, cached labels and only
  edges above the population threshold.
- **Settle frame:** after 80–120 ms without camera movement, run one incremental mount pass with a
  ~6 ms deadline and a cap of ~6 newly mounted editors per frame, centre-out. The card under the
  pointer or in the focal area resolves first.
- The two phases share one projection and one geometry source. The settle pass is not a second
  layout; it is the same card arriving in the DOM.
- `?perf=1` reports `mountedEditors`, `proxyCards` and `settleMs`. A card whose editor is waiting
  for the settle pass still shows its GPU face, never a blank box.

### 5. Far zoom is a spatial icon field

At `icon`, each card is its type glyph at its exact position and footprint. **References are never
rendered as edges anywhere.** An edge is a spatial drawing only; a reference is a row in the outline
or a predicate in a filter. This restates [ADR-0019](./0019-references-not-typed-links.md): a
mention never draws a connection. There are no reference edges at far zoom, even behind a modifier,
and no force-directed layout. Structure is carried by:

- **Position:** nested containers hold their children in the same slots at every depth.
- **Footprint:** a container's icon is sized to its frame, so its nesting is visible.
- **Layout glyph:** a container icon encodes its layout mode (grid, row, column, ring) as a small
  badge, so a grid nested in a grid is distinguishable from a row.
- **Type:** the card's own type glyph and colour, not a generic square.
- **State:** selection, peer selection and a pin marker use the existing chrome colours and remain
  counter-scaled.

Text is not rendered at `icon`: glyph-only, **not an ellipsized stub**. A truncated “Kn…” is worse
than a glyph because it implies a title is available. A title appears when the existing `compact`
band begins, using the band's existing threshold rather than a second text threshold. Title presence
is banded, not continuous; the fade is only for the card face, never for text appearing at a new
size. A label appears on hover, focus or selection at a readable size.

### 6. The editor budget is explicit

The DOM overlay is the expensive resource. The overlay mounts at most **24** cards by default, and
the cap is configurable per workspace:

1. the focused/editing card;
2. selected cards;
3. cards nearest the viewport centre;
4. then by z-order.

Cards outside the cull region are never mounted. The overlay tracks mounted count and exposes it in
`?perf=1`; a card that cannot mount because of the cap keeps its GPU face and a `compact` static
face instead. One card has at most one mounted editor, even when it appears in several portal
instances: the other instances get the static face and a “editing here” marker.

### 7. Per-band interaction masks

Expansion is not the only thing a portal changes. Each band has an interaction mask, borrowed from
Pad++'s event routing:

- `full` routes pointer, wheel and keyboard to the card editor; ICE keeps pan, zoom, selection and
  drag outside the editor.
- `compact` allows selection and drag; it does not open an editor or start a text caret.
- `icon` allows selection and portal entry; drag is disabled until the band upgrades.
- `hidden` is culled and receives no input.
- A collapsed portal swallows input except “enter”; an expanded portal routes input to the child
  instance's camera.
- The mask is applied once per band, not re-derived in every handler.

### 8. Navigation is part of the canvas, not a fallback

- The **outline** remains the tree view and the accessible path to every card, portal, section and
  pin.
- A **Fit View** camera action frames the current View's bounds: live placements, sections, portal
  frames and pins on that root board. It is not recursive through portal contents; a nested board is
  represented by its portal frame. There is no cross-View fit in v1. The action changes the camera
  only: selection, focus path and the mounted editor set survive, and it follows the same zoom path
  as a manual zoom-out. A future “Fit all Views” would be a separate camera action, not a mode.
- The **Views switcher** lists framed boards; the **library** lists Views, Pins and saved filters.
- A **breadcrumb** follows the focus path (root View → portal → nested portal) and each step is a
  camera checkpoint.
- **Back/Forward** restores camera history; Escape restores the exact previous camera.
- A **scale indicator** shows the effective zoom and the current LOD band.
- A **minimap** is a later, passive overview in the same plane (band colouring, portal outlines,
  viewport rectangle, presence dots, click-to-jump). It is orientation scaffolding, not a second
  navigation surface; the evidence does not show an accuracy win, only a preference.
- **Edge arcs** for off-screen portals are a later option. Halo's measured benefit is for off-screen
  locations, not a whole-canvas minimap.
- Opening a workspace restores the last View and camera when it is valid; a deleted or out-of-scope
  View falls back to the root View's fitted camera.

### 9. Camera motion is not navigation state

The camera is ephemeral UI state. A View may remember a camera; a card drag, a portal entry and a
pin click move the camera but do not rewrite the document. Camera animation is limited to explicit
navigation actions (portal entry, pin, outline, back/forward) and is skipped under reduced motion.
Portal entry is a short three-beat transition (trim, translate, grow) of roughly 180–250 ms, not a
continuous cinematic flight; a large span is decomposed or cut. There is no invisible board swap and
no camera trick that makes two boards look like one.

## Experiments and success measures

These are alpha experiments, not promises. Each records its method and result in the parity
roadmap.

1. **Icon legibility.** 3 icon recipes (glyph; 2-line title; glyph + title + type dot) × 3 bands
   (0.18, 0.5, 1.0), 24 cards including deliberately confusable pairs. Success: icon band ≥ 85% of
   full-band accuracy, ≤ 1.5× median time-to-find, no confusable pair > 20% mutual confusion.
2. **LOD stability.** Hysteresis 0 / 80 / 160 ms × slow/flick sweep × text/image card. Success: 0
   band flips with hysteresis, ≥ 95% object constancy, p95 edit-entry < 150 ms, < 2 px layout shift,
   ≥ 55 fps.
3. **Overlay budget.** 200 visible cards / 40 editors / 6 portals on hardware. Success: p95 frame
   time < 16.7 ms during pan, INP < 200 ms, settle < 250 ms, mounted editors never exceed the cap,
   heap growth < 10% over 10 minutes.
4. **Camera flight.** 2×2×2: instant vs 250 ms × linear vs log-scale × into a depth-2 portal vs
   back. Success: animated log-scale cuts orientation errors ≥ 30% vs instant with ≤ +10%
   time-to-first-click; log-scale beats linear by ≥ 15%.
5. **Portal lostness.** Find a named card three portals deep, return, name the View you came from.
   Success: ≥ 80% orientation, median time ≤ 2× flat baseline, ≤ 1 backtrack, path efficiency ≥ 0.7.
6. **Two-phase settle.** Motion frame vs settle mount with a 6 ms deadline and 6 editors/frame.
   Success: first readable card ≤ 100 ms, settle ≤ 250 ms at 40 editors, no long task > 100 ms.
7. **Return route.** From a nested portal at `icon` zoom, return to the root View using the
   breadcrumb, then the outline, then a pin. Success: all three routes finish in ≤ 3 actions and the
   camera returns to the same View.


## Consequences

- **Icon collapse is the fractal effect, not its removal.** Position and footprint survive; content
  does not. The layout glyph recovers the part of the recursive rule that would otherwise be lost.
  **Falsifier:** if the icon field cannot be derived from the same card and portal positions, do not
  ship it as a transition. A separate graph layout would make the zoom a magic trick.
- **Hysteresis is a debounce, not the feature.** The feature is one spatial model across scales. The
  boundary stabilizer is small, testable and replaceable; it should not become a product mode.
- **Title presence is banded.** At the icon/compact boundary some cards show titles and some do not,
  depending on their on-screen footprint at that moment. That is correct scale-driven behaviour, not
  a rendering bug; a static screenshot can look uneven.
- **Fit View is a camera command.** It must not reset selection, the focus path or the editor set.
  If it tears down and rebuilds the visible window differently from a normal zoom-out, it has become
  a mode by behaviour even if it is a camera by name.
- **Crossfade costs DOM work.** Only band-crossing cards pay it, and the 24-card cap bounds the
  total. The GPU face must remain drawable while the DOM half mounts.
- **No edges at far zoom.** The spatial field stays legible; references are a separate, explicit
  view. This is a deliberate trade: the canvas shows where things are, the outline shows what they
  point at.
- **Views and Pins are navigation, not content.** They must be cheap to render and cheap to hide in
  a share.
- **The cap is a product limit.** When it is reached, the user sees a static card, not a missing
  one. The cap is published with the other limits once measured.

## Rejected alternatives

- **Continuous LOD.** It produces flicker, unpredictable editor mounts and no stable test target.
- **A graph of reference edges at far zoom.** It turns the spatial field into a hairball and makes
  position, the one signal that survives collapse, unreadable.
- **A force-directed graph mode.** It changes the spatial model, so zooming into it would not be
  continuous with the canvas. The invariant is **one spatial layout**: the canvas has exactly one
  position per object, and nothing else may pretend to be that layout. A retrieval layout, if one is
  ever added, is a separate surface outside this ADR's scope; it is not a canvas feature and not a
  “graph mode”.
- **A WebGL/WASM renderer that bypasses the DOM.** It would make the cards inaccessible and
  duplicate the editor model. The GPU draws the face; the DOM keeps the editor.
- **A minimap as the primary navigation.** It helps local orientation but cannot answer “which
  board is this?” or “where did I put that card?”. Views, Pins and the outline do.
- **Infinite nesting with no cap.** Cycles and pathological graphs need a guard; the document may
  keep the cycle, the view stops expanding.

## Amendment (2026-10-23): intent-gated editor mounts

The editor budget in decision 7 counts mounted editors. A band crossing is necessary but not
sufficient to spend one: a card that becomes `full` during a camera fly-through should not mount an
editor nobody asked for.

- **Intent gate.** A full-LOD card mounts its editor only when it is the active card: pointer over
  it, focused, selected with an edit gesture, or opened from the focus surface, held for about
  200 ms. Otherwise it keeps its static GPU face at full fidelity.
- **Mount on settle.** No editor mounts while the camera is moving. After the settle window, the
  incremental pass mounts in priority order (focused, selected, pointer, centre, z-order).
- **Suspend, do not unmount, during a camera move.** A mounted editor that is already open keeps its
  React tree and loses paint and pointer routing (`content-visibility: hidden`). Unmounting and
  rehydrating is more expensive than hiding, and rehydration is where editors lose caret state.
- **One editor per whiteboard, ever.** The whiteboard editor is the heaviest mount in the product;
  it gets its own single-instance rule (ADR-0034 amendment) rather than competing for the general
  budget.
- **Evidence.** `?perf=1` reports `mountedEditors`, `intentGated` and `settleMs`; the LOD
  experiments in §Experiments measure stability with the gate on.

This does not change the bands or the crossfade. It changes *when* the expensive face is allowed to
exist, which is the part that decides whether the frame budget survives a real workspace.
