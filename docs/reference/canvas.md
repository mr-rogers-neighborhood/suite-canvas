# Canvas

`apps/canvas/src/canvas` turns the workspace document into a board you can point at: placements become
nodes, edges become routes, and every gesture ends in one `@suite/graph` write.

The document model and the data flow are in [architecture.md](architecture.md). This page maps the code
that draws it, and which layer owns each input.

## Board and placements

`board/BoardView.tsx` is the entry. It builds the board's hooks in the order they depend on each other
and hands the results to two components: `board/BoardSurface.tsx` hosts the React Flow `<ReactFlow>`
element, and `board/BoardOverlays.tsx` holds the layers beside it: the context menu, the link
description input, the link thread preview, the placement run bar and the portal transition.

A card reaches the board through a placement, not through the card record:

| Field | Meaning |
| --- | --- |
| `boardId`, `cardId` | which board shows which card |
| `x`, `y` | top-left corner in flow units |
| `z` | paint order within the board, fractional so a restack writes one placement |
| `width`, `height` | resized dimensions; absent means the card's natural size |

`useBoardProjection` derives every board-scoped map from the snapshot once per change: `boardPlacements`,
`cardsById`, `boardOrder`, `sectionMembershipMap` and `linkScene`. It writes nothing. `useBoardNodes`
then maps each placement to a flow node, choosing the node type with `isWhiteboardCard` and
`isPortalCard` from `cards/whiteboard.ts` and `cards/portal.ts`, and falling back to `note` (`NoteNode`).
`nodeTypes` is in `canvas/NoteNode.tsx`, extended in `board/BoardSurface.tsx` with `portal` and
`whiteboard`.

The surface sets `onlyRenderVisibleElements`, so a card outside the viewport is unmounted. React Flow
keeps its measured size and handle bounds, which is what lets an edge still route and a connector still
measure when the card scrolls back in.

Commands that change the document live in one hook, `board/useBoardCommands.ts`: create, duplicate, move,
restack, unplace, trash and arrange. Each callback is one capability check plus the one
`WorkspaceDocument` call it needs, so a share role never has to be re-checked in the component that
triggered it.

## Sections

A section is a labelled region on one board, stored in `sections`:

| Field | Meaning |
| --- | --- |
| `boardId`, `title`, `color` | identity and paint |
| `x`, `y`, `width`, `height` | its rect in flow units |
| `z` | order among overlapping sections; cards always paint above all of them |
| `connectors` | link attachment points, same 0..1 fractions a card uses |
| `tags` | freeform labels for querying, never a membership rule |

Sections never own cards. Membership is computed from geometry on every read: `sectionMembership` in
`packages/graph/src/sections.ts` takes each placement's anchor (its top-left corner plus
`CARD_ANCHOR_INSET`, 8 flow units) and returns the smallest section whose rect contains it, with the
higher `z` and then the id breaking ties. Two clients therefore agree about a card that straddles a
border without exchanging anything.

A section is not a React Flow node, so it cannot be selected, dragged or deleted through React Flow's
machinery. `sections/SectionLayer.tsx` draws the fill, border, header chip, member count and resize
handles in a `ViewportPortal`, counter-scaled with zoom, and runs its own pointer gestures.
`useBoardSections` holds the live offset while a drag is in flight and writes once on release.
Cmd/Ctrl+G creates a section, wrapping the selection when there is one, at `NEW_SECTION_SIZE`
(360 × 260) otherwise.

## Links and routing

A link is one `GraphEdge`. Both ends name a node and optionally a connector:

- `source`, `target` name a card, board or section id; the missing `sourceKind` or `targetKind` means a
  card, so older documents stay valid.
- `sourceConnector`, `targetConnector` name the 0..1 handle the line attaches to.
- `kind` is `references`, `relates-to` or `tagged`.
- `path` is `bezier`, `straight`, `step`, `smoothstep` or `avoid`. An unknown value draws as `bezier`.
- `bends` is a polyline in flow units relative to the source anchor, capped at 24 points, so moving an
  endpoint translates the whole route instead of stranding the bends.
- `layer` defaults to `below` the cards; `label` and `labelOffset` place the description chip on the
  path.

`links/linkGeometry.ts` and `links/edgeRoute.ts` turn endpoints, sections and bends into anchors and an
SVG path with no React, Loro or DOM in sight. The edge component, the section-link layer and the tests
all call the same functions, which is what keeps a preview and the finished link on the same curve.

A board end has no position, so it draws through the first portal card pointing at that board. With no
portal on the board there is no line, and the link survives in the inspector. A link whose two ends are
not both on this board is not drawn at all; the record is untouched.

Peers see link gestures live. `useBoardNodes` hides the shared edge while a peer re-attaches one of its
ends, and `presence/PeerReconnectLayer.tsx` draws the dashed preview from the same path helper, so the
two never stack.

`board/useBoardLinks.ts` owns the four link gestures: the thread a click starts
(`links/linkThread.ts`), the drag that creates a link, re-attaching an end, and sliding a label. Each
publishes its live state to peers and writes only on release.

## Gestures and input ownership

One pointer down has one owner. The owner is decided by where the press lands, and the handlers are
registered so that a press reaches the most specific surface first.

| Gesture | Owner | Where |
| --- | --- | --- |
| Node drag, click, marquee, pan, zoom | React Flow | `board/BoardSurface.tsx` |
| Section drag, resize, rename | `useBoardSections` | `sections/SectionLayer.tsx` |
| Connector drag and reposition | `useBoardLinks`, `NodeConnectors` | `canvas/NodeConnectors.tsx` |
| Link create, re-attach, label slide | `useBoardLinks` | `board/useBoardLinks.ts` |
| Keys | the board key chain | `board/useBoardKeyboard.ts` |
| Escape | the layer stack | `shell/escapeLayers.ts` |
| Pointer presence | the board root | `board/BoardView.tsx` |

`BoardView` listens on the capture phase for `pointerdown` and records the press in flow coordinates.
It has to be capture: React Flow stops the pane's own `pointerdown` from propagating, so a bubble
handler on the board root never sees a press on empty canvas. The marquee then starts from the section
the press landed in, which is what scopes a box to that section.

React Flow's `deleteKeyCode` is `null`, so it cannot remove a card behind the document's back. Every key
is read in one place, `useBoardKeyboard`, which runs five named actions in a fixed order: quick capture,
the Escape ladder, modifier chords, Delete/Backspace, Enter. `Enter` opens a portal for a viewer,
because navigating is not an edit, and every other card needs `canEditContent`.

Escape walks a stack. `useEscapeLayer` from `shell/escapeLayers.ts` pushes a dismiss function when a
surface opens and pops it when it closes; the most recently pushed layer takes the key and the board's
own chain only sees Escape when the stack is empty. A text field inside a layer keeps the key unless
that layer is a dialog. The board's own layers are the armed link thread (`board/useBoardLinks.ts`) and
a held placement run (`board/BoardView.tsx`).

## Camera and viewport

`board/useBoardCamera.ts` owns the camera. Viewports are UI state, not document data: `boardViewports` in
`store/useUiStore.ts` records one viewport per board, written from `onMoveEnd` on the surface and from a
`requestAnimationFrame` when a board first opens, so a return lands exactly where the reader left.

Navigation is one-shot. A caller sets `viewportRequest` (`{ boardId, viewport, nonce }`), and the camera
consumes it once; `viewport` null means "fit the board's content". `boardHistory` records how a board was
entered, and an entry with `via: "portal"` is what makes Escape step back to the previous board and
viewport instead of only clearing the selection.

The zoom range is `ZOOM_MIN` 0.05 to `ZOOM_MAX` 4, clamped by `clampZoom` in `canvas/zoomRange.ts`. A
presented tour is left unclamped, because a step may need a scale outside the editing band. Zoom bands
change what a card paints: `zoomBand` switches at 0.35 and 0.75, the board root carries
`data-zoom-band`, and the rules live in `apps/canvas/src/styles/paint.css`. A card never measures
itself to decide how much detail to draw.

Focus requests move the camera over `FOCUS_DURATION_MS` (300 ms), never past `FOCUS_MAX_ZOOM` (1.2), and
wait up to `FOCUS_POLL_TIMEOUT_MS` (1500 ms) for React Flow to register a card that has just been placed.

## Presence and cursors

Presence rides one `EphemeralStore` per workspace, joined by `collab/loroProvider.ts` at
`<workspaceId>:presence`. Signals are fields in `AWARENESS_FIELDS` (`collab/presence.ts`), typed in
`PeerPresence`: `board`, `user`, `pointer`, `focus`, `dragging`, `selection`, `selectionBox`,
`connector`, `resizing`, `sectionDrag`, `sectionResize`, `reconnect`, `connect`, `labelDrag`,
`libraryDrag`, `purpose`, `gesture` and `gestureBeat`. A new signal is a new field on that schema, which
is what keeps every feature from inventing its own channel.

Carets are separate. `loro-prosemirror`'s `CursorEphemeralStore` joins `<workspaceId>:cursors` with a 30
second TTL, and only the editor surface that owns the keystrokes receives it, so a mirrored editor cannot
clear the owner's caret. Peer carets are content-anchored, so a caret published from the panel renders
inside the collaborator's canvas card.

`collab/usePresenceStore.ts` publishes local fields and projects the remote ones. `collab/peerProjection.ts`
stamps each gesture with the time it last changed on the receiving side, so clock skew does not matter,
and drops the payload after `GESTURE_TTL_MS` (3000 ms) of silence. A one second sweep re-projects. A held
gesture bumps `gestureBeat` every `GESTURE_BEAT_MS` (1000 ms) so a press with no movement does not age
out. Selections and carets are state, so they outlive the TTL.

Every published coordinate is in flow units. Presence is workspace-wide, so a board-scoped surface filters
by `peer.board` through `hooks/useBoardPeers.ts`; a cursor from another board is not drawn at all. The
ephemeral rooms are not replayed to late joiners, otherwise a tab that closed mid-gesture would remain as
a frozen collaborator.

## Live drag versus persisted position

A drag keeps two positions at once, and only one of them is written.

While the pointer moves, React Flow owns the node's position. `board/BoardSurface.tsx` eases the painted
position toward the pointer sample with `LocalDragEase` (`canvas/localEasing.ts`), skipping the easing
when the reader sets `prefers-reduced-motion`, and publishes the pointer position to peers through
`setDragging` at most once per `DRAG_THROTTLE_MS` (40 ms) with a trailing sample. `useBoardRefs` holds
`locallyDraggingIds` and `draggedNodeIds`, which are the flags other hooks read to know a gesture is in
flight.

On release, the easing finishes and lands the rendered nodes on the pointer, then `commitDrop` writes the
new positions through `@suite/graph` in one commit. A peer never writes: `useBoardNodes` eases its node
toward the broadcast position with the same kind of smoothing (`SMOOTHING`, 0.22) and stops when the
presence payload clears.

Sections, connectors and labels follow the same split. A section drag sets `localSectionDrag` and calls
`updateSectionGeometry` on release. A connector move publishes its perimeter fraction and writes the
final fraction. A label slide publishes `labelDrag` with a path fraction and writes `labelOffset` when
the pointer is released.

## Board module map

| Path | Responsibility |
| --- | --- |
| `board/BoardView.tsx` | builds the board hooks, hosts the surface and overlays, owns pointer presence |
| `board/BoardSurface.tsx` | the `<ReactFlow>` element, drag and viewport handlers, capability gating |
| `board/BoardOverlays.tsx` | context menu, edge description, peer drag layer and other portals |
| `board/useBoardUi.ts` | one bundle of stores, camera helpers and capability flags for the board |
| `board/useBoardProjection.ts` | snapshot to board-scoped maps; no writes |
| `board/useBoardNodes.ts` | placements to flow nodes and edges, live offsets, peer easing |
| `board/useBoardSelection.ts` | selection reconciliation, marquee to flow box, scope release |
| `board/useBoardLinks.ts` | link thread, create, re-attach and label gestures |
| `board/useBoardSections.ts` | section gestures, live offsets, `NEW_SECTION_SIZE` |
| `board/useBoardCamera.ts` | viewport restore, fit, focus, portal entry, step back |
| `board/useBoardCommands.ts` | document commands, one capability check each |
| `board/useBoardKeyboard.ts` | the only keydown reader on the board |
| `board/useBoardRefs.ts` | mutable gesture flags shared between the hooks |
| `board/boardSupport.ts` | throttle, pointer sample, section-exit tolerance, edge conversion |
| `sections/SectionLayer.tsx` | section paint, header chrome, resize handles, pointer gestures |
| `links/linkGeometry.ts` | anchors, rects and path fractions without React |
| `links/edgeRoute.ts` | route modes and bend handling; pure geometry |
| `canvas/NodeConnectors.tsx` | connector dots, drag, menu, live perimeter |
| `canvas/zoomRange.ts` | zoom floor, ceiling, clamp and band breakpoints |
| `presence/PresenceLayer.tsx` | peer pointers, selections and marquee in a viewport portal |
| `store/workspaceSnapshotStore.ts` | the one `WorkspaceDocument.observe` call site and its card change stream |

`store/workspaceSnapshotStore.ts` is also how the canvas learns that a card's text moved. Its
`subscribeCardChanges` reports card ids for record and rich-text edits, which is what the library index
and the title list use instead of observing the document themselves.

Changing a gesture, a node surface or a presence channel is
[change-the-canvas.md](../how-to/change-the-canvas.md).
