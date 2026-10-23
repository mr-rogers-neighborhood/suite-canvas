# ADR-0034: ICE is the primary rendering engine

- **Status:** accepted
- **Date:** 2026-10-23
- **Related:** [ADR-0029](./0029-portal-board-field.md), [ADR-0030](./0030-scene-projection-lod-and-real-portals.md), [ADR-0031](./0031-whiteboard-cards-and-loro-binding.md), [ADR-0032](./0032-ice-engine-deferral.md), [ADR-0033](./0033-interactive-scene-surface.md), [ADR-0035](./0035-views-pins-and-portals.md), [ADR-0036](./0036-fractal-lod-and-icon-graph.md), [`docs/roadmap/ice-parity.md`](../roadmap/ice-parity.md)

## Context

The React Flow scene proved the product model: a derived scene over the Loro graph, real recursive
portals, LOD bands, a DOM card layer and one canonical write per gesture. It cannot become a true
infinite canvas. React Flow has one flat node space, so a portal must be a scaled DOM board inside a
camera, and the board switch is only hidden by making the camera and the projection agree. That is a
camera trick, not a different topology.

ICE (`@vibecook/ice@0.16.0`) has the topology we need: a native world with nested containers, a
continuous camera, a spatial index, an ECS document and WebGPU object faces. The spike has now
proved the parts that were speculative:

- Headed Chrome with Vulkan acquires an NVIDIA Ampere adapter on the reference machine; the
  launcher, adapter HUD and device-loss diagnostics are repeatable.
- The native desk seeds, pans, zooms, selects and drags at hardware frame rates.
- A one-way Suite projection maps the example workspace into nested ICE containers without writing
  to the graph.
- A custom `suite.card` kind can draw its GPU paper body and mount the **real** `NodeCard` in a
  screen-space DOM overlay, positioned from `geometryOf()` each frame, unmounted below readable
  width.
- ICE's own selection, drag, pan and zoom still target the GPU rect while the overlay is
  `pointer-events:none`.

The remaining work is parity, not feasibility. The React Flow surface is now a reference
implementation and a temporary development escape hatch, not the product target.

## Decision

1. **ICE is the primary rendering engine for the infinite canvas.** The product moves from a
   one-board-at-a-time surface to one continuous world. The React Flow scene stays in the tree only
   until the parity gate below is met, then leaves the user path and is deleted.

2. **The graph is still the only document truth.** `@suite/graph` and `WorkspaceDocument` own cards,
   placements, sections, edges, drawings, views and pins. ICE owns camera, spatial indexing, input
   and GPU faces. ICE ECS records are disposable projection state and never survive as document
   records. `@suite/scene` remains the pure, engine-neutral semantic projection; the ICE adapter may
   replace React Flow as the host, not the meaning of a portal, section, edge or card.

3. **WebGPU is a product requirement, not an optional enhancement.** A browser without
   `navigator.gpu`, an adapter, or a usable device gets a dedicated unsupported screen with the
   reason, a diagnostics copy action and a link to requirements. It does **not** get the React Flow
   canvas. Device loss is treated as a recoverable runtime condition: the surface stops drawing,
   says so, offers reload/reset, and never writes partial state.

4. **`suite.card` is the parity bridge.** A Suite card is a custom ICE object kind with:
   - a GPU paper/body face reusing the built-in paper program;
   - a screen-space DOM half that mounts the real `NodeCard`, Tiptap editors and menus at the
     object's resolved geometry;
   - a readable-width gate with hysteresis, so the DOM editor exists only at full LOD;
   - a mode switch that gives the overlay pointer input for text editing while ICE keeps pan,
     zoom, selection and drag outside the editor.

   No second card renderer is designed. The existing `NodeCard` is the card.

5. **One interaction bridge, one undo stack.** ICE's native history is disabled for document
   gestures. Selection, drag, resize, create, delete, edge and section changes report intent to a
   Suite bridge; live motion stays ephemeral; pointer-up performs one `WorkspaceDocument` commit per
   gesture. Undo and redo call Loro's `UndoManager` only. A gesture that has no bridge yet is not
   silently written into ICE's document.

6. **Excalidraw is a card, never the canvas engine.** The whiteboard keeps the existing Excalidraw
   card and Loro drawing binding. Its card face is a cached preview; at full LOD it may mount the
   real Excalidraw surface inline, and the existing focus surface remains available for deep
   editing. Excalidraw's internal camera is local to the card and never becomes the workspace
   camera. The Suite property inspector and card chrome stay DOM.

7. **Rollout is flag-first, then default.** `?canvas=ice` is the alpha proving ground. ICE becomes
   the default only after the P0 gate below has evidence. The React Flow scene and flow surfaces may
   remain behind development-only flags during the port, but they are not a user-facing fallback.
   Once P0 passes, the default and all share links open ICE; React Flow code is removed in a
   follow-up change.

## P0 parity gate

ICE is not the default until each row has an artifact a reviewer can open.

| Area | Required evidence |
| --- | --- |
| Boot | A real workspace hydrates from IndexedDB into ICE; no demo seed; reload returns the same camera and content; a new workspace can be seeded or blank |
| Cards | Real `NodeCard` at full LOD: title/body Tiptap, type glyph, tags, property chips, card menu, move targets, trash; property inspector still edits the canonical card |
| Whiteboard | Preview below full LOD; inline Excalidraw or focus surface at full LOD; drawing writes through the existing drawing API; inspector and card chrome unchanged |
| Gestures | Select, shift-select, marquee, drag, resize, create, delete; one Loro commit per gesture; viewers cannot write |
| Sections and edges | Section select/drag/resize; edge select/create/delete and labels; connector handles and anchors; these are custom ICE kinds or a documented overlay, not a second layout authority |
| Portals | A portal is one canonical board shown through a view; multiple placements are preserved; depth ≥ 2 expands lazily; cycles stop at a stub; entry moves the camera with no board swap |
| Collaboration | Presence pointers, selection rings, live drag ghosts and carets map into every visible instance; share scope and read-only caps match the scene surface |
| Undo | ICE history disabled; Loro undo/redo restores one gesture per step; remote edits do not enter the local undo stack |
| Persistence | Local IndexedDB, relay sync and share rooms survive ICE mount/unmount; closing the surface disposes the device without dropping a write |
| Failure | No WebGPU, no adapter, refused import, engine failure and device loss each show the right state; recovery never shows a blank canvas |
| Accessibility | Scene outline and keyboard path reach every card and portal; focus order is stable; the canvas has an accessible description; reduced motion is honoured |
| Budget | 1k and 5k object fixtures on hardware: frame time, mounted DOM editors, GPU memory, time to interactive and device-loss rate recorded against the React Flow baseline |

P1 after the gate: persisted View cameras, Pins, saved filters, fractal layout presets, crossfade
polish and a minimap. These are specified in
[ADR-0035](./0035-views-pins-and-portals.md) and
[ADR-0036](./0036-fractal-lod-and-icon-graph.md).

## Consequences

- **The product gains a true topology.** Nesting, portals, zoom and pan are one world; no camera
  trick is needed to make a board look infinite.
- **WebGPU becomes a support boundary.** The alpha must publish requirements, detect failure
  honestly and treat unsupported browsers as unsupported rather than degraded. This is a smaller
  promise than a second renderer that cannot reach parity.
- **The DOM card layer remains the hard part.** GPU faces are cheap; mounted Tiptap editors are not.
  The readable-width gate, editor budget, culling and one-editor-per-card rule are product
  requirements, not optimizations.
- **The bridge is the safety-critical seam.** A missed inverse transform, a second undo stack or a
  write during pointer movement would corrupt work. The bridge contract and its tests land before
  the default flips.
- **The React Flow code is temporary.** Keeping two interactive surfaces in sync is not a long-term
  architecture. The reference surface is deleted once P0 passes.
- **The alpha is explicitly experimental.** ICE is pre-1.0 and WebGPU support varies by platform.
  The docs, launcher and diagnostics must say so without making the product feel unfinished.

## Rejected alternatives

- **Keep React Flow as a fallback forever.** It cannot express the target topology, and two
  interactive surfaces double every feature and bug. A clear unsupported screen is more honest.
- **Run Excalidraw as the canvas engine.** Its infinite zoom is a scene inside a card, not a
  document model for typed cards, portals and CRDT collaboration. It remains a whiteboard card.
- **Put the graph in ICE's ECS.** It would create a second document, a second undo stack and a merge
  protocol. The ECS is projection state.
- **Keep ICE's undo for canvas gestures.** Two histories cannot agree about a drag that also
  changes a Loro placement. Loro's history is the only user-visible one.
