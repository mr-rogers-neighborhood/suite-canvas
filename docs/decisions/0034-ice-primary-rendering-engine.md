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

   No second card renderer is designed. The existing `NodeCard` is the card. The overlay reads the
   same semantic model and the same canonical placement as the canvas; it does not introduce a
   second layout, a second position source or a second selection authority. ICE geometry is a view
   of the placement, never a replacement for it.

5. **One interaction bridge, one undo stack.** ICE's native history is disabled for document
   gestures. Selection, drag, resize, create, delete, edge and section changes report intent to a
   Suite bridge; live motion stays ephemeral; pointer-up performs one `WorkspaceDocument` commit per
   gesture. Undo and redo call Loro's `UndoManager` only. A gesture that has no bridge yet is not
   silently written into ICE's document.

   The write path is a **one-way funnel into Loro**. The projection is always downstream of the
   document: `WorkspaceDocument → projection → ICE`. No ICE ECS record, gesture or undo entry
   becomes document truth, and the projection never writes back. The “not document truth” HUD stays
   true after writes land because writes enter through the same plan of record
   ([ADR-0020](./0020-main-and-loro-plan-of-record.md)), not through the renderer.

6. **Excalidraw is a card, never the canvas engine.** The whiteboard keeps the existing Excalidraw
   card and Loro drawing binding. Its card face is a cached SVG preview; at full LOD it mounts the
   real Excalidraw surface inline, and the existing focus surface remains available for deep
   editing. Excalidraw's internal camera is local to the card and never becomes the workspace
   camera. The Suite property inspector and card chrome stay DOM. The inline mount is budgeted:
   **at most one** Excalidraw instance is mounted, the preview is the underlay so there is no blank
   frame, and the mount decision is intent-gated (see the amendment below).

7. **ICE's native spatial affordances are kept.** Snap guides, equal-spacing bars, auto-alignment,
   `arrange`, `frameContent`, container entry/exit, `setLocked` and `reorder` are product assets,
   not implementation details to replace with a React Flow clone. Parity means the Suite behaviour
   — typed cards, portals, sections, edges, shares, undo — on top of ICE's spatial model. The bridge
   commits the **final, snapped ICE rect** inverse-transformed into canonical board coordinates; it
   does not derive a position from the raw pointer delta and does not add a second alignment system.

8. **The Suite shell stays exact.** ICE is the canvas layer, not the product shell. The launcher,
   title bar, library, drawers, property inspector, card menus, share dialogs, settings, theme and
   routing remain the Suite components. Do not adopt ICE's tray, drawer, board chrome or HUD as the
   product UI; the ICE HUD is a development affordance only. The shell is already the product; the
   port replaces what is under the canvas, not what surrounds it.

9. **Rollout is flag-first, then default.** `?canvas=ice` is the alpha proving ground. ICE becomes
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

### The Failure row, re-checked (2026-10-25)

The table says the Failure row needs evidence, so it was exercised against the app as it
now is. All five states are reachable and all five show something a reader can act on;
two things were false and are fixed. The screens live in `IceSurface.tsx` and are pinned
by `IceSurface.test.tsx`; the import path is the launcher, not the canvas.

| State | What reaches the seat | Verdict |
| --- | --- | --- |
| No WebGPU (`navigator.gpu` missing) | `phase: unavailable`, reason `api`; "This browser has no WebGPU", how to run it locally, the browser versions that work, the adapter line `engine: no WebGPU`, **Copy diagnostics** and **Reload workspace** in the HUD | true |
| No adapter (an API but `requestAdapter()` refuses) | `phase: unavailable`, reason `adapter`; "WebGPU has no graphics adapter"; the adapter line says `not acquired` | true |
| Device loss (`layerStatus.state === "failed"`) | `phase: failed`, reason `device-lost`; "The graphics device was lost", the promise that nothing was written, and the button this seat actually has | true after the fix below |
| Refused import | The launcher's import error: `importWorkspaceFile` rejects a backup it cannot read and the launcher prints the reason; no workspace id, key or recents entry is created. A share link whose cards are gone opens on "Nothing to show — these shared cards were moved or deleted" | true |
| Unsupported screen | The fallback card, and **no canvas**: the React Flow surface is deleted, so a browser without WebGPU never gets a second renderer | true after the fix below |

Two fixes: the unsupported screen had the reason, the run instruction and the HUD's copy
action, but the promised *link* to the requirements was prose ("Chrome 113+, Edge 113+,
Safari 26+"). It now carries a real link (`ice-fallback-requirements`). And the
device-loss copy told a workspace seat to "Reset demo" — the button in front of it says
"Reload workspace" — so the sentence now names the button the seat has.

The other two rows this phase touched are recorded in
[`docs/roadmap/ice-parity.md`](../roadmap/ice-parity.md) §9: **Accessibility** is
partial and stays P0 for the objects themselves (the surface has a description, a live
summary and a documented keyboard; the cards are WebGPU rasters and are read through the
library and the inspector), and **Budget** has 1k/5k mount-cost and memory numbers in
Node (`apps/canvas/src/ice/icePerf.test.ts`) with GPU frame time still unmeasured at
scale.

P1 after the gate: persisted View cameras, Pins, saved filters, fractal layout presets, crossfade
polish and a minimap. These are specified in
[ADR-0035](./0035-views-pins-and-portals.md) and
[ADR-0036](./0036-fractal-lod-and-icon-graph.md).

## Consequences

- **The product gains a true topology.** Nesting, portals, zoom and pan are one world; no camera
  trick is needed to make a board look infinite.
- **Parity is behavioural, not a pixel replica.** Suite keeps its cards, portals, sections, edges,
  shares and undo, but ICE keeps the spatial model it already solved better: snapping, equal
  spacing, auto-alignment, arrange, frame-content and container navigation. A React Flow-shaped
  clone of those would be a regression.
- **Version skew is recorded.** The installed `@vibecook/ice@0.16.0` does not expose
  `renderSubtreeTo` or a virtual-child-source API. Upstream ICE documentation describes those
  features in a different line, so do not assume upstream docs apply to this pin. The port uses
  nested containers, the spatial index and culling; it does not depend on those primitives.
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
- **The shell is not part of the bet.** The launcher, title bar, library, drawers, inspector, menus,
  shares and theme stay exactly as they are. ICE replaces the canvas substrate, not the product
  around it; adopting ICE's tray or drawer would throw away the part that already works.
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

## Amendment (2026-10-23): the inline whiteboard ladder

Decision 6 says the whiteboard may mount inline at full LOD. That "may" is now a measured ladder,
because an Excalidraw instance is the most expensive DOM surface in the product and the immersive
version must not be bought with the whole frame budget.

**The mount gate is intent plus budget, not scale alone.** LOD says the card is big enough; intent
says the user is actually working on it. A whiteboard mounts its editor only when it is the *active*
whiteboard: pointer over it, focused, or opened from the focus surface, held for roughly 200 ms. A
camera fly-through at `full` keeps the SVG preview. Exactly one Excalidraw instance exists at a
time; every other whiteboard renders its preview.

**The preview is the underlay.** `WhiteboardPreview` is vector, so it is crisp at any zoom. It stays
mounted beneath the editor until the editor's first paint, which removes the blank frame and makes
the upgrade a crossfade rather than a swap.

**Camera isolation.** The stage is `pointer-events:none` until edit mode. Entering edit mode is
explicit (click/dwell, or Enter); Escape leaves it, and the caller decides whether Escape first pops
the card camera or the editor. Wheel and pointer are stopped at the card boundary, so Excalidraw's
own pan/zoom stay local and the workspace camera keeps the wheel outside the card. While the
workspace camera moves, the editor is suspended with `content-visibility: hidden` rather than
unmounted, so there is no rehydration cost and no paint work during the flight.

**The ladder, measured at each rung.**

1. **Single keyed mount.** Reuse `WhiteboardSurface` unchanged, keyed by card id. The lazy Excalidraw
   module imports once per session; switching between two whiteboards pays a remount.
2. **Roaming stage.** If that remount is visible, hoist one `WhiteboardSurface` into a screen-space
   stage and move/resize it to the active card, swapping the scene with
   `updateScene({ resetScene })`. This needs a `sceneIdentity` prop so the commit-signature refs
   reset per card without emitting a phantom commit. The focus surface keeps working unchanged.
3. **Focus surface only.** If inline editing cannot hold budget, keep the focus surface and leave
   the inline work behind a flag. The product still ships; the immersive version ships when it is
   measured.

**Rung 3 triggers.** A blocking mount over ~50 ms, p95 frame time above 16.7 ms while panning with
an editor mounted, memory growth above 10% over ten minutes, or any case where the editor's internal
camera fights the workspace camera.

**Why this is still worth doing.** The whiteboard is the one card type whose *content* benefits from
an infinite camera of its own. Inline editing is the difference between "a preview of a drawing" and
"a drawing on the canvas". The ladder keeps that experience while making the cost bounded and
visible, instead of discovering it as a regression later.
