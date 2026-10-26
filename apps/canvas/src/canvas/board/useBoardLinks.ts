import type { EdgeEndpointKind } from "@suite/graph";
import type { Connection, Edge, HandleType, OnConnectEnd, OnConnectStart } from "@xyflow/react";
import { useStore } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { portalTargetId } from "../../cards/portal";
import type { ConnectState } from "../../collab/presence";
import { useEscapeLayer } from "../../shell/escapeLayers";
import type { EdgeDescriptionData } from "../EdgeDescription";
import {
  connectorAtPoint,
  endpointAtPoint,
  type LinkAnchor,
  type LinkEndpointRef,
} from "../links/linkGeometry";
import { linkEndConnector } from "../links/linkGesture";
import { useLinkThreadStore } from "../links/linkThread";
import { useConnectorRevealState, useLinkDraftStore } from "../useNodeConnectorWiring";
import { clientPoint, followPointer } from "./boardSupport";
import type { useBoardProjection } from "./useBoardProjection";
import type { useBoardRefs } from "./useBoardRefs";
import type { useBoardUi } from "./useBoardUi";

/** Screen-pixel radius that counts as a release on a connector dot. */
const CONNECTOR_DROP_RADIUS = 14;

/** The connector a local new-link drag started from, minus the live pointer. */
type ConnectAnchor = Omit<ConnectState, "position" | "target">;

/**
 * Drawing links: the thread a click starts, the preview a drag publishes, the
 * reconnect gesture, and the label editor a link opens. Every commit goes
 * through `WorkspaceDocument`; nothing here holds document truth.
 */
export function useBoardLinks(
  ui: ReturnType<typeof useBoardUi>,
  input: {
    refs: ReturnType<typeof useBoardRefs>;
    projection: ReturnType<typeof useBoardProjection>;
  },
) {
  const {
    workspace,
    activeBoardId,
    canCreateContent,
    canEditLayout,
    setReconnect,
    setConnect,
    setLinkingInProgress,
    setSelectedConnector,
    setLabelDrag,
    screenToFlowPosition,
    store,
    mode,
  } = ui;
  const { refs, projection } = input;
  const { linkScene, nodeIdForEndpoint, cardsById } = projection;
  const { reconnectGesture, connectCommitted } = refs;
  const zoom = useStore((state) => state.transform[2]);

  /**
   * When the last thread step happened. React Flow reports a connector release as
   * a *node click* too, and clearing the thread there would disarm it in the same
   * gesture that armed it.
   */
  const threadStepAt = useRef(0);
  const armedThread = useLinkThreadStore((state) => state.armed);
  useEscapeLayer(() => {
    useLinkThreadStore.getState().clear();
    setSelectedConnector(null);
  }, armedThread !== null);
  const [threadCursor, setThreadCursor] = useState<LinkAnchor | null>(null);
  /**
   * The connector a gesture started on, readable synchronously. A click fires
   * connect-start and connect-end before React re-renders, so the state set by
   * the first is still null in the second.
   */
  const connectingDraft = useRef<{
    nodeId: string;
    connectorId: string;
    anchorEnd: "source" | "target";
  } | null>(null);

  // Releasing the key that started an origin ends it: the modifier was the mode.
  // Shift chains, Control webs, and an origin started from the control keeps
  // going because nothing is being held.
  useEffect(() => {
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== "Shift" && event.key !== "Control") return;
      const state = useLinkThreadStore.getState();
      if (state.armedBy === "gesture") state.clear();
    };
    window.addEventListener("keyup", onKeyUp);
    return () => window.removeEventListener("keyup", onKeyUp);
  }, []);

  // A thread belongs to the mode it started in: leaving the mode must not leave
  // a connector armed in a mode that no longer chains on a plain click.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mode is the trigger, not a value read in the effect.
  useEffect(() => {
    useLinkThreadStore.getState().clear();
  }, [mode]);
  // The reader's default radius, the rung a card falls back to when its own style and the

  // While a thread is armed the pointer is the other end of a line that is not
  // drawn yet, so follow it in flow coordinates.
  useEffect(() => {
    if (!armedThread) {
      setThreadCursor(null);
      return;
    }
    const follow = (event: PointerEvent) => {
      setThreadCursor(screenToFlowPosition({ x: event.clientX, y: event.clientY }));
    };
    window.addEventListener("pointermove", follow);
    return () => window.removeEventListener("pointermove", follow);
  }, [armedThread, screenToFlowPosition]);

  const [reconnecting, setReconnecting] = useState<{
    edgeId: string;
    end: HandleType;
    /** The connector that stays put, so a snap onto it is not mistaken for a target. */
    anchorConnector: string | null;
  } | null>(null);
  const [connecting, setConnecting] = useState<ConnectAnchor | null>(null);
  // Published for surfaces the board does not own: the inspector fades while a
  // link is drawn, because the preview and its destination are under the panel.
  useEffect(() => {
    setLinkingInProgress(connecting !== null);
    return () => setLinkingInProgress(false);
  }, [connecting, setLinkingInProgress]);
  const [edgeDescription, setEdgeDescription] = useState<{
    edgeId: string;
    x: number;
    y: number;
    value: string;
  } | null>(null);

  const setLinkDraftActive = useLinkDraftStore((state) => state.setDraftActive);
  const revealState = useConnectorRevealState();
  useEffect(() => {
    setLinkDraftActive(Boolean(connecting) || Boolean(reconnecting));
    return () => setLinkDraftActive(false);
  }, [connecting, reconnecting, setLinkDraftActive]);

  // A press on a connector is a draft gesture even when the pointer never moves;
  // React Flow only reports an end for a real drag, so the release is observed
  // here. Otherwise a click would leave the draft — and every dot — showing.
  useEffect(() => {
    if (!connecting && !reconnecting) return;
    const clear = () => {
      reconnectGesture.current = false;
      setConnecting(null);
      setConnect(null);
      setReconnecting(null);
      setReconnect(null);
    };
    // `mouseup`, not `pointerup`: React Flow finishes the gesture on the mouse
    // event, so observing the pointer event first would clear the draft before
    // the drop could read it. Both listeners are bubble-phase on window, which
    // is after React Flow's document handlers.
    window.addEventListener("mouseup", clear);
    window.addEventListener("touchend", clear);
    window.addEventListener("pointercancel", clear);
    return () => {
      window.removeEventListener("mouseup", clear);
      window.removeEventListener("touchend", clear);
      window.removeEventListener("pointercancel", clear);
    };
  }, [connecting, reconnecting, setConnect, setReconnect, reconnectGesture]);

  const startEdgeDescription = useCallback(
    (edgeId: string, point: { x: number; y: number }) => {
      const edge = workspace.getEdge(edgeId);
      if (!edge) return;
      // The edge keeps its selection: only the inline editor is opening.
      setEdgeDescription({ edgeId, x: point.x, y: point.y, value: edge.label ?? "" });
    },
    [workspace],
  );

  /**
   * A label drag is a gesture like any other: peers see it live and it becomes
   * one structural write on release, so a slide never streams CRDT commits.
   */
  const onLabelDrag = useCallback(
    (edgeId: string, offset: number, phase: "start" | "move" | "stop") => {
      if (!canEditLayout) return;
      if (phase === "stop") {
        setLabelDrag(null);
        workspace.setEdgeLabelOffset(edgeId, offset);
        return;
      }
      setLabelDrag({ edgeId, offset });
    },
    [setLabelDrag, workspace, canEditLayout],
  );

  // Stable so the edge list keeps its identity between unrelated board renders.
  // A share without layout capability gets no label gestures at all.
  const labelHandlers = useMemo(
    () =>
      canEditLayout
        ? { onLabelDrag, onLabelEdit: startEdgeDescription }
        : ({} as Pick<EdgeDescriptionData, "onLabelDrag" | "onLabelEdit">),
    [onLabelDrag, startEdgeDescription, canEditLayout],
  );

  /**
   * What a drop on `hit` should link to. A portal card stands in for the board
   * it opens, so a link released on one points at the board, not at the card
   * that shows it; a section points at itself; a card stays a card.
   */
  const endpointForDrop = useCallback(
    (hit: { kind: EdgeEndpointKind; id: string }): { kind: EdgeEndpointKind; id: string } => {
      if (hit.kind !== "card") return hit;
      const targetBoard = portalTargetId(cardsById.get(hit.id));
      return targetBoard ? { kind: "board", id: targetBoard } : hit;
    },
    [cardsById],
  );

  /**
   * Resolves a flow point to what a link released there should point at. A
   * release on a dot resolves to that dot, whatever the entity's shape says:
   * otherwise a section-to-card link always leaves from the side facing the
   * section and ignores which port was aimed at.
   */
  const resolveLinkTarget = useCallback(
    (point: LinkAnchor): LinkEndpointRef | null => {
      if (!activeBoardId) return null;
      const hit =
        connectorAtPoint(point, activeBoardId, linkScene, CONNECTOR_DROP_RADIUS / zoom) ??
        endpointAtPoint(point, activeBoardId, linkScene);
      if (!hit) return null;
      const endpoint = endpointForDrop(hit);
      const connectorId = linkEndConnector(
        hit.kind === "card" ? hit.id : null,
        nodeIdForEndpoint(endpoint),
        hit.connectorId,
      );
      return connectorId ? { ...endpoint, connectorId } : endpoint;
    },
    [activeBoardId, linkScene, endpointForDrop, nodeIdForEndpoint, zoom],
  );

  const onSectionLinkCommit = useCallback(
    (from: LinkEndpointRef, to: LinkEndpointRef, origin: LinkAnchor) => {
      if (!canCreateContent || !activeBoardId) return;
      void origin;
      // Either end may be the section: a thread can start on a card's dot and
      // finish on a section's, so both kinds and both dots come from the caller.
      workspace.addEdge({
        boardId: activeBoardId,
        source: from.id,
        sourceKind: from.kind,
        target: to.id,
        targetKind: to.kind,
        ...(from.connectorId ? { sourceConnector: from.connectorId } : {}),
        // A board end keeps its dot too: the dot belongs to the portal the link
        // is drawn through, which is exactly what was released on.
        ...(to.connectorId ? { targetConnector: to.connectorId } : {}),
      });
    },
    [workspace, activeBoardId, canCreateContent],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!canCreateContent) return;
      if (!connection.source || !connection.target) return;
      if (!activeBoardId) return;
      // The release also reaches onConnectEnd; the link already exists.
      connectCommitted.current = true;
      const target = endpointForDrop({ kind: "card", id: connection.target });
      // A board target is drawn at the portal that opens it, so the portal's
      // connector is the anchor — unless the board has more than one portal here
      // and the line is painted on a different one, where that dot would be
      // unknown to React Flow and the link would vanish.
      const targetConnector = linkEndConnector(
        connection.target,
        nodeIdForEndpoint(target),
        connection.targetHandle,
      );
      const sourceConnector = linkEndConnector(
        connection.source,
        nodeIdForEndpoint({ kind: "card", id: connection.source }),
        connection.sourceHandle,
      );
      // A duplicate or a self-link comes back null; drawing one twice is a
      // quiet no-op, not an error.
      workspace.addEdge({
        boardId: activeBoardId,
        source: connection.source,
        target: target.id,
        targetKind: target.kind,
        ...(sourceConnector ? { sourceConnector } : {}),
        ...(targetConnector ? { targetConnector } : {}),
      });
    },
    [
      workspace,
      activeBoardId,
      canCreateContent,
      endpointForDrop,
      nodeIdForEndpoint, // The release also reaches onConnectEnd; the link already exists.
      connectCommitted,
    ],
  );

  // React Flow reports nothing while a reconnect drag moves, so follow the
  // pointer ourselves and publish the endpoint for peers to preview.
  useEffect(() => {
    if (!reconnecting) return;

    let frame: number | null = null;
    let cancelled = false;
    const publish = (position: { x: number; y: number }) => {
      if (frame !== null) cancelAnimationFrame(frame);
      // React Flow updates `connection` after the pointer event, so read it on
      // the next frame; otherwise a sample that lands on a connector can keep
      // the previous, unsnapped target.
      frame = requestAnimationFrame(() => {
        frame = null;
        if (cancelled) return;
        const { connection } = store.getState();
        const snapped = connection.isValid
          ? [connection.toHandle, connection.fromHandle].find(
              (handle) => handle && handle.id !== reconnecting.anchorConnector,
            )
          : undefined;

        setReconnect({
          edgeId: reconnecting.edgeId,
          end: reconnecting.end,
          position,
          ...(snapped?.nodeId && snapped.id
            ? { target: { nodeId: snapped.nodeId, connectorId: snapped.id } }
            : {}),
        });
      });
    };
    const { follow, stop } = followPointer(screenToFlowPosition, publish);

    window.addEventListener("pointermove", follow);
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", follow);
      // The drop already rewrote the edge, so never re-publish here: onReconnectEnd
      // clears the field first and a late sample would resurrect the preview.
      stop();
    };
  }, [reconnecting, screenToFlowPosition, setReconnect, store]);

  // A new link has no edge to follow yet, so its live pointer rides awareness
  // the same way a reconnect drag's does.
  useEffect(() => {
    if (!connecting) return;

    let frame: number | null = null;
    let cancelled = false;
    const publish = (position: { x: number; y: number }) => {
      if (frame !== null) cancelAnimationFrame(frame);
      // Forward React Flow's own snap decision rather than re-testing radii.
      // Read it after React Flow processes the pointer event.
      frame = requestAnimationFrame(() => {
        frame = null;
        if (cancelled) return;
        const { connection } = store.getState();
        const snapped = connection.isValid
          ? [connection.toHandle, connection.fromHandle].find(
              (handle) =>
                handle &&
                handle.id !== connecting.connectorId &&
                handle.nodeId !== connecting.nodeId,
            )
          : undefined;

        setConnect({
          nodeId: connecting.nodeId,
          connectorId: connecting.connectorId,
          anchorEnd: connecting.anchorEnd,
          position,
          ...(snapped?.nodeId && snapped.id
            ? { target: { nodeId: snapped.nodeId, connectorId: snapped.id } }
            : {}),
        });
      });
    };
    const { follow, stop } = followPointer(screenToFlowPosition, publish);

    window.addEventListener("pointermove", follow);
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", follow);
      // onConnectEnd clears the field first; a late sample must not revive it.
      stop();
    };
  }, [connecting, screenToFlowPosition, setConnect, store]);

  const onConnectStart = useCallback<OnConnectStart>(
    (event, params) => {
      if (!canCreateContent) return;
      // Edge updaters report their anchored handle here as well; that gesture
      // publishes `reconnect` and has its own preview.
      if (reconnectGesture.current) return;

      const { nodeId, handleId, handleType } = params;
      if (!nodeId || !handleId) return;

      const anchorEnd = handleType === "target" ? "target" : "source";
      // Two link gestures never overlap, so the reconnect preview goes first.
      setReconnecting(null);
      setReconnect(null);
      setConnecting({ nodeId, connectorId: handleId, anchorEnd });
      connectingDraft.current = { nodeId, connectorId: handleId, anchorEnd };

      const point = clientPoint(event);
      if (!point) return;
      setConnect({
        nodeId,
        connectorId: handleId,
        anchorEnd,
        position: screenToFlowPosition(point),
      });
    },
    [screenToFlowPosition, setConnect, setReconnect, canCreateContent, reconnectGesture.current],
  );

  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      const draft = connecting ?? connectingDraft.current;
      connectingDraft.current = null;
      const committed = connectCommitted.current;
      connectCommitted.current = false;
      setConnecting(null);
      setConnect(null);
      // Released on a connector dot: `onConnect` already wrote the link.
      if (committed) return;
      if (!draft) return;
      if (!canCreateContent || !activeBoardId) return;

      const client = clientPoint(event);
      // The event's own coordinates are the release point; `connectionState.pointer`
      // can lag a sample behind, which lands the drop on whatever was under the
      // pointer a frame earlier. A synthetic event carries 0,0, so fall back then.
      const usable = client && (client.x !== 0 || client.y !== 0) ? client : null;
      const point = usable ? screenToFlowPosition(usable) : (connectionState?.pointer ?? null);
      if (!point) return;
      // A section or a portal body has no handle to snap to, so the drop is
      // resolved geometrically. Releasing over a plain card keeps today's
      // behaviour: a card links from its dots, not its body.
      // React Flow knows which node the pointer was over; prefer it, because a
      // portal and the card beneath it overlap and geometry alone can disagree
      // with what the user aimed at.
      const overNodeId = connectionState?.toNode?.id;
      // A section has no React Flow node, so its dot is resolved geometrically —
      // with the dot, not just the shape, or the line lands on whichever side
      // faces the source instead of the connector it was dropped on.
      const hit: LinkEndpointRef | null = overNodeId
        ? { kind: "card", id: overNodeId }
        : resolveLinkTarget(point);
      if (!hit) return;
      const target = endpointForDrop(hit);
      if (target.kind === "card") return;

      const from = { kind: "card" as const, id: draft.nodeId };
      const source = draft.anchorEnd === "target" ? target : from;
      const other = draft.anchorEnd === "target" ? from : target;
      // The dot at the moving end is the one released on; the dot at the anchor
      // end is the one the gesture started from.
      const releasedConnector = hit.connectorId;
      workspace.addEdge({
        boardId: activeBoardId,
        source: source.id,
        sourceKind: source.kind,
        target: other.id,
        targetKind: other.kind,
        ...(draft.anchorEnd === "target"
          ? { targetConnector: draft.connectorId }
          : { sourceConnector: draft.connectorId }),
        ...(draft.anchorEnd === "target" && releasedConnector
          ? { sourceConnector: releasedConnector }
          : {}),
        ...(draft.anchorEnd === "source" && releasedConnector
          ? { targetConnector: releasedConnector }
          : {}),
      });
    },
    [
      connecting,
      canCreateContent,
      activeBoardId,
      screenToFlowPosition,
      resolveLinkTarget,
      endpointForDrop,
      workspace,
      setConnect,
      connectCommitted.current,
      connectCommitted,
    ],
  );

  const onReconnectStart = useCallback(
    (event: React.MouseEvent, edge: Edge, handleType: HandleType) => {
      if (!canEditLayout) return;
      // React Flow also fires onConnectStart for this drag; mark it so the
      // new-link presence stays out of it.
      reconnectGesture.current = true;
      setConnecting(null);
      setConnect(null);
      // React Flow reports the handle that stays anchored, so the other end moves.
      const end: HandleType = handleType === "source" ? "target" : "source";
      setReconnecting({
        edgeId: edge.id,
        end,
        anchorConnector: (handleType === "source" ? edge.sourceHandle : edge.targetHandle) ?? null,
      });
      setReconnect({
        edgeId: edge.id,
        end,
        position: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      });
    },
    [
      screenToFlowPosition,
      setReconnect,
      setConnect,
      canEditLayout, // React Flow also fires onConnectStart for this drag; mark it so the
      // new-link presence stays out of it.
      reconnectGesture,
    ],
  );

  const onReconnectStop = useCallback(() => {
    reconnectGesture.current = false;
    setReconnecting(null);
    setReconnect(null);
  }, [setReconnect, reconnectGesture]);

  const onReconnect = useCallback(
    (oldEdge: Edge, connection: Connection) => {
      if (!canEditLayout) return;
      if (!connection.source || !connection.target) return;
      // React Flow keeps the anchored end intact, so an unchanged source means the target moved.
      const end: "source" | "target" =
        connection.source === oldEdge.source && connection.sourceHandle === oldEdge.sourceHandle
          ? "target"
          : "source";
      const nodeId = end === "source" ? connection.source : connection.target;
      const connectorId = end === "source" ? connection.sourceHandle : connection.targetHandle;
      // Reconnecting onto a portal retargets the board it opens, the same way a
      // fresh drop does; any other node stays a card endpoint.
      const target = endpointForDrop({ kind: "card", id: nodeId });
      workspace.reconnectEdge(
        oldEdge.id,
        end,
        target.id,
        target.kind === "card" ? (connectorId ?? undefined) : undefined,
        target.kind,
      );
    },
    [workspace, canEditLayout, endpointForDrop],
  );

  const commitEdgeDescription = useCallback(
    (value: string) => {
      if (!edgeDescription) return;
      // Empty text removes the description rather than storing a blank one.
      workspace.setEdgeLabel(edgeDescription.edgeId, value.trim() ? value : null);
      setEdgeDescription(null);
    },
    [workspace, edgeDescription],
  );

  const cancelEdgeDescription = useCallback(() => setEdgeDescription(null), []);

  return {
    threadStepAt,
    armedThread,
    threadCursor,
    reconnecting,
    connecting,
    edgeDescription,
    revealState,
    labelHandlers,
    startEdgeDescription,
    commitEdgeDescription,
    cancelEdgeDescription,
    resolveLinkTarget,
    onSectionLinkCommit,
    endpointForDrop,
    onConnect,
    onConnectStart,
    onConnectEnd,
    onReconnect,
    onReconnectStart,
    onReconnectStop,
  };
}
