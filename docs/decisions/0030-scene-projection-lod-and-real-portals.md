# ADR-0030: Scene projection, LOD bands, and real portals

- **Status:** accepted
- **Date:** 2026-10-23
- **Related:** [ADR-0017](./0017-spatial-sections.md), [ADR-0022](./0022-share-projection-links.md), [ADR-0029](./0029-portal-board-field.md), [`docs/architecture.md`](../architecture.md) §Rendering, [`docs/roadmap/alpha.md`](../roadmap/alpha.md) §7.4

## Context

A11 landed a portal as a card plus a static SVG miniature, and entering it as a camera transition:
an overlay grows from the portal's screen rectangle to the viewport, then `activeBoardId` changes
underneath it. That reads as a doorway, and it is honest about what it is — a board swap wearing a
zoom costume.

It cannot become the infinite canvas the product is built around:

- The target board is a picture at every zoom. Nothing inside it is live until the swap, so a
  portal never shows an edit, a peer's drag, or a nested portal as part of the same plane.
- Nesting stops at one level because the target is a different board with its own React Flow
  instance. A portal inside a portal has nowhere to render.
- There is no fractal arrangement. Cards and portals cannot be laid out recursively and read at
  several scales, which is the difference between a board that has doors and a canvas that is
  *self-similar*.
- The transition is a UI contract (`PortalNode`, `PortalTransitionLayer`, one-level acceptance)
  that the data model does not require. ADR-0029 was deliberately silent about it; the UI took the
  doorway metaphor further than the document did.

Neither available engine solves this by itself. React Flow has no persistent parent scale
transform: a node cannot contain a fully rendered, independently zoomable board. An engine that
does have a scene graph (ICE is the candidate) still cannot be the document, because Loro is the
only truth and the typed cards — Tiptap editors, properties, menus, selection, connectors,
sections, presence — must survive unchanged. Accessibility rules out moving the readable surface
into canvas/WebGL drawing.

Two questions therefore need answers: what is authoritative while a portal is open, and how much of
the graph may a scene instantiate at once.

## Decision

1. **The graph is the only truth.** `@suite/graph` keeps sole ownership of cards, placements,
   sections, edges and drawings. The scene is derived; it is never persisted, synced, or accepted as
   a write target. There is no engine document and no second undo stack.

2. **The scene is a pure projection.** A projection computes the render tree from a graph snapshot
   plus the camera: board instances, transforms, effective zoom, LOD bands, portal gates and
   projected edges. It is recomputed, not mutated in place. The pure layer is `packages/scene`
   (`@suite/scene`); it imports no React, DOM, engine or Loro code, so its transforms, gates and
   layout recipes are unit-testable.

3. **A portal is a live, scaled instance of its target board.** A portal card owns a child
   `BoardInstance` fitted into its frame at
   `scale = min(frameW / boardBounds.w, frameH / boardBounds.h) × padding`. Above the expansion gate
   the target's cards, sections, edges and nested portals are instantiated inside it; below it the
   portal renders its existing miniature as an **impostor**. The same board may appear in several
   instances, and every instance resolves to one canonical card and placement.

4. **LOD bands are discrete and hysteretic.** Effective scale, not animation state, selects `full`
   (≥ 0.75), `compact` (0.35–0.75), `icon` (0.12–0.35) or `hidden` (< 0.12). Downgrade happens
   immediately; upgrade waits for the higher threshold plus a dwell time (default 80 ms). The
   resolved band is stored per instance, never recomputed as a continuous function per frame. DOM
   editors mount only at `full`, within an explicit budget.

5. **Expansion is lazy and bounded.** Only subtrees the spatial index can show are considered, and
   only visible instances above the gate instantiate children. Expansion state is per instance and
   ephemeral. A repeated board path (`A → B → A`) stops at the cycle and renders a stub with a focus
   action; a hard depth cap (default 6, configurable) stops pathological graphs. Cycles stay legal
   in the document; the guard is a navigation and rendering concern, exactly as ADR-0029 decided.

6. **Navigation is camera-only.** The root board remains `activeBoardId` and board tabs keep their
   current meaning. Entering a portal pushes a camera checkpoint and the instance path onto
   `focusPath` and animates the camera to the child instance; back/Escape pops the path and restores
   the exact checkpoint. No overlay, no board swap, no white flash. Card focus mode uses the same
   camera path rather than a second document.

7. **The scene outline is the navigation and accessibility surface.** A derived tree of workspace →
   root board → portal instances → target boards → nested portals exposes the focus path, LOD and
   expansion state, peer presence and navigation actions. It is a projection of the same graph and
   scene, not a second model, and it is the fallback when the spatial canvas is not legible.

8. **Fractal layout is a one-shot command.** A recipe (grid, columns, rows, radial, spiral,
   phyllotaxis, rings, treemap) with per-depth overrides is computed into a plan, previewed, and
   applied as one field-granular batch and one undo step. There is no persistent live reflow and no
   background layout mode.

9. **Shares expand only what they contain.** A portal target renders live only when it is inside the
   share projection; otherwise the card reads as *Unavailable board*. Redaction runs before the
   scene is built, and a share never fetches or reveals owner-workspace content through a portal.
   Drawing content travels with the projection (ADR-0031).

10. **The surface is an engine-agnostic adapter.** A `SceneSurface` receives a scene frame, reports
    camera and gesture intent, and paints instances. React Flow is the parity baseline and fallback;
    ICE is a spike behind a flag. Proxies and the DOM card layer are shared, so the engine choice is
    reversible and a failed spike costs an adapter rather than the document.

## Rejected alternatives

- **A second document (or the engine's native document) as truth.** Two documents need a merge
  protocol, a second undo stack, and duplicate schemas for typed cards. It also breaks the
  local-first rule that one Loro doc is the workspace.
- **Keeping the overlay camera transition as the portal contract.** It cannot show live content
  before the swap, cannot nest beyond one level, and cannot express a fractal layout. The
  miniature-plus-overlay slice stays as a precedent for the impostor, not as the target.
- **Eager recursive rendering.** Instantiating every board reachable from the root multiplies DOM
  editors and gesture handlers, and a modest graph can contain a cycle. Lazy expansion with cycle
  and depth guards is the only bounded option.
- **Live reflow as a layout mode.** A per-frame layout engine writing placements violates the
  no-high-frequency-CRDT rule and fights concurrent peers. Layout stays a command that plans and
  commits once.
- **One-level nesting as the final shape.** The data model already permits arbitrary depth and
  cycles; a one-level UI would make a legal document unrenderable rather than merely unexpanded.
- **A canvas/WebGL-only card surface.** It would trade the real `NodeCard`/Tiptap surface and its
  accessibility for rendering speed nobody asked for at readable zoom.

## Consequences

- **The portal miniature becomes an impostor, not the entry mechanism.** `BoardMiniature` keeps its
  job below the expansion gate, and the far-LOD face of a portal stays cheap.
- **The scene is disposable, so cost is a rendering budget.** Recomputation is bounded by the
  spatial index, LOD proxies, expansion budgets and the depth cap; the outline and a debug overlay
  expose the counts. Profiling, not a second model, decides where to optimize.
- **Engine choice is no longer architectural.** React Flow can ship the scene first, and a later
  engine swap replaces the adapter. The ICE go/no-go gates decide whether the swap is worth it.
- **The outline and reader mode become load-bearing.** Far LOD hides text by design, so keyboard and
  non-spatial navigation are part of the feature, not a follow-up.
- **Shares and exports gain scope rules.** Portal targets and drawing content must be classified in
  every projection; an omitted target renders as unavailable rather than silently expanding.
- **Layout writes are plans.** One-shot recipes are conflict-safe and undoable, but they cannot
  react continuously to a peer's edit — the preview shows the plan and the user re-runs it.
- **ADR-0029's data model stands; its UI contract does not.** The `portal` type, `board` field kind,
  `createPortalCard`, reference-not-ownership and cycle legality are unchanged. The camera
  transition, one-level nesting and `PortalNode`/`PortalTransitionLayer` acceptance are superseded
  here.
- **Nothing in this ADR claims a finished feature.** Primitive scene projection, outline and
  focus-path work exists behind a surface flag, but the full scene surface, live portals, wired
  outline and recipes are A11a/A11b work; the default canvas stays the React Flow flow surface until
  the gates pass.
