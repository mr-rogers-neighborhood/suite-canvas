# ICE parity roadmap

- **Status:** living plan. It records the port from the React Flow scene to ICE and the evidence
  required before ICE becomes the default canvas.
- **Decision:** [ADR-0034](../decisions/0034-ice-primary-rendering-engine.md) makes ICE the primary
  rendering engine; [ADR-0035](../decisions/0035-views-pins-and-portals.md) defines Views, Pins and
  shared board views; [ADR-0036](../decisions/0036-fractal-lod-and-icon-graph.md) defines the
  fractal LOD and navigation.
- **Current stage:** the live workspace projects into ICE and the app path mounts the real Suite
  `NodeCard` read-only through `suite.card`. The bridge contract, the portal/section/edge plan and
  the pins model are landed as pure modules. The default surface is still the React Flow scene until
  the P0 gate is met.
- **Shell:** the launcher, title bar, library, drawers, inspector, menus, shares and theme stay the
  Suite components. ICE is the canvas layer; do not adopt its tray/drawer/board chrome.
- **Rule:** no phase is complete without an artifact a reviewer can open. A demo is not parity.
- **Research:** [`docs/fractal-interface-research.md`](../fractal-interface-research.md) records the
  ZUI/semantic-zoom evidence, what not to borrow and the LOD experiments.

## 1. What is already proven

| Evidence | Artifact |
| --- | --- |
| WebGPU device on the reference machine | `scripts/ice-chrome.mjs --probe`; adapter HUD in `IceSurface` |
| Native ICE desk seeds and runs on hardware | `/ice.html`; gated `e2e/tests/ice.spec.ts` |
| Suite graph can be projected read-only | `/ice.html?demo=suite`; `suiteProjection.ts` + tests |
| The app projects the live workspace read-only | `?canvas=ice` in a workspace; `IceSurface` waits for hydration, then projects the real graph with no writes |
| Real `NodeCard` overlay in the app | `suiteCardWorkspace.tsx`; `?canvas=ice` workspace mode mounts `CardSurface` read-only |
| Bridge/undo contract | `iceBridge.ts` + 45 tests; not yet wired to gestures |
| Portal/section/edge plan | `icePortals.ts` + 11 tests; not yet wired to the ICE surface |
| Pins model | `packages/graph/src/pins.ts` + `WorkspaceDocument` tests; no library UI yet |
| A custom kind can mount the real `NodeCard` | `/src/ice/suite-card-lab.html`; `suiteCardKind.ts`, `suiteCardOverlay.ts`, `suiteCardNodeCard.tsx` |
| Selection, drag, pan and zoom work with the DOM overlay | headed smoke; overlay is `pointer-events:none` |
| Device loss is diagnosable | fallback state, `Reset demo`, `Copy diagnostics` |

What is not proven: real workspace hydration, canonical writes, editing, property inspector,
whiteboard editing, sections/edges, portals from the real graph, presence, shares, undo, Views,
Pins, the editor budget, accessibility and frame-time at 1k/5k objects.

## 2. Target composition

```text
Loro graph (@suite/graph)
  boards · cards · placements · sections · edges · drawings · views · pins
        │
        ▼
Pure projection (@suite/scene)
  canonical ids · placements · portal paths · effective scale · LOD bands · camera math
        │
        ▼
ICE adapter (WebGPU)
  world · nested containers · spatial index · camera · input · GPU faces
        │
        ├── suite.card kind: GPU paper + screen-space NodeCard overlay
        ├── suite.section kind: GPU frame + DOM chrome
        ├── suite.edge kind: GPU path + DOM label
        └── suite.pin kind: marker + DOM label
        │
        ▼
Workspace bridge
  instance → placement → one WorkspaceDocument commit per gesture
  Loro UndoManager only; ICE history disabled
```

`@suite/scene` stays engine-neutral. ICE owns the world and camera; it does not own the meaning of a
card, a portal, a section, an edge, a pin or a View.

## 3. Phases

### Phase 0 — Decisions and vocabulary (done)

- ADR-0034: ICE primary, WebGPU required, unsupported screen, no user-facing React Flow fallback.
- ADR-0035: Board is internal; Views are framings; Pins are spatial bookmarks; portals are shared
  board views; multi-placement preserved.
- ADR-0036: discrete bands, crossfade, spatial icon field, editor budget, navigation.
- Docs, roadmap and launcher copy preserved.

**Exit evidence:** this file plus the three ADRs, linked from `architecture.md`, `AGENTS.md` and the
alpha roadmap.

### Phase 1 — Read-only real workspace

Goal: open a real workspace in ICE, not a demo.

- Build a `SuiteIceProjection` adapter from `@suite/scene`/`WorkspaceSnapshot`; no throwaway
  `seedExampleWorkspace` document in the production surface.
- Map every board to a container; cards to placements; portals to nested board views; sections to
  placeholders; edges to placeholders.
- Resolve `card → placement → instance key` as defined in ADR-0035. Preserve multi-placement.
- Restore the last valid View/camera; if none, frame the root View.
- No DOM cards and no writes in this phase; use GPU faces and chips so the whole workspace is
  visible.

**Exit evidence:** a real workspace with the example seed opens in ICE; card counts match the scene
surface; a reload restores content and camera; a 5k-card fixture opens without an error. Read-only.

### Phase 2 — `suite.card` production overlay

Goal: the real card, not a note impostor.

> **Superseded in part (2026-10-23).** The card's face is now drawn by the desk — the paper pass
> with a card hand, a card palette and a power-of-two type ladder — so a card is part of the canvas
> at every zoom instead of a DOM panel over it (ADR-0036, "the sheet is the card" and "type scales in
> powers of two"). The DOM renderer survives as the comparison path (`SUITE_CARD_DOM_FACE`), which
> is why the bullets below are kept: they are the contract anything that mounts a second face must
> still honour.

- Move the lab renderer into the app path. Pass the real `Card`, `CardType`, `CardMeta`, the
  workspace `LoroDoc`, `contentId`/`titleId`, `cursorStore`, `localUser`, `boardId` and presence.
- **Phase-2 invariant:** the renderer reads the same semantic model and the same canonical placement
  as the canvas. It is a renderer of one position, not a second layout. If it needs its own
  coordinates, selection or identity map, stop and fix the projection instead.
- Render read-only first: title/body, type glyph, tags, property chips, menu affordances disabled.
- Wire the property inspector to the same canonical card.
- **Shell unchanged:** the card uses the existing `CardSurface`/`NodeCard`/global CSS; no card
  restyle, no replacement inspector, no ICE tray or drawer. ICE supplies geometry only.
- Keep one DOM root per visible card; release it on LOD unmount; free the local doc only when it is
  a lab doc (never the workspace doc).
- Add the pointer-mode switch: `pointer-events:none` by default; text editing enters an explicit
  editor mode that suspends ICE shortcuts and releases on blur/Escape.

**Exit evidence:** a real card's title and body render and scroll; the inspector edits the same card;
opening the card in the panel and on the canvas does not create a second editor; no local document
is minted for a workspace card; the card's position is unchanged by mounting the overlay.

### Phase 3 — Interaction bridge and undo

Goal: gestures are canonical and undoable once.

- **Write funnel:** every write goes `ICE intent → bridge → WorkspaceDocument → Loro → projection`.
  The projection is downstream and never writes back; no ICE ECS record becomes document truth.
- **Snapped geometry is authoritative:** ICE's snap guides/equal spacing/auto-alignment may move the
  object after the pointer delta. The bridge commits the final ICE rect inverse-transformed into
  canonical coordinates, not the raw pointer position. Do not rebuild alignment in the bridge.
- Define `SuiteIceBridge` interfaces: `instanceOf`, `placementOf`, `cardOf`, `selection`,
  `moveIntent`, `resizeIntent`, `createIntent`, `deleteIntent`.
- Map ICE screen/world coordinates through the instance transform to canonical board coordinates.
- Live motion is ephemeral; pointer-up calls one `WorkspaceDocument` method per gesture.
- Selection is canonical; every visible instance agrees.
- Disable ICE's native history for document objects from the first write. Route `Ctrl/Cmd+Z` and
  `Shift+Ctrl/Cmd+Z` to Loro.
- Gate by capability flags: a viewer selects but never drags, resizes, creates, deletes or connects.
- A cancelled pointer, a sub-epsilon move and a gesture without a bridge write nothing.

**Exit evidence:** drag, resize, create and delete each make one commit; undo restores one gesture;
redo works; a viewer cannot write; two instances of one card agree after a drop; no ICE history entry
is created for a document gesture.

### Phase 4 — Whiteboard card

Goal: keep Excalidraw, do not let it become the canvas.

- Card face at `compact`/`icon` is the cached preview, never a live Excalidraw mount.
- At `full`, mount the existing Excalidraw card inline **or** open the focus surface, but only one
  editable surface at a time.
- Keep the Loro drawing binding, undo and property inspector unchanged.
- The inline Excalidraw camera is clipped to the card; wheel/pan inside it does not move the
  workspace camera. Escape leaves the card camera first, then the editor.
- Measure the cost of one inline Excalidraw; if it exceeds the editor budget, default to the focus
  surface at full LOD and keep a static preview on the card.

**Exit evidence:** a drawing created in the focus surface appears on the ICE card; editing inline
writes through the same API; opening the property inspector does not create a second editor; zooming
the workspace does not zoom the card's internal scene.

### Phase 5 — Boards, edges and connectors

> **Vocabulary (ADR-0039):** "Section" is now **Board** (a container holding cards and other Boards),
> the old tab-board is a **View** (a camera only), and the Portal card type is deleted — a Board
> nested in a Board is the portal.

Goal: parity for the non-card objects.

- Implement `suite.section` as a GPU frame with DOM header/handles; selection, drag, corner resize;
  members move as one canonical batch.
- Use ICE's native snap guides, equal-spacing bars, auto-alignment and `arrange`; do not build a
  second alignment system or a React Flow-style layout clone.
- Implement `suite.edge` as a GPU path with a DOM label; select, highlight, open the shared edge menu,
  edit the description.
- Connector handles come from the selection overlay for the single selected card; drag-to-connect
  creates one canonical edge with anchors.
- Reuse `useCanvasMenuItems`; no second menu builder.
- Sections and edges clip to their board instance in a portal.

**Landed:** `suite.edge` draws a link as one rotated quad per segment over the reused paper pass. A
link honours the connectors it names (`anchorWorld` reads the card's own connector fractions), the
link table re-syncs when the document changes, and a link that leaves the document leaves the desk.
Hovering a card offers its connectors; a drag from one to another card's connector commits one
`addEdge` at pointer-up and publishes the gesture as `connect` presence. A viewer, or a seat without
layout authority, is offered no connectors.

**Landed — the link lives on its frame's plane.** A link is now a child of the mat of the Boards'
lowest common ancestor, spawned in that frame's coordinates with `CONTAINABLE` (a container only
accepts what provides it), and the endpoint resolver subtracts the frame origin so the polyline it
routes is frame-local. From the View a link inside a Board is drawn small inside the frame's face;
entering the Board draws the same object at full size. That is the depth the canvas asks for, and it
is what stops a link vanishing the moment its Board is entered.

**Landed — a link reads on any ground.** A stroke is a run of overlapping capsules, so an alpha tone
darkens every joint: the record now mixes the relation's tone into the ink and lays every halo (the
palette's sheet colour, wider than the ink) before every stroke. A reference is a quiet ink line on
paper and a light one on a Board's dark face, and nothing is drawn twice.

**Landed — a Board's frame is a document write.** A mat is now movable *and* resizable in one gesture
(`SUITE_BOARD_INTERACTION`), and the surface commits the frame's rect in its parent's frame through
`planBoardRectCommit` → `updateBoardRect` (one write for a move and a resize; the document's 80×60
floor is the only limit). A reload brings the moved frame back, because the frame was never ICE's
fact to keep.

**Landed — a link may end on a Board (ADR-0041).** `sourceKind`/`targetKind` name a frame instead of
a card, additively and per end, and a frame end attaches to the midpoint of the wall facing the other
end — recomputed every frame, never stored. Hovering a mat offers its four wall midpoints exactly as a
card offers its connectors, so the gesture that links two cards also links Board↔card, card↔Board and
Board↔Board; `listBoardEdges`/`listSubtreeEdges` resolve a frame end against the plane it is drawn on,
and the publish path carries the kinds.

**Still open:** a link that crosses a wall, drawn clipped at the frame with a through tick; re-projecting
the desk when the Board tree changes structurally; the section kind; the shared edge menu and label
editing on the ICE surface; connector repositioning.

**Exit evidence:** section move/resize commits once and moves members; edge create/select/delete and
label work; connector handles are reachable; menus are the same builder as the reference surface.

### Phase 6 — Portals and shared board views

Goal: no camera trick, no board clone.

- Map a portal card to a nested board view of its target. Multiple portals to one board are multiple
  instances of one canonical board.
- Expand lazily above the gate; below it, draw the impostor.
- A cycle stops at the repeated board path; depth cap holds.
- Entering moves the camera; Escape restores the exact checkpoint; the root View stays active.
- Selection, drag and presence resolve through the instance path; every instance repaints from the
  same canonical placement.
- A portal target outside a share's scope is an *Unavailable view* stub.

**Exit evidence:** depth ≥ 2 live; cycle stub; two portals to one board show the same selection and
update together; entering and leaving restores the camera; a share never expands out of scope.

### Phase 7 — Presence and shares

Goal: collaboration does not fork.

- Project the existing presence store into every visible board instance; clip pointers to the
  portal frame; drop out-of-scope peers.
- Publish selection, pointer, drag set, resize, section drag and marquee through the same throttles.
- A viewer publishes selection and marquee only.
- Share projection includes only boards, cards, sections, edges and pins in scope; a pin never
  expands scope.

**Landed on the ICE surface:**

- The surface publishes pointer, selection, drag set and marquee into the existing awareness store,
  at a peer redraw rate rather than a frame rate, gated by `presenceRoleCaps` — a viewer points and
  selects, and publishes no gesture.
- The projection turns them into screen-space cursors, selection rings, drag ghosts, the marquee and
  each peer's in-flight link; one inert DOM layer paints them, and the layer is empty (and hidden)
  when nobody else is present. Editing peaks as the in-card chips, and as a dot only where the card is
  too small to show them.
- The projection now follows the document: a peer's move, link or undo reconciles the desk without a
  reload.

**Decision — a View is the presence scope; a Board is attribution.** A View flattens its Boards into
one plane, so replacing the peer's `board` with the deepest Board under their pointer would hide a
peer working inside a Board from a peer on that View's plane — no cursor, no ring, no ghost. Presence
therefore stays View-scoped, and a new ephemeral field (`boardOf`, from `ownerBoardAt`) rides along and
is drawn as "Ada · Interviews" on the cursor.

**Still open:** resize, section-drag and reconnect presence; share scope at the projection (it is
enforced at the write path, not yet by dropping out-of-scope peers); presence in a portal instance is
the same projection once portals project.

**Exit evidence:** two headed browsers see each other's pointers and selection in a portal; a viewer
cannot drag; a share link opens ICE with the same scope as the scene surface. *(Outstanding: this run
verifies the wiring with unit tests only.)*

### Phase 8 — Views, Pins and navigation

Goal: retrieval replaces the old board tabs and prompt.

- Rename Board to View in product copy; keep `boards` records.
- Views switcher replaces `BoardTabs`; library lists Views, Pins and saved filters.
- Add the `pins` map to `WorkspaceDocument` (additive), Zod schema, observer and tests.
- Drop-pin tool and context action; inline label; drag writes once; delete from library.
- Outline, breadcrumb, back/forward camera history and scale/LOD indicator.
- **Fit View** camera action: current View bounds (placements, sections, portal frames, pins), not
  recursive, no selection/focus reset, same zoom path as manual zoom-out.
- Remove the immediate unplace/delete prompt; unplace is non-destructive and reachable from the card
  menu and library.

**Exit evidence:** a new pin survives reload and sync; clicking it frames the point; the outline
lists it; unplace sends a card to the Inbox without a prompt; deleting a card still goes through
Trash.

### Phase 9 — Fractal LOD and editor budget

Goal: structure at distance, editors only when readable.

- Implement the four bands from ADR-0036 with screen-footprint and effective-scale conditions.
- Treat the far field as the **same spatial model** at low resolution, not a separate graph mode:
  type glyphs at exact positions, container glyphs in frames, no force-directed layout. Hysteresis
  is only the boundary stabilizer.
- Implement one-way hysteresis, crossfade in place, and the selected/focused exception.
- Implement the motion-frame/settle-frame split: GPU proxies while the camera moves, one incremental
  DOM mount pass after 80–120 ms idle with a ~6 ms deadline and ~6 editors per frame.
- Draw the spatial icon field with type glyphs and layout-encoded container badges. No reference
  edges at far zoom.
- Cap mounted overlays at 24 by default; prioritise focus, selection, centre and z-order; expose the
  count in `?perf=1`.
- Run the experiments and record results; the evidence and caveats are in
  [`docs/fractal-interface-research.md`](../fractal-interface-research.md).

**Exit evidence:** zooming through 0.35/0.75 does not flicker; a card at icon zoom shows its
position and layout badge; mounted count never exceeds the cap; crossfade has no blank frame;
motion frames never mount an editor; settle time and mounted count are recorded.

### Phase 10 — Failure, accessibility and rollout

Goal: a default that fails honestly.

- No-WebGPU, no-adapter and refused-import screens: reason, requirements link, diagnostics copy,
  retry.
- Device loss: stop drawing, say nothing was written, offer reload/reset; no partial write.
- Accessibility: outline is the tree; every card, portal, section and pin is reachable; focus order
  stable; canvas has a description; reduced motion honoured.
- Perf: 1k/5k object fixtures on hardware; frame time, TTI, GPU memory and mounted editors recorded
  against the React Flow baseline.
- Rollout: `?canvas=ice` for alpha; default after P0; remove React Flow from the user path; delete
  the flow/scene surfaces in a follow-up.

**Exit evidence:** the P0 table in ADR-0034 is green; unsupported browsers see the right screen;
accessibility checks pass; the perf artifact is linked; the default opens ICE.

### Phase 11 — The graph projection (and the ambient layer) — **withdrawn**

> **Status: built, shipped, withdrawn** ([ADR-0040](../decisions/0040-the-type-graph-is-withdrawn.md)).
> The overlay answered a question the inspector and the library already answered. Everything in this
> phase below is history: the kinds, the band, the table and the crumb are deleted, and the zoom
> cluster's fourth control is **Types**, which opens the manage-types dialog. `packages/scene/src/typeGraph.ts`
> stays parked. Kept for the reasoning, not as work to do.

Goal: the canvas can be read as a type graph, without becoming a second layout.

- Add the type-graph projection from
  [ADR-0037](../decisions/0037-graph-projection-and-ambient-layer.md): one node per (container, type)
  inside its container, one unfiled bucket, deterministic grid positions derived from member bounds,
  counts and glyphs only, containment edges only. The projection writes nothing.
- The projection is an **overlay**, opened and closed by a control (`g`): cards stay drawn underneath,
  and closing restores the camera the user came from. There is no zoom band and no ceiling.
- Route every navigation through the camera flight helper — duration grows with pan distance and
  log zoom ratio, clamped at both ends. No teleporting camera ops; the one exception is clicking a
  card in the library, a drawer or the Types table.
- Draw derived depth inside the projection only: nesting depth becomes offset, scale and shadow on
  flat quads. No perspective camera, no authored Z.
- The canvas zoom cluster keeps the traditional controls — zoom in, zoom out, fit the View, **Types** —
  and no scale or percentage: the extent has no ends, so it has nothing honest to put on a track.
  Holding either zoom button repeats, accelerating.
- Add the inspector's **Types in view** table while the projection is open: count and share per type,
  selectable, scoping the library by type and container, framing the instances as a camera action.
  Read-only for viewers.
- **Pinned:** the ambient layer — soft masses derived from the same projection, behind the cards,
  giving way to the projection's nodes. Rules are in the plan: never competes with text, one model,
  hand-over rather than layering, no animation, honest names.

| Lane | Work | Owner artifact |
| --- | --- | --- |
| A | Pure projection: aggregate into (container, type) nodes, deterministic layout, containment edges | `packages/scene/src/typeGraph.ts` + tests |
| B | Two ICE kinds for the projection: `suite.typeNode` (glyph + count) and `suite.containerNode` (frame + label), plus derived depth | `apps/canvas/src/ice/suiteTypeNodeKind.ts`, `suiteContainerNodeKind.ts`, `suiteGraphDepth.ts` + tests |
| C | Surface integration: open/close flight with the camera remembered, spawn/despawn, keymap, crumb, reconcile — single owner of `IceSurface.tsx` | `apps/canvas/src/ice/iceCameraFlight.ts` + `IceSurface.tsx` |
| D | Canvas zoom cluster (zoom in/out with hold-repeat, fit, graph), Types table, library scoping, frame-instances action | `apps/canvas/src/components/CanvasZoomControls.tsx`, `TypeTable.tsx`, `ice/useTypeTable.ts` |
| E | ADR-0037, this phase, the architecture paragraph, the research note | `docs/` |
| F | Verification: unit coverage, headed e2e (open/close restores the camera, labels render, table scopes the library), `?perf=1` sample with the projection open | `e2e/tests/ice-graph.spec.ts` |

**Exit evidence:** the Graph control (and `g`) opens the projection; every (container, type) has one
node with a count at a stable position across renders and clients; nested containers read as a stack
through derived depth; closing — by the control, the crumb or `Escape` — removes the nodes and returns
to the exact camera it was opened from, even after panning inside it. Selecting a type in the table
scopes the library and frames its instances without writing. Nothing in the projection writes to Loro,
references never appear as edges, a viewer sees the same projection read-only, and zoom has no floor
or ceiling of ours.

## 4. Dependency order

```text
Phase 1 read-only real workspace
  └── Phase 2 suite.card
        └── Phase 3 bridge + undo
              ├── Phase 4 whiteboard
              ├── Phase 5 sections/edges/connectors
              └── Phase 6 portals/shared views
                    └── Phase 7 presence/shares
                          └── Phase 8 views/pins/navigation
                                └── Phase 9 fractal LOD/budget
                                      └── Phase 10 failure/accessibility/rollout
                                      └── Phase 11 graph projection
```

Phase 11 depends on Phase 9's bands and on nothing in Phase 10; it can overlap the rollout work once
the icon band is stable.

Phase 5 and 6 can overlap once the bridge exists. Phase 8 can start its schema and library work in
parallel, but its canvas interactions depend on Phase 3.

## 5. Test strategy

| Layer | What it proves |
| --- | --- |
| Unit (`@suite/scene`, `@suite/graph`) | projection, instance paths, transforms, LOD bands, pin schema, view scope |
| Component (jsdom) | overlay positioning, hide/unmount, card renderer, property inspector, menu builder |
| Headed ICE (`SUITE_ICE_E2E=1`) | device, seed, real workspace hydrate, select/drag, portal focus, device-loss state |
| Two-browser | presence, shares, viewer caps, canonical selection in two instances |
| Perf | 1k/5k objects, frame time, TTI, mounted editors, GPU memory |
| Accessibility | outline tree, keyboard path, focus order, reduced motion |
| Visual | reference surface vs ICE at `full`, `compact`, `icon`, `hidden` |

The default e2e run must still pass without a GPU. ICE specs are gated and run in headed Chrome on
the reference machine; a software adapter is correctness-only.

## 6. Risk register

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| WebGPU unavailable on a user's browser | high | Publish requirements; unsupported screen; no fake fallback |
| Device loss mid-session | medium | Stop, diagnose, reload/reset; never write partial state |
| DOM overlay drift from GPU geometry | medium | One `geometryOf()` source per frame; visual parity test at four bands |
| Two undo stacks | high if unmanaged | Disable ICE history at the bridge; Loro only; test one gesture = one step |
| Portal instance resolves the wrong placement | medium | `instance → placement → card` contract + tests with two portals |
| Inline Excalidraw exceeds budget | medium | Focus surface default; static preview; measure before enabling inline |
| Mounted editors exceed budget | medium | 24-card cap, culling, priority order, `?perf=1` count |
| React Flow and ICE drift during the port | high | One menu builder, one projection, one bridge; reference surface frozen |
| Alpha users lose access on unsupported hardware | medium | Clear alpha note; diagnostics; document the supported matrix |

## 7. Out of scope

- A second interactive renderer as a permanent fallback.
- Mobile and touch-first layout.
- Real-time co-editing inside one Tiptap document beyond the existing Loro binding.
- Per-user private pins (later, separate map).
- Reference-edge graph at far zoom, even behind a modifier or filter. References are rows/predicates,
  never edges.
- A second spatial layout. A retrieval layout, if ever added, is a separate surface outside the
  canvas; it is not a “graph mode”.
- An explicit graph/canvas mode toggle. “Fit View” is a camera action, not a representation switch.
- Live reflow or an auto-layout daemon.
- Migrating server rooms or deleting old local databases.

## 7.1 Next fleet deployment

Must land:

1. **Root editing** — drag/resize/delete with one Loro commit per gesture, Loro undo/redo, final
   snapped rect, ICE history disabled.
2. **Portals** — nested board views from `icePortals`, depth 2+, multi-placement, cycle stubs,
   `enterContainer`/`exitContainer` camera entry.
3. **Pins** — drop, list in the existing library/Views shell, click to navigate; one pin move per
   commit.
4. **Whiteboard** — inline Excalidraw at full LOD plus the existing focus surface; preview below.
5. **Shell editing path** — inspector/focus remain the text editors; the ICE overlay stays read-only
   for text.

Deferred: presence/shares, inline Tiptap editing on the overlay, crossfade/editor-budget polish.
Stretch only if the must-land set is green: LOD crossfade and the mounted-editor cap.

## 7.2 Pinned for the next planning stage: the vocabulary

The infinite canvas added a dimension the old vocabulary no longer describes. Nothing here is
decided; it is recorded so the next planning pass starts from the same questions rather than
rediscovering them.

**The proposal under discussion**

| Today | Proposed | Why |
| --- | --- | --- |
| Section (a titled region on a board) | **Board** | A section is already a bounded region with a title and membership — structurally what ICE draws as a mat/board on the desk. |
| Board (a named set of placements) | **View** | A board is a *subset of the canvas*, which is what a view is: the same objects, framed differently. |
| Tab open on a board | **View or Board** | Opening a view restores a frame; opening a board restores the mat. Same gesture, two subjects. |

**Why the rename is attractive**

- It matches what the user sees. The desk literally draws boards; calling a titled region a
  "section" asks people to translate at every mention.
- It matches the stronger claim in ADR-0035: several placements of one card already means the
  "board" is a projection, not a container. "View" says that honestly.
- It retires a word collision that has cost real time: "board" currently means both the tab's
  content and the canvas page, and the code has to disambiguate in every comment.

**Why it is more than a rename**

- `Placement.boardId` is in the schema, in Loro history, in share scopes, in URLs
  (`?board=`), in the pins model and in every test fixture. Renaming is a migration, not a find and
  replace: an additive alias field plus a read-both/write-new window, or a one-shot migration on
  load with a schema bump.
- Three name pairs would coexist during that window (old section/board, new board/view), which is
  the worst possible moment to be writing docs.
- `View` collides with the existing *saved query* meaning (`views`, `activeViewId`,
  `libraryScope`). If `View` means a canvas frame, a saved query needs another word — `Saved query`
  or `Filter` — and that is a second rename.

**The dimension worth deciding first**

The canvas gives us two axes that the current model conflates: **where an object is** (one spatial
layout, ADR-0036) and **what a tab is looking at** (a frame over that layout). A clean model needs
three nouns, not two:

1. **Object** — a card, a whiteboard, a portal. One position per placement; never two layouts.
2. **Board** (proposed; today's section) — a titled region of the canvas, drawn as a mat. Belongs to
   the spatial model.
3. **View** (proposed; today's board) — a framing: which mat, which zoom, which filter. Belongs to
   the camera/session model, not the document.

If that split holds, `Placement` should eventually carry a **board** (the mat) and a tab should
carry a **view** (the frame), which is exactly the split `sectionLayout`/`boardViewports` already
half-implements in code. The rename then follows the model instead of preceding it.

**Questions for planning**

1. Does "Board" replace "Section" *and* keep the mat as the spatial container, or does a Board become
   a first-class canvas object (spawnable, resizable, nestable) that sections are promoted into?
2. Is a View persisted (a saved frame, shareable) or ephemeral (a tab's camera)? Today's boards are
   persisted; a "view" that is only a camera would lose the multi-placement model.
3. What happens to `?board=` URLs, share scopes (`share.scope === "board"`), pins (`pin.boardId`) and
   the card-share model during a rename window? One migration, or a long alias?
4. If "View" is taken by saved queries, which noun wins: canvas frames or saved queries?
5. Does the library's "Views" tab become "Filters" or stay, and does the Pins tab follow?

**Recommendation to take into planning:** decide question 1 first. Everything else (URLs, shares,
schema field names, docs) is downstream of whether a Board is a *region* or an *object*, and that is
also the decision that determines whether ICE's native mat becomes the Board primitive or merely
draws one.

## 8. Status board

| Workstream | Status | Next artifact |
| --- | --- | --- |
| Decisions and docs | done | ADR-0034/0035/0036 |
| Real workspace on ICE | done — live graph, real `CardSurface` overlays, selection mirroring | 5k fixture + reload/camera restore |
| `suite.card` production | done for text via the inspector; the overlay stays read-only | inline Tiptap (deferred) |
| Interaction bridge | done — drag/resize/delete commit once, Loro undo re-derives the projection | 5k drag budget |
| Whiteboard | done — inline Excalidraw after an intent dwell, one instance, preview underlay, focus surface retained | measure the mount cost and record the ladder rung |
| Sections/edges/connectors | done for links — drawn from their connectors or a Board's wall, drag-to-connect commits one edge, re-synced when the document changes, drawn on their frame's own plane with a halo; a Board's frame commits move and resize in one write | crossing links clipped at the wall; section kind + edge label/menu |
| Portals/shared views | camera entry, breadcrumb, Escape exit and cycle/depth/missing stubs done; canonical multi-instance selection pending | shared-view selection across instances |
| Presence/shares | landed on ICE — pointer, selection, drag, marquee and Board attribution publish; cursors, rings, ghosts, marquee and peer links paint in one screen-space layer; the projection follows the document | two-browser artifact; resize/reconnect presence; share-scoped projection |
| Views/Pins | done — pins tab, drop action, markers, drag and click-to-focus | Views switcher rename (ADR-0035) |
| Fractal LOD/budget | pending | crossfade + mounted-count artifact |
| Graph projection | done — pure aggregation in `@suite/scene`, deterministic positions, containment edges, 42 tests | — |
| Projection kinds | done — `suite.typeNode` glyph + count, `suite.containerNode` frame + label, derived depth | story |
| Camera flights | done — distance-scaled planner; zoom buttons repeat and accelerate; no teleporting ops | headed e2e |
| Graph overlay wiring | landing with this fleet — control and `g` open it over the canvas, the camera is remembered and restored on close | headed e2e: open, pan inside, close |
| Types table | done — count and share per type, scopes the library, frames instances; shown in the inspector while the projection is open | viewer read-only artifact |
| Ambient layer | pinned — soft masses derived from the same projection, behind the cards | lane after this fleet |
| Projection docs | done — ADR-0037, architecture paragraph, Phase 11, research note | — |
| Failure/accessibility/rollout | pending | P0 table + unsupported screen |
