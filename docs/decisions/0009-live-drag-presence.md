# ADR-0009: Live presence for connector and link drags

- **Status:** accepted
- **Date:** 2026-10-21

## Context

Connector positions and link endpoints only reached collaborators when the pointer was released.
Card drags had already solved that problem with awareness + per-frame smoothing, but a connector or
link drag stayed invisible to everyone else until the drop, which made collaboration feel
one-directional and hid the most interesting moment of the gesture.

## Decision

1. **Reuse the awareness channel, not the CRDT.** `connector` carries the live perimeter fraction and
   `reconnect` carries the dragged link end. Writing to Yjs per frame would flood every client's
   document history with throwaway states; presence is ephemeral by design and disappears with the
   pointer.
2. **Throttle with a trailing sample.** A bare throttle drops the final event, leaving peers frozen a
   step behind a pointer that has stopped. Both broadcasts schedule a trailing publish for the end of
   the window, and the connector flushes the exact drop position before clearing presence.
3. **Smooth on the receiver.** `Connector` eases toward the peer's latest fraction each animation
   frame (`0.22`, matching card drags) and calls `updateNodeInternals` so the peer's links re-route
   with the dot.
4. **Preview link drags with the library's own geometry.** `PeerReconnectLayer` computes the anchored
   connector's flow position from the node's measured size, then draws a dashed path to the peer's
   pointer using `getBezierPath` / `getStraightPath` / `getSmoothStepPath`, i.e. the same helpers the
   real edge uses, and hides the shared edge while the preview is up.
5. **React Flow reports the anchored handle.** `onReconnectStart`/`onReconnectEnd` receive the handle
   that stays anchored, so presence records the *opposite* end as the moving one.
6. **Forward the snap, do not recreate it.** While a link end is dragged, the mover reads React Flow's
   `connection.toNode`/`toHandle` from the store (the value that already highlights the handle under
   the pointer) and publishes it as `reconnect.target`. Peers end the preview on that connector,
   perpendicular to its side, so the preview shows exactly the drop the mover is about to make.
   Re-implementing the radius test locally would drift from the library's own tolerances.
7. **A connector click is presence too.** `selection` gained an optional `connector`, published from a
   single effect in `CanvasBoard` that merges React Flow's selection with the clicked connector.
   Peers draw a dashed outline in their colour. Publishing per node (from `NoteNode`) was rejected:
   each node would clear the shared field when another node's connector was clicked, and the winner
   would depend on effect order.

8. **Arrowheads describe the result, not the gesture.** The preview draws its marker at the ends the
   finished link will mark: the target end (free while dragging the target, anchored while dragging
   the source) plus the source end when the link is bidirectional. Putting a marker on whatever end
   the pointer holds made the synced client show an arrow the drop would not produce.

9. **A brand-new link is a gesture too.** Dragging out of a connector produced no document writes
   until the drop, so peers saw nothing at all — the most interesting moment of the gesture was
   invisible. `onConnectStart` now publishes `connect`, the same shape of presence as `reconnect`
   (anchor, live pointer, forwarded snap target), followed by the same throttled + trailing pointer
   sampler and cleared by `onConnectEnd`. React Flow reports an edge updater through
   `onConnectStart` as well, so a ref set by `onReconnectStart` (which the library calls first) keeps
   the two gestures from producing a preview each; starting one clears the other's field.
10. **The anchor end is recorded.** Every connector is currently a `<Handle type="source">`, so a
   normal new link anchors the *source* and the arrow belongs on the pointer end. Recording
   `anchorEnd` keeps the preview correct if connectors ever expose target handles, without the
   renderer having to guess from the handle type of an edge that does not exist yet.
11. **The snap target is forwarded, not recomputed** for the same reason as reconnect: React Flow
   already resolved which connector is under the pointer, and re-testing its radius here would
   drift. Peers end the preview on that connector, so the dashed path predicts the exact drop.

Rejected alternatives:

- **Ghost node + ghost edge.** Injecting an invisible node under the peer's pointer so React Flow could
  route the preview looked elegant, but a node that mounts mid-session has unmeasured handles and the
  edge referencing it was silently dropped; calling `updateNodeInternals` from the node did not help.
  Drawing the path directly is deterministic.
- **CRDT writes during the drag.** Simpler on the receiving side, but it turns a pointer gesture into
  document history and would let an interrupted drag persist a half-finished position.

## Consequences

- Connectors and links move on every screen while the drag is in flight, with no CRDT churn.
- The preview shares the real edge's path style and the peer's colour, so intent is legible at a glance.
- Preview geometry depends on the anchor node being measured; while a node is unmeasured the preview
  stays hidden rather than drawing at the origin.
