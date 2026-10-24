# ADR-0040: The type graph is withdrawn (and so are the outline rail and the ambient layer)

- **Status:** accepted — supersedes [ADR-0037](./0037-graph-projection-and-ambient-layer.md)
- **Date:** 2026-10-23
- **Related:** [ADR-0036](./0036-fractal-lod-and-icon-graph.md), [ADR-0039](./0039-boards-are-containers-views-are-cameras.md), [ADR-0034](./0034-ice-primary-rendering-engine.md)

## Context

[ADR-0037](./0037-graph-projection-and-ambient-layer.md) shipped a type-graph projection drawn over
the canvas at far zoom, plus an "ambient layer" of desk cues. Two neighbours shipped with it: an
outline rail listing the Boards as a tree, and a "Types in view" table in the inspector. A cloud-shade
experiment was attempted on top of that layer.

All four were reviewed against what they actually answered. None of them survived:

- **The type graph** answered *"what is on this canvas"* one zoom level away from the canvas itself.
  Its answer — containment, types, counts — was already in the inspector and the library. It was a
  third surface for one question, and the most expensive thing in the app: two ICE kinds, a
  screen-space face layer, a derived-depth model, a zoom band, a table, a store request channel, a
  breadcrumb and a keybinding.
- **The outline rail** drew a tree of Boards that the canvas already draws as mats, and shared its
  grouping code with the library — so the same structure had two renderings and one of them could not
  be dragged.
- **"Types in view"** was the library's type facet wearing an inspector's clothes.
- **The cloud shade** could not work through the engine: ICE lights the mat with a **gobo projector
  whose footprint is a fixed patch of desk in metres**, so any plate we generate covers a small
  rectangle rather than the canvas. The DOM-layer alternative was a composited full-viewport layer
  above a WebGPU surface, which measured 42 → 35 fps (and `mix-blend-mode: multiply` was the main
  cost) for pure decoration.

## Decision

1. **Delete the type-graph overlay**: `iceGraphBand`, `suiteTypeNodeKind`, `suiteContainerNodeKind`,
   `suiteGraphFace`, `suiteGraphDepth`, `TypeTable`, `useTypeTable`, the store's `graphViewRequest` /
   `graphFrameTypeRequest` channels, the `g` keybinding and the breadcrumb.
2. **Keep the pure projection.** `packages/scene/src/typeGraph.ts` and its tests stay in the tree,
   unused, with a header note. The *idea* — a lens that helps you see structure — is not disproven;
   this implementation is.
3. **The control stays and changes job.** The zoom cluster's graph button becomes **Types**, and opens
   the manage-types dialog that already exists (`openTypeSettings`). Same slot, no new surface.
4. **Delete the outline rail** (`BoardOutline`, its CSS and spec). The library's Board grouping keeps
   the part it needs, as `boardRows`.
5. **Delete the ambient layer and its plate generator.** The desk's shipped tree-shadow dapple is
   switched off (`gobo.opacity = 0`) rather than replaced: a projector we do not control cannot be
   made to cover an infinite canvas.
6. **The desk becomes neutral**, because it was competing with its own contents: see the next section.

## The desk, after the withdrawal

With the overlay gone, the mat is the only thing left in the background, and the green cutting mat was
louder than the cards on it. The desk is now a **neutral cloth in both themes**, and the rule it
follows is:

> **The desk is a surface; a card is an object lying on it.**

So the ground is always the middle value of its theme — a charcoal *above* a dark card's
`--surface: #232326`, and a warm off-white *below* a light card's `#ffffff`. A near-black desk turns
cards into windows; a paper-white desk makes them disappear. Colour belongs to what the user put
down: a card's paper, a Board's accent.

The felt, the grain and the lattice are kept — that is what stops either ground reading as a flat
fill — and the lattice is tuned so it is visible in both (`alphaThick` 0.16 dark / 0.13 light).

**Measured, not guessed.** ICE's night chain (linearise → the Moon's exposure → the eye) is a steep
tone curve that also tints blue, so the *value a host passes* is not the value on screen: 0.5 lands at
`#2d353c`, 0.78 at `#3f4649`. The shipped dark ground is calibrated to land on a neutral `#3f4244`;
the light one is near-white and needs no compensation. This is the kind of thing to re-measure on a new
ICE version.

## Consequences

- Roughly 3,900 lines removed; the canvas has one background layer again, and the zoom cluster has four
  controls that all move the camera or open a dialog.
- The `scene` package no longer exports anything the canvas draws; `typeGraph.ts` is the only survivor
  of the lens experiments, and it is dead code by design. If it is still unused after the next two
  phases, delete it rather than let it rot.
- **What a future lens must answer**, if one is attempted: a *specific* question the canvas cannot
  answer at its own zoom (not "what is here" — that is the canvas), rendered as a modification of what
  is already drawn (dimming, framing, focusing) rather than a second picture of it.
- The `Types` button is gated by `openTypeSettings`'s own rights check, so a seat without schema
  permission gets a control that does nothing. That should either be hidden for such seats or open a
  read-only list; pinned as a follow-up rather than fixed here.
