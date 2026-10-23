# ADR-0033: The interactive scene surface

- **Status:** accepted; amended by [ADR-0034](./0034-ice-primary-rendering-engine.md) — this surface becomes the reference implementation, not the product target
- **Date:** 2026-10-23
- **Related:** [ADR-0029](./0029-portal-board-field.md), [ADR-0030](./0030-scene-projection-lod-and-real-portals.md), [ADR-0031](./0031-whiteboard-cards-and-loro-binding.md), [ADR-0032](./0032-ice-engine-deferral.md), [ADR-0034](./0034-ice-primary-rendering-engine.md), [`docs/architecture.md`](../architecture.md) §Rendering, [`docs/roadmap/alpha.md`](../roadmap/alpha.md) §7.3

## Context

ADR-0030 decided the target: a derived scene where a portal is a live, scaled board and the camera
is the only navigation. A11a landed that projection read-only behind `?canvas=scene` — recursive
live portals, LOD and hysteresis, impostors, culling, an outline and a camera-only focus path — while
`CanvasBoard` stayed the default and owned every gesture.

A projection nobody can touch is not a canvas. Selection, dragging, resizing, editing, creation and
menus have to work on the scene itself, or the default surface cannot move and the flow surface
stays the product in practice. Two constraints narrow the options:

- **A portal scales an entire child board.** React Flow has one flat node space and a node cannot
  contain a scaled, independently zoomed board, so turning cards into React Flow nodes reintroduces
  the board swap ADR-0030 rejected.
- **ICE is deferred (ADR-0032).** The interaction contract has to be engine-neutral, or the spike
  becomes a rewrite of the feature instead of a new adapter.

## Decision

1. **React Flow remains the camera; the projection remains the single layout authority.**
   `SceneCanvas` mounts an empty React Flow instance (`nodesDraggable`, `nodesConnectable`,
   `elementsSelectable` and `selectionOnDrag` off, `panOnDrag={[1, 2]}`, `deleteKeyCode={null}`) and
   renders `SceneLayer` inside `ViewportPortal`. The camera comes from `useViewport`; every box the
   layer paints is in page space. No card, section, edge or portal is a React Flow node, so React
   Flow cannot hold a second opinion about where anything is.

2. **Pointer interaction is custom, over the DOM scene layer.** `useSceneInteraction` converts a
   pointer to a page point with `screenToPage`, hit-tests the pure scene (`@suite/scene` `hitTest`)
   and keeps one gesture at a time: card drag, section drag, resize, connector drag, marquee and edge
   press, with cards winning the pick over the section that contains them. Movement below 3 screen
   pixels is a click, not a drag. A drag maps the page delta through the hit instance's transform, so
   a card inside a scaled portal moves in its target board's units and a card selected through two
   instances moves once. Left drag belongs to the surface; middle/right still pan and the wheel still
   zooms.

3. **Live state is ephemeral; each gesture commits once.** Drags, resizes and the marquee paint
   page-space overrides keyed by instance key and never write. On release the surface writes through
   `WorkspaceDocument`: `movePlacements` (once per board the gesture touched),
   `moveSectionsBatch` (a section, its contained cards and nested sections in one commit),
   `updatePlacementGeometry`, `updateSectionGeometry`, or one `addEdge` from a connector drop. A
   click, a sub-epsilon move, a viewer and a cancelled pointer write nothing. Undo therefore sees one
   step per gesture, and every instance of the moved card agrees once the drop lands.

4. **LOD decides the face, and `full` is the real card.** At `full`, `SceneLayer` mounts
   `SceneCardView`, which is the actual `NodeCard` with its Tiptap title and body, card menu, move
   targets, trash and peer chips; a whiteboard mounts its preview and opens the existing focus
   surface. `compact` and `icon` keep static faces, and a portal below its expansion gate keeps the
   impostor. `SceneCardView` writes nothing on mount, honours `editingSurface` so the panel and the
   scene never both own a caret, and is only mounted for full-LOD instances — culling and hysteresis
   are the editor budget. **Connector dots are suppressed inside the live card**
   (`showConnectors={false}`) and drawn by the scene overlay instead, at scene scale, for the single
   selected card; dragging one of those handles onto another card creates the edge with the canonical
   anchors.

5. **One context menu, shared by both surfaces.** The `CanvasBoard` menu builder moved into
   `useCanvasMenuItems` (`buildCanvasMenuItems`), which receives the context (`canvas`, `node`,
   `section`, `edge`, `connector`), the capability flags and every action as a callback. Both boards
   call it, so creation, portal targets, fractal arrangement, layer actions, share and trash cannot
   drift into two implementations. The scene converts a right-click to the hit instance's board
   point before opening the menu.

6. **Presence is projected, not duplicated.** The scene publishes the same samples the flow surface
   does — pointer, the canonical set of a drag with its board id, card and section resizes, section
   drags, the marquee box and the closed selection — through the shared presence store and throttles.
   `SceneBoard` filters with `useBoardPeers(rootBoardId)` (presence is workspace-wide and every
   board-scoped surface filters by `peer.board`), and `scenePresence.ts` projects each sample into
   page space through the instance transforms, so a peer's selection ring, gesture ghost and pointer
   appear on every visible instance the scene holds of that card or section. A viewer publishes
   selection and marquee but never a drag, and a peer sample the projection does not contain is
   ignored, so a share cannot reveal content it does not hold.

7. **The scene is the default; the old surface stays reachable.** `canvasSurfaceFromSearch` returns
   `scene` for every value except `?canvas=flow` and `?canvas=ice`. Flow is the legacy escape hatch
   the scene badge links to. ICE is the experimental spike of ADR-0032, loaded lazily and never the
   document truth.

8. **A new workspace opens something worth looking at, and the old local cache is abandoned.**
   `seedExampleWorkspace` writes the example — three boards, fourteen cards, four portals including a
   depth-two hop and a cycle, four sections, tags, two typed properties, one labelled edge and one
   whiteboard scene — and arranges it with the shared fractal planner. It runs once per document on
   `?fresh=1`; `?blank=1` seeds nothing for count-sensitive tests. The local IndexedDB cache is now
   `suite-loro-scene`, so the previous `suite-loro` database is never read again and old sample data
   cannot leak into the new canvas. Server rooms are untouched and re-sync on open.

## What is wired, and what is not

Implemented, with the code that carries it:

| Behaviour | Where |
| --- | --- |
| Click, shift-click, marquee, click-empty clear | `apps/canvas/src/scene/useSceneInteraction.ts`, `packages/scene/src/interaction.ts` |
| Multi-card drag with one commit per board | same, plus `WorkspaceDocument.movePlacements` |
| Card resize from eight handles, at camera zoom, inside portals | `useSceneInteraction.ts`, `sceneSelection.ts`, `SceneLayer.tsx` selection overlay |
| Section select, drag (members ride along) and corner resize | same, plus `WorkspaceDocument.moveSectionsBatch` |
| Edge select with highlight, edge menu and description | `SceneLayer.tsx` edge layer, `useCanvasMenuItems.ts` |
| Connector handles on the single selected card, drag-to-connect | `sceneSelection.ts`, `useSceneInteraction.ts` |
| Peer selection rings and gesture ghosts on every visible instance | `apps/canvas/src/scene/scenePresence.ts`, `SceneLayer.tsx` |
| Peer pointers, clipped to the portal they are over; outbound presence samples | `scenePresence.ts`, `useSceneInteraction.ts`, `SceneBoard.tsx` (`useBoardPeers`) |
| Viewer and share caps: select/marquee only, no drag, resize, create or connect; out-of-scope peers ignored | `SceneBoard.tsx`, `useSceneInteraction.ts`, `scenePresence.ts` |
| Portal entry from a portal header or a collapsed frame; Escape restores the camera | `SceneBoard.tsx` focus path, `SceneLayer.tsx` |
| Live `NodeCard`/Tiptap at `full`, static faces below it | `SceneCardView.tsx`, `SceneLayer.tsx` |
| Shared menu on both surfaces | `apps/canvas/src/canvas/useCanvasMenuItems.ts` |
| Demo seed, deterministic arrangement, surface default | `apps/canvas/src/demo/seedExample.ts`, `apps/canvas/src/scene/surfaceFlag.ts` |
| Outline rail with keyboard navigation and focus actions | `SceneOutline.tsx`, `outlineAdapter.ts` |

Not wired, and deliberately not claimed:

- **Connector parity is partial.** The overlay draws the four side handles only while a single card
  is selected (`resolveConnectorHandles` needs one selected id at `full` or `compact` LOD), so
  connectors are not discoverable before selection, and the connector menu — reposition, delete —
  cannot be opened on the scene because `NodeCard`'s own dots are off. Drag-to-connect is the only
  connector gesture, and it needs the content capability.
- **Keyboard on the canvas is Escape only** (the focus path claims it first, then the surface clears
  its state). The outline rail has its own arrow/Home/End/Enter navigation. Delete/Backspace trash or
  unplace and arrow nudges are flow-surface shortcuts, not scene ones; trash and unplace are
  reachable from the menu.
- **Reveal is not wired.** `focusTarget` (the inspector's and board outline's "show on board") is
  consumed only by `CanvasBoard`, so a reveal on the scene does not move the camera or expand
  ancestors.
- **Creation targets the root board.** The menu converts the click to a board point, but note,
  whiteboard, section and portal creation all write to `rootBoardId`, so a right-click inside an
  expanded portal does not create inside the target board.
- **No frame-time claim.** The bound is still culling plus LOD plus the depth cap; a deterministic
  `buildScene` smoke and the `?perf=1` counters exist, but nothing measures frame time, GPU memory or
  mounted editors.
- **E2E covers five things** in `e2e/tests/scene.spec.ts`: a seeded scene on a new workspace, portal
  focus with Escape restore, note creation from the canvas menu, a `?perf=1` smoke check that the
  scene's own render counters and non-zero badge counts appear, and the legacy flow route. Peer
  presence projection and publication have component tests; depth ≥ 2 live rendering, cycles,
  drag/resize in a browser, commit counts, presence and share scope do not.
- **Verification artifacts exist, without a frame-time claim.** A visual baseline covers the
  recursive-portal scene (`e2e/tests/visual.spec.ts`, `visual/scene-recursive-portals.png`) and
  `packages/scene/src/scene.perf.test.ts` times `buildScene` at 1k/5k objects against a fixed ceiling.
  Neither measures frame time, GPU or mounted editors, and no such number is quoted here.

## Rejected alternatives

- **Cards as React Flow nodes.** The flat node space cannot scale a whole child board, portals would
  have to become board swaps again, and a second layout authority appears beside the projection.
- **A second document for the scene (or the engine's).** ADR-0030 rejected it; interactive editing
  makes it worse, because every drag would need a merge protocol and a second undo stack.
- **Reusing React Flow's selection, drag and resize handlers.** They operate on flow nodes that no
  longer exist, and their coordinate model cannot express a nested board.
- **Waiting for ICE to get interaction.** It would make the deferred spike a prerequisite for the
  default surface, and gate 2 (DOM card parity) already says the cards stay DOM.
- **Recording live geometry in the CRDT.** Per-frame writes fight peers and break one-undo-per-
  gesture; the override map is the whole reason a drag feels local.

## Consequences

- **One document, one undo stack, one layout authority.** A gesture is a command, not a stream, and
  the flow surface remains a working fallback for any flow-only feature.
- **The scene stays engine-neutral.** Everything the surface needs from a renderer is a camera, a
  pointer mapping and a DOM layer, so an ICE adapter would reuse `@suite/scene` unchanged — or fail
  on gates 2, 4 or 5 without taking the document with it. ADR-0032 keeps its status; this ADR adds no
  ICE dependency and does not answer its gates.
- **The gaps are visible, not silent.** Connector discoverability and repositioning, `focusTarget`
  reveal and the missing e2e cases are the next parity work, and a reader of this ADR should assume
  they are missing until the roadmap says otherwise.
- **Presence is shared with the flow surface.** One store and the same throttles, so a peer's
  gesture is visible whichever surface the two of you are on, and a share viewer's selection is
  published without ever publishing a drag.
- **`SceneCardView` is not free.** A full-LOD instance mounts a real editor, so zooming a portal
  open costs DOM editors. Culling and hysteresis bound it; a numeric editor budget and a frame-time
  measurement are still outstanding.
- **The seed is versioned, not migrated.** `DEMO_SEED_VERSION` identifies the shape, `?blank=1`
  keeps tests exact, and the renamed cache means a developer's old local document is abandoned
  rather than migrated. A server workspace still holds whatever it held.
- **E2E is thinner than the feature.** The five scene specs prove the route, the seed, portal focus,
  menu creation and that the render counters exist; they do not yet prove depth, cycles, commit
  counts or presence, so A11a stays `measuring`.
