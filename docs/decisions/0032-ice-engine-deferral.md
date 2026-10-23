# ADR-0032: Defer the ICE engine spike until the scene surface is the default

- **Status:** accepted
- **Date:** 2026-10-23
- **Related:** [ADR-0030](./0030-scene-projection-lod-and-real-portals.md), [ADR-0029](./0029-portal-board-field.md), `apps/canvas/src/scene/`, `packages/scene/`

## Context

ADR-0030 made the scene projection the engine-neutral contract and named three surfaces:
React Flow as the parity baseline, ICE as the primary engine spike, and Excalidraw as a
whiteboard card. The React Flow scene baseline is now implemented behind `?canvas=scene`:
real recursive portals, LOD/hysteresis, impostors, culling, a scene outline and a camera-only
focus path.

ICE (`@vibecook/ice@0.16`) is the closest architectural match for the target experience:
native nested mini mats, portal-like zoom-through, a CRDT-synced ECS world, a spatial index,
gestures and LOD. It is MIT and pre-1.0. It is also WebGPU-only, draws object faces on the GPU,
ships plain text rather than rich text, and has no permissions model. Suite cards are Tiptap
editors with field schemas, tags, references, permissions and share redaction; those must remain
DOM components over the engine surface.

Mounting ICE now would not answer the question that matters. A generic ICE desk would prove
WebGPU starts; it would not prove Suite's cards, portals, LOD bands, share scoping or undo can
live inside it. The expensive part is the adapter and the DOM overlay, not the engine import.

## Decision

Keep the React Flow scene surface as the alpha surface and **defer the ICE adapter spike** until
the scene surface is the default and the following parity questions have stable answers. No ICE
dependency is added to the app in this phase. `packages/scene` remains the only projection and
stays engine-neutral, so the spike remains reversible.

## Go/no-go gates for a future ICE spike

The spike starts only when it can be judged against these gates, with evidence recorded here:

1. **Camera and nesting parity.** One continuous camera, nested containers at depth ≥ 2, a cycle
   guard, and zoom-through without a board swap.
2. **DOM card parity.** A mounted `NodeCard` at full LOD, including Tiptap focus, selection,
   resize and property chips, positioned from ICE's transform every frame without a second
   layout authority.
3. **Portal parity.** A portal is a card plus a derived child board instance, with the same
   expansion gate, impostor at far LOD and camera focus checkpoint as `SceneLayer`.
4. **Canonical writes.** Drag, resize, edge and section gestures land as one `WorkspaceDocument`
   commit per gesture, with live positions ephemeral. ICE's ECS is never a second source of truth.
5. **Presence and shares.** Peer cursors map into every visible instance; a share expands only
   targets present in the projection and never fetches owner content.
6. **Text and accessibility.** Suite card text stays DOM/Tiptap; the WebGPU surface has an
   accessible scene outline and keyboard path; a no-WebGPU browser gets a clear fallback.
7. **Budget.** Bundle, GPU memory, mounted editors, frame time at 1k/5k objects, and time to
   interactive are measured against the React Flow surface on the same fixtures.

A spike that fails 2, 4 or 5 is not an engine candidate; it is a rendering experiment. ICE's
kernel math (`/kernel`) may still be adopted without the desk if it earns its place in the scene
package.

## Consequences

- The alpha keeps one working surface and one projection contract; users can try real portals
  today without a second engine's failure modes.
- The engine decision stays open, but it is no longer a prerequisite for the UX pivot.
- The React Flow surface carries the near-term cost of portal interactions (selection, multi-drag,
  resize, edges, sections, presence). If that cost becomes the bottleneck, the ICE gates above are
  the trigger to revisit the spike.

## Amendment (2026-10-23): an isolated spike entry point

An isolated, non-default ICE surface now exists at `apps/canvas/src/ice/IceSurface.tsx` and is
rendered only for `?canvas=ice`. This amendment records the entry point; it does not change the
status above or answer any of the gates.

- **Not default, not document truth.** The routing agent may mount it only when
  `currentCanvasSurface()` is `ice`, behind `lazy(() => import("./ice/IceSurface"))`. The desk is a
  private, in-memory `@vibecook/ice` document: the spike seeds two notes and one mini mat (a note
  inside a container, so the nested face and far-LOD chips are visible), and it never reads or
  writes Suite's graph, session or stores. Closing the route disposes the document and the engine.
- **Lazy by construction.** The surface checks `navigator.gpu` and asks for an adapter before it
  imports anything. `@vibecook/ice`, `/desk`, `/desk/objects` and `/react` are dynamic imports, so
  the default canvas and the scene surface load no ICE code. A production `vite build` of the app
  as wired today emits no ICE chunk at all.
- **Measured cost.** `@vibecook/ice` is pinned to `0.16.0`. A throwaway entry that lazily imports
  the surface (same Vite config and target) produced six ICE chunks: 1.39 MB minified, 489 kB
  gzip, plus 2.25 kB CSS (0.78 kB gzip). React and `loro-crdt` are already in the app's baseline,
  so the incremental delta when the route lands will be smaller and must be re-measured; the
  isolated graph is the upper bound gate 7 has to judge.
- **No handwriting yet.** The layer gets no `text` raster: that needs the Caveat/Kalam face files,
  which the app does not host, and the spike must not fetch a third-party font. The seeded notes
  show their paper and the mini mat's chip LOD, not glyphs.
- **Fallback.** No `navigator.gpu`, no adapter, a refused import or a `failed` desk layer all
  render a calm card with the cause and a link back to `?canvas=scene`. A `degraded` layer keeps
  drawing and says so in the HUD.
- **Evidence collected.** `IceSurface.test.tsx` covers the no-WebGPU path, the no-adapter path,
  the seed and teardown, a degraded desk and a failed desk (5 tests). Storybook has a fallback-only story
  (`Canvas/ICE spike`); the live desk cannot be a story because the story runner's headless
  Chromium has no WebGPU adapter.
- **What this does not prove.** Gates 1–7 remain open: this is a rendering spike with no Suite
  cards, portal projection, canonical writes, presence or text. Nothing here should be read as
  evidence that ICE fits Suite.
