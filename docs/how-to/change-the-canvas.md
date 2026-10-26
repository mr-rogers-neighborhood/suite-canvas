# Change the canvas

Adding to the canvas means answering three questions before writing code: which layer owns the input,
what the document records, and what peers see while the gesture is in flight. The three procedures below
follow that order.

The module map is in [canvas.md](../reference/canvas.md). The document rules are in
[architecture.md](../reference/architecture.md).

## Add a gesture

Decide who owns the pointer or key first. A gesture that shares a surface with another one needs an
owner decided at press time, or the two will both act on the same event.

1. Pick the owner. A press on a card, the pane, the marquee, or the wheel belongs to React Flow, so the
   handler goes on the `<ReactFlow>` element in `apps/canvas/src/canvas/board/BoardSurface.tsx`
   (`onNodeDragStart`, `onNodeDragStop`, `onMoveEnd`, `onEdgeDoubleClick`). A press on a section goes in
   `apps/canvas/src/canvas/sections/SectionLayer.tsx`, because a section is not a node. A press on a
   connector dot goes through `apps/canvas/src/canvas/NodeConnectors.tsx`. A key goes in
   `apps/canvas/src/canvas/board/useBoardKeyboard.ts` as a named action, not as another branch in the
   dispatcher.
2. Read the capability first. Layout writes check `canEditLayout`, content writes check
   `canEditContent`, and creation checks `canCreateContent`; the flags come from the `ui` bundle
   (`board/useBoardUi.ts`). Returning early on a missing flag is the whole check, because the same flags
   gate the panel and library paths.
3. Keep the live value out of the document. While the gesture runs, hold the position, size or path
   fraction in the hook's state or a ref. `board/useBoardRefs.ts` is where shared per-gesture refs live.
   Write through `@suite/graph` once, on release, in the command that owns the record
   (`board/useBoardCommands.ts`, `board/useBoardSections.ts`, `board/useBoardLinks.ts`).
4. Publish it if a peer has to see it. An in-flight gesture is a presence field, not document data; see
   the presence procedure below. Publish in flow coordinates, so a peer at a different zoom draws the
   same thing.
5. Add an Escape layer if the gesture can be abandoned. `useEscapeLayer` from
   `apps/canvas/src/shell/escapeLayers.ts` registers the cancel and orders it by when it
   started; an entry pushed last takes the key first.

Tests:

- Behaviour with React: `apps/canvas/src/canvas/CanvasBoard.test.tsx` mounts the board and fires
  pointer and key events. Add one case for the gesture and one for the capability it needs.
- Geometry or a plan: a pure module beside the code, such as `canvas/placeRun.test.ts` or
  `canvas/localEasing.test.ts`, with `pnpm exec vitest run <path>`.
- The real pointer path: `e2e/tests/input/` for modifier and purpose gestures, `e2e/tests/boards/` for
  board and section gestures. `e2e/tests/fixtures/marquee.ts` has the drag helpers.

## Add a node surface

A node surface is a card face with its own chrome. It is still a card, still placed by a placement, and
still edited by Tiptap for its text.

1. Model the marker in `packages/graph`. The existing surfaces use a card type or a property, which is
   how `whiteboard` and `board` portals are recognised; a new record class needs a schema change and a
   decision record first.
2. Add the predicate beside the others in `apps/canvas/src/cards/`. `cards/whiteboard.ts` exports
   `WHITEBOARD_TYPE_ID` and `isWhiteboardCard`; `cards/portal.ts` exports `portalTargetId`.
3. Write the component in `apps/canvas/src/canvas/`, next to `NoteNode.tsx`, `PortalNode.tsx` and
   `WhiteboardNode.tsx`. It receives `CardNodeData` from `canvas/nodeData.ts`: the card, its placement,
   its type and the derived `meta`.
4. Register the node type. `nodeTypes` is defined in `canvas/NoteNode.tsx` and extended in
   `board/BoardSurface.tsx`, which is also where the placement chooses it: the `type` field in
   `board/useBoardNodes.ts` maps a card to `whiteboard`, `portal` or `note`.
5. Decide how it paints at distance. `canvas/silhouette.ts` sets the outline and `canvas/surfacePaint.ts`
   resolves the paint roles; a face that ignores the zoom band (`canvas/zoomRange.ts`) will look wrong at
   0.1 scale.
6. Add a story and a test. A visual surface gets a `*.stories.tsx` beside the component, and behaviour
   that is not pure paint gets a `*.test.tsx` such as `PortalCard.test.tsx`.

`NodeCard` opens a card for editing on double click. Do not move that to a single click: the canvas
interaction tests and the library press both depend on the double-click path.

## Add a presence channel

Presence is one schema with typed fields, not one channel per feature. Adding a channel means adding a
field to that schema in five places.

1. Declare the payload in `apps/canvas/src/collab/presence.ts`: an exported interface in flow units, one
   entry in `AWARENESS_FIELDS`, and a field on `PeerPresence`. Document what it means and which board it
   belongs to.
2. Project it in `apps/canvas/src/collab/peerProjection.ts`: read the field in `toPeerPresence`. A
   gesture that must expire goes in `GESTURE_FIELDS`, which drives the TTL check, the signature and the
   clear-out; a field left out of that list survives the sender's disconnect as a ghost.
3. Publish it from `apps/canvas/src/collab/usePresenceStore.ts`. A gesture that can be abandoned uses
   `publishGesture`, which starts the keep-alive beat; standing state such as a purpose uses `publish`,
   which does not.
4. Sanitize anything a peer sends that another client will index or loop over. `sanitizeDraggedNodeIds`
   caps a dragged set at `MAX_DRAG_NODE_IDS` and drops malformed entries; a payload that names records
   needs the same treatment.
5. Draw it in `apps/canvas/src/canvas/presence/`. Peer pointers, selections and marquees are in
   `PresenceLayer.tsx`; previews of gestures that would otherwise hide a real edge are in
   `PeerReconnectLayer.tsx`. Read peers through `hooks/useBoardPeers.ts` so a cursor from another board
   is filtered out, and draw inside a `ViewportPortal` so the layer shares the camera.

Tests: `apps/canvas/src/collab/peerProjection.test.ts` covers projection, sanitizing and the TTL, and
`apps/canvas/src/collab/usePresenceStore.test.ts` covers the publish path. Two clients in
`e2e/tests/collab/collab.spec.ts` are the only place a real round trip is checked.

## Before you open the pull request

```sh
pnpm exec vitest run apps/canvas/src/canvas/<your test>
pnpm --filter @suite/canvas typecheck
pnpm biome check apps/canvas/src/canvas
node scripts/check-shape.mjs
```

`check-shape.mjs` fails on a second `WorkspaceDocument.observe` call site. Text and record changes reach
a surface through `store/workspaceSnapshotStore.ts`, which owns the one subscription and exposes the card
change stream to consumers.
