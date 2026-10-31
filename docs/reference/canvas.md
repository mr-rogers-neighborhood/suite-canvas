# Canvas

`apps/canvas/src/canvas` turns the workspace document into a board you can point at: placements become
nodes, edges become routes, and every gesture ends in one `@suite/graph` write.

The document model and the data flow are in [architecture.md](architecture.md). This page maps the code
that draws it, and which layer owns each input.

## Board and placements

`board/BoardView.tsx` is the entry. It builds the board's hooks in the order they depend on each other
and hands the results to two components: `board/BoardSurface.tsx` hosts the React Flow `<ReactFlow>`
element, and `board/BoardOverlays.tsx` holds the layers beside it: the context menu, the link
description input, the link preview and the portal transition.

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

The outline rail keeps its panel on a board with no sections and says the board has none, instead of
disappearing; `canCreateContent` decides whether it also names Cmd/Ctrl+G.

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

A link is **one relationship per pair, per board**. Its identity is the two things it joins, not the
dots it happens to attach to and not its direction (`pairKey` in `links.ts`). `addEdge` is therefore an
upsert: asking for a link two things already have re-points that line at the dots named and returns the
same record.

The rule exists because the opposite one was indistinguishable from a bug. Unplacing a card keeps its
links, so while identity was the dots, every place, unplace and re-place that left a card on a different
side wrote *another* relationship between the same two things: a fan grew an extra spoke, a thread grew
an extra hop, and the board filled with lines no single gesture had drawn.

The corollaries are the whole of the lifecycle:

| Action | What happens to the links |
| --- | --- |
| Re-link the same pair | the existing line takes the new dots |
| Unplace a card | the links that touch it on that board are deleted with the placement, one undo step |
| Move a card to another board | the links it had on the board it left are deleted, because a link is a relationship *on* a board |
| Trash a card | the links that touch it are deleted with it, one undo step |
| Restore a trashed card | the card returns alone |
| Purge a card | unchanged: its links go |

Documents written under the old rule held several links over one pair, so `pruneDuplicateLinks()` runs
once when a workspace opens, keeping the most recently written line of each pair.

A board end has no position, so it draws through the first portal card pointing at that board. With no
portal on the board there is no line, and the link survives in the inspector: the relation is with the
board, which is still there. A link to a *card* is different, which is why unplacing a card deletes its
links: a dormant record that came back with the card read as a second line every time the pair was
linked again. A link whose two ends are not both on this board is not drawn at all.

Peers see link gestures live. `useBoardNodes` hides the shared edge while a peer re-attaches one of its
ends, and `presence/PeerReconnectLayer.tsx` draws the dashed preview from the same path helper, so the
two never stack.

`board/useBoardLinks.ts` owns the link gestures: the drag that creates one, re-attaching an end, and
sliding a label. Each publishes its live state to peers and writes only on release.

### The link tool

Three modes, chosen from one button in the widget pill (`links/ModeControl.tsx`): the glyph is the mode
it is in, a click advances `place → thread → fan → place` (`nextMode`), and the label says what the next
click switches to. One button rather than a segmented control because the pill is shared with the
camera and the zoom, and a three-wide control there cost more room than the one decision it carried.

A mode decides what a click on a dot does, and what a stack does with the cards left in it:

| Mode | A click on a dot | The shape it draws |
| --- | --- | --- |
| `place` | arms it; the next dot on another thing writes one link and lets go | one line |
| `thread` | links from the armed dot and arms the dot just clicked | a chain, A→B, B→C |
| `fan` | links from the armed dot and keeps it armed | a hub, A→B, A→C |

Shift chains and Control fans for one gesture without leaving the mode, and Escape walks the mode back
to `place`. This is `links/linkThread.ts` (`stepLink`, `stepThread`, `stepFan`), pure and unit-tested;
nothing about it places cards. There is no run, no queue and no held stack behind a mode.

Switching between `thread` and `fan` continues from the card just placed, and passing through `place`
on the way does not count as a decision: the anchor is re-read from the last placement, not from the hub
the previous mode was holding. A press is one undo step, link and placement together, and undoing a
placement the stack made puts the card back in the hand (`history/undoWithStack.ts`), so every undo
route (`Mod+Z`, the title bar, the palette, the history panel) hands it back rather than leaving it in
the inbox. The two connectors a placement joined are lit for a beat, so a chain says which ends were
used and not only that a line exists.

A stack placed while a mode is armed writes a link as well as a placement. `canvas/attachDots.ts`
answers which dots: the pair facing the way the cards travel. It is pure. `connectorToward` picks
the dot that points at the other box, `attachDots` returns the pair for a placement, and
`PlaceStackCursor` and `App.onDropSelection` both call it. A thread moves the armed end to the card it
just placed; a fan keeps the hub it started from, so `thread` chains and `fan` spreads.

## Gestures and input ownership

One pointer down has one owner. The owner is decided by where the press lands, and the handlers are
registered so that a press reaches the most specific surface first.

| Gesture | Owner | Where |
| --- | --- | --- |
| Node drag, click, marquee, pan, zoom | React Flow | `board/BoardSurface.tsx` |
| New card on empty canvas | `usePaneDoubleClick` | `board/usePaneDoubleClick.ts` |
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
because navigating is not an edit, and every other card needs `canEditContent`. A second listener on the
capture phase answers only the four arrow keys, so the five named actions keep their order.

Empty canvas creates. React Flow has no pane double-click prop, so `usePaneDoubleClick` binds the pane
element it builds and ignores a press that lands on a card, an edge, a section or a control, since those
keep their own double-click meaning. `zoomOnDoubleClick` is off: one gesture cannot both make a card and
move the camera. Creating is gated by `canCreateContent`, so a viewer's double-click does nothing.

Escape walks a stack. `useEscapeLayer` from `shell/escapeLayers.ts` pushes a dismiss function when a
surface opens and pops it when it closes; the most recently pushed layer takes the key and the board's
own chain only sees Escape when the stack is empty. A text field inside a layer keeps the key unless
that layer is a dialog. The board's own layer is the armed link thread
(`board/useBoardLinks.ts`).

With the stack empty, the ladder climbs from the most specific thing on the board to the plainest:
section edit → selected section → container inspector → card focus → card edit → focus target → a portal
back → the selection → `mode` → `purpose` → the hand. The two mode rungs reset a choice rather than clear
a surface, so pressing Escape with nothing left to close always ends with the reader placing on an
exploration, whatever they had armed an hour ago; one more press drops a stack that is still in hand,
which is the last thing there is to put down.

## Two axes, one of which is mostly implicit

`mode` says what a link gesture does, and `purpose` says what the canvas is *for*. Purpose is
deliberately small: `explore` is the resting state and needs no button, and `explain` is the only value a
reader chooses from the canvas itself.

`explain` gathers the selection into a read-only context, which is drawn inside the
[handbook](./ui.md) when the build has one and as a panel over the board when it does not: the gathered entities sit above the articles
that answer them, one selected thing opens its article, and **Point at something** turns the next
click into a target, including a region of the shell.

There is no placement run: no shapes, no anchors, no bar. Cards are placed one at a time, by a drop, a
dock action, a double-click, or from a stack — pick rows in the library, press `Place N`, and the stack
follows the pointer, one press per card (`canvas/placeStack.ts`, `canvas/PlaceStackCursor.tsx`).
Dragging a picked row out of the drawer carries the whole pick, and the drop's dashed outline is the
card's own box at the current zoom, so where it is drawn is where it lands.

A card that is already on this board is not a card to place: the stack and the drop pass over it and
leave it where the reader put it, and the stack's count is the number of presses that will actually
happen. Placing many cards should never rearrange the ones already there.

One card, one placement, per board: a placement is keyed `boardId:cardId` and a React Flow node is a
card, so *several* placements of one card on one board is a model change of its own, not a side effect
of a fix.

The appearance panel is one panel: right-clicking a card inside a selection opens it for the whole
selection (`app/AppearanceHost.tsx`), and nothing opens on its own when a second card is picked.

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

Camera controls are React Flow's own `<Controls>` pill, plus one button. Zoom in, zoom out and fit stay on
the built-in control; `BoardSurface.tsx` adds zoom to the selection (`fitView` over the selected ids at
`SELECTION_PADDING` 0.2) because the built-in pill has no equivalent. Zoom to selection follows
`prefersReducedMotion()`: a reader who asked for less motion arrives instead of flying.

The dot grid is always painted. It used to be a toggle beside a zoom readout in a second corner stack, which
is a control bar of its own for a preference nobody changes twice. The outline moved to the navigation row
beside the board tabs, and `[` still toggles it.

## Selection affordances

Arrow keys move the selection by `NUDGE_STEP` (8 flow units), or `NUDGE_LARGE_STEP` (40) with Shift.
`useBoardKeyboard` reads them on the capture phase, before React Flow's focused-node handler, so one
press is one step size and one call to `nudgeSelected` in `useBoardCommands`. That command runs the same
`commitDrop` a pointer release does, which is why a card nudged past its section's edge grows the section
instead of leaving it. The step needs `canEditLayout`. `NudgeHint` (`canvas/BoardHints.tsx`) prints both
steps whenever the selection is not empty, lifted above the bulk style bar when that bar is showing,
which is what makes the gesture discoverable.

A multi-selection edits style in bulk. `canvas/BulkStyleBar.tsx` patches each selected card's own
`SurfaceStyle` (shape and fill) through the same `setCardStyle` the single-card Style tab uses, with
`bulkStyleWrites` in `canvas/styleTargets.ts` merging each card's existing record. A key set back to
`undefined` is cleared, so "Default" and "never set" stay the same state. `@suite/graph` has no batched
style write, so a bulk edit is one surface write and one undo step per card.

The canvas's create verbs are registry commands: `card.createSketch`, `section.create` and
`portal.create`. Each has `owner: "canvas"`, so the dock lists it through `commandsFor`, and a palette
row, so the command palette lists the same three. A portal row names its target board (`New portal to
<board>`) because a portal needs one; its action is the optional `CommandActions.createPortalOnBoard`,
so those rows stay hidden until the shell supplies that handler.

## Arranging

An arrangement is a plan, not a rule. `canvas/interactions/arrangeCommand.ts` turns a selection and its
placements into a `LayoutPlan`, and `WorkspaceDocument.applyLayoutPlan` commits every write in one
undoable batch. Nothing is left behind that would move a card the reader places by hand afterwards.

| Command | Planner | What it does |
| --- | --- | --- |
| Align an edge or a centre line | `planAlign` | Moves the selection onto one edge of its common box |
| Distribute along an axis | `planDistribute` | Keeps the two extremes and evens the gaps between |
| Arrange as a mind map | `planRadial` | Rings the selected card's subtree around it |

`planRadial` in `canvas/interactions/radialLayout.ts` is the mind-map mode of ADR-0049, in its simplified
form: the selected card is the root and stays exactly where the reader put it, its children sit on the
first ring at `RADIAL_RING_GAP` (320 flow units) and their children on the second, and each branch owns an
arc proportional to how many cards hang off it. The tree is read from the document as it stands, through
`childrenFromLinks`: an outbound card link or a body mention is a child, a portal link is not. The
breadth-first walk means a cyclic or diamond-shaped graph draws each card once, at its shallowest depth.

The command is `layout.arrangeRadial` in `apps/canvas/src/command/commandRegistry.ts`, so the palette and
the dock cannot disagree about it. It is listed only while `CommandActions.arrangeRadial` is supplied. Two
surfaces supply it from the same plan: the board's menu runs `arrangeRadialSelection` in
`board/useBoardCommands.ts`, and the shell's palette row runs `useBoardPaletteActions` in
`apps/canvas/src/app/useBoardPaletteActions.ts`, which reads the selection in paint order and hands the
same `planRadial` and `childrenFromLinks` the board uses to `applyLayoutPlan`. Sections a moved card leaves
grow to contain it again, by the same rule align and distribute follow.

## Folds

A card folds to its header line and a section folds to its own header. Both are reader state, held in
`collapsedCards` and `collapsedSections` in `apps/canvas/src/store/useUiStore.ts`, and neither is written to
the document. Two people on one board can fold different things away.

A folded card does not mount its body, so nothing inside it can hold a caret. Its placement keeps the height
it had, which is why unfolding restores the card exactly. The height a folded card paints at is
`COLLAPSED_CARD_HEIGHT` in `canvas/nodeData.ts`, and the header's reference count is what the fold hides.

A portal folds the same way, through the same `collapsedCards` flag: its shell shrinks to
`PORTAL_HEADER_HEIGHT` (`canvas/PortalCard.tsx`), the miniature and the footer step out of the way, and the
header keeps the icon, the board name and the count. The shell height is what shrinks rather than the
placement, so a rolled-up portal leaves no hole on the board and unfolding restores the frame the reader
had resized.

A folded section stops drawing its members: `board/useBoardNodes.ts` skips a placement whose section is
folded, so the cards are absent rather than invisible. `sections/SectionLayer.tsx` paints the frame at header
height through `paintRect`, and the stored rect is untouched so unfolding puts every member back. A folded
section shows no resize handles, because there is nothing to resize.

### Icons

An entity's icon is resolved by one function, `resolvedIcon` in `canvas/entityIcon.ts`, in this order: the
paint record's `icon`, then the record's own field, then the type's icon. A card can also say "nothing",
which is `iconHidden` and beats both of the first two. One writer, `setEntityIcon`, puts the choice in
`style.icon` for a card and a portal and in the section's own field for a section, so the inspector, the
appearance panel and the canvas cannot disagree.

A chosen icon replaces what the entity would otherwise draw: the card's type glyph, the portal's circled
dot, or a section's colour dot. A section keeps the dot when no icon is set, so the colour an author picked
is never invisible.

There is no separate summary surface. An earlier build carried a rollup rail in the corner of the board
because neither a card nor a section could fold; the fold is on the two headers now and the rail is gone.

## Presence and cursors

Presence rides one `EphemeralStore` per workspace, joined by `collab/loroProvider.ts` at
`<workspaceId>:presence`. Signals are fields in `AWARENESS_FIELDS` (`collab/presence.ts`), typed in
`PeerPresence`: `board`, `user`, `pointer`, `focus`, `dragging`, `selection`, `selectionBox`,
`connector`, `resizing`, `sectionDrag`, `sectionResize`, `reconnect`, `connect`, `labelDrag`,
`libraryDrag`, `purpose`, `gesture`, `gestureBeat` and `presenceBeat`. A new signal is a new field on that
schema, which is what keeps every feature from inventing its own channel.

Carets are separate. `loro-prosemirror`'s `CursorEphemeralStore` joins `<workspaceId>:cursors` with a 30
second TTL, and only the editor surface that owns the keystrokes receives it, so a mirrored editor cannot
clear the owner's caret. Peer carets are content-anchored, so a caret published from the panel renders
inside the collaborator's canvas card.

`collab/usePresenceStore.ts` publishes local fields and projects the remote ones. `collab/peerProjection.ts`
stamps each gesture with the time it last changed on the receiving side, so clock skew does not matter,
and drops the payload after `GESTURE_TTL_MS` (3000 ms) of silence. A one second sweep re-projects. A held
gesture bumps `gestureBeat` every `GESTURE_BEAT_MS` (1000 ms) so a press with no movement does not age
out. Selections and carets are state, so they outlive the TTL.

Leaving is the client's problem, not the relay's. `loro-websocket` has no awareness protocol: measured
against a real `SimpleServer`, a client that disconnects leaves its ephemeral state in place and nothing
is announced, so a peer who closed the tab looks exactly like a peer who is reading. Every client
therefore publishes `presenceBeat` every `PRESENCE_BEAT_MS` (15 s), and `projectPeers` drops a peer it has
not heard from within `PRESENCE_TTL_MS` (60 s). Both numbers are inside the timer budget a background tab
gets, so a tab left in the background stays counted. The beat also distinguishes a live-and-idle peer from
one whose state the relay has just replayed, which is what made a departed collaborator reappear until a
reload.

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

Snapping is local and transient. `canvas/snapping.ts` compares the dragged card's left, centre and right
(and top, middle and bottom) with the same lines of every other card on the board. A match inside
`SNAP_THRESHOLD` (6 flow units) moves the rendered target and the drop position by that difference, and
`SnapGuideLayer` draws the line through a `ViewportPortal`. The snap runs before the local easing, so the
ease converges on the snapped position instead of fighting it, and the drop commits the position the
guides showed. A multi-card drag does not snap: pulling the group onto one member's edge would move the
other members out of formation.

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
| `board/usePaneDoubleClick.ts` | empty-canvas double-click creates a card |
| `canvas/snapping.ts` | edge and centre snapping, pure geometry, guide extents |
| `canvas/SnapGuideLayer.tsx` | alignment guides in a viewport portal |
| `canvas/board/BoardSurface.tsx` | the React Flow surface, its dot grid and the control pill |
| `canvas/BoardHints.tsx` | the arrow-key nudge hint |
| `canvas/BulkStyleBar.tsx` | style patch for a multi-selection |
| `canvas/nodeData.ts` | what a card node paints from, and the folded card height |
| `canvas/interactions/radialLayout.ts` | mind-map rings from a card's subtree |
| `canvas/peek/` | hover-peek resolver, delay rules and the read-only surface |
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
