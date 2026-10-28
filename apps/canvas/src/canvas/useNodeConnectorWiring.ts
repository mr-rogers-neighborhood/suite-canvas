import type { Card, Connector as ConnectorModel } from "@suite/graph";
import { useCallback, useMemo } from "react";
import { create } from "zustand";
import type { PresenceUser } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import { useBoardPeers } from "../hooks/useBoardPeers";
import type { Point } from "../presence/Connector";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { stepLink, stepShape, useLinkThreadStore } from "./links/linkThread";
import type { ConnectorPeerState } from "./NodeConnectors";

/**
 * Whether a link gesture is in flight. It lives here, next to the connector
 * layer that reads it, because the canvas owns the gesture and `useUiStore` is
 * not this workstream's file.
 *
 * W2: fold `draftActive` into the link-mode state on `useUiStore` (and drive it
 * from the link tool) once that exists; nothing else should read this store.
 */
interface LinkDraftState {
  draftActive: boolean;
  setDraftActive: (active: boolean) => void;
}

export const useLinkDraftStore = create<LinkDraftState>((set) => ({
  draftActive: false,
  setDraftActive: (draftActive) => set({ draftActive }),
}));

export interface NodeConnectorWiring {
  nodeId: string;
  connectors: readonly ConnectorModel[];
  /** A chaining mode (thread or fan) is on, so every dot is a link target. */
  chaining: boolean;
  /** True while this client is dragging a link out of (or into) a connector. */
  draftActive: boolean;
  /** True while a thread is armed, so every candidate connector is visible. */
  armed: boolean;
  /**
   * The armed end of the chain when it lives on this node: the origin a fan keeps
   * returning to, or the tail a thread moved. Marked so the reader can see where
   * the next click will link from.
   */
  armedConnectorId: string | null;
  /** Peer colour while a peer focuses or drags this node, for the dot outline. */
  color: string | undefined;
  selectedConnectorId: string | null;
  movingConnectorPeers: Record<string, ConnectorPeerState>;
  selectingConnectorPeers: Record<string, PresenceUser[]>;
  /** A peer is touching one of these dots, so the layer has to stay visible. */
  peerActive: boolean;
  onSelect: (connectorId: string, event?: React.MouseEvent) => void;
  onMoveStart: (connectorId: string) => void;
  onMove: (connectorId: string, position: Point) => void;
  onMoveFinished: () => void;
  onMoveEnd: (connectorId: string, position: Point) => void;
  onContextMenu: (event: React.MouseEvent, connectorId: string) => void;
}

/**
 * A chaining mode reveals every node's connectors, because the user is picking
 * link targets one click at a time. Thread and fan are the same problem for the
 * reveal rule — only what a click *does* differs — so both count. One reader, so
 * every node kind and the section layer agree.
 */
export function useChainingMode(): boolean {
  return useUiStore((state) => state.mode !== "place");
}

/** The reveal inputs for sections and node faces, read from the one place. */
export function useConnectorRevealState(): {
  chaining: boolean;
  draftActive: boolean;
  armed: boolean;
} {
  const chaining = useChainingMode();
  const draftActive = useLinkDraftStore((state) => state.draftActive);
  const threadArmed = useLinkThreadStore((state) => state.armed !== null);
  // Moving a link end is the same problem as arming a thread: every dot is a
  // candidate, so every dot has to be on screen.
  const movingEnd = useUiStore((state) => state.linkEndMove !== null);
  return { chaining, draftActive, armed: threadArmed || movingEnd };
}

/**
 * The connector gestures every node kind shares: select, move (persisted once on
 * release), the connector menu, and the peer rings that show where collaborators
 * are dragging or selecting a dot. Node faces spread this into `NodeConnectors`,
 * so a portal or a sketch never diverges from a note.
 */
export function useNodeConnectorWiring(
  card: Pick<Card, "id" | "connectors"> | null | undefined,
  boardId: string | null | undefined,
): NodeConnectorWiring {
  const nodeId = card?.id ?? "";
  const connectors = useMemo(() => card?.connectors ?? [], [card]);
  const { chaining, draftActive, armed: threadArmed } = useConnectorRevealState();
  const workspace = useCanvasStore((state) => state.workspace);
  const peers = useBoardPeers(boardId ?? null);
  const setMovingConnector = usePresenceStore((state) => state.setMovingConnector);
  const selectedConnector = useUiStore((state) => state.selectedConnector);
  const setSelectedConnector = useUiStore((state) => state.setSelectedConnector);
  const openContextMenu = useUiStore((state) => state.openContextMenu);
  // Connectors are workspace structure: moving or removing one follows the trash
  // row of the matrix, so a board or card draft cannot.
  const canManageStructure = useUiStore((state) => state.canManageTrash);

  const movingConnectorPeers = useMemo<Record<string, ConnectorPeerState>>(() => {
    const result: Record<string, ConnectorPeerState> = {};
    for (const peer of peers) {
      const moving = peer.connector;
      if (!nodeId || moving?.nodeId !== nodeId) continue;
      const entry = result[moving.connectorId] ?? { users: [], position: null };
      entry.users.push(peer.user);
      entry.position = entry.position ?? moving.position ?? null;
      result[moving.connectorId] = entry;
    }
    return result;
  }, [peers, nodeId]);

  const selectingConnectorPeers = useMemo<Record<string, PresenceUser[]>>(() => {
    const result: Record<string, PresenceUser[]> = {};
    for (const peer of peers) {
      const selected = peer.selection?.connector;
      if (!nodeId || selected?.nodeId !== nodeId) continue;
      const list = result[selected.connectorId] ?? [];
      list.push(peer.user);
      result[selected.connectorId] = list;
    }
    return result;
  }, [peers, nodeId]);

  const color = useMemo(() => {
    const focused = peers.find((peer) => peer.focus?.nodeId === nodeId);
    const dragging = peers.find((peer) => peer.dragging?.nodeId === nodeId);
    return focused?.user.color ?? dragging?.user.color;
  }, [peers, nodeId]);

  const armThread = useLinkThreadStore((state) => state.arm);
  const mode = useUiStore((state) => state.mode);
  const linkEndMove = useUiStore((state) => state.linkEndMove);
  const cancelLinkEndMove = useUiStore((state) => state.cancelLinkEndMove);

  /**
   * A click selects one connector, unless it continues a thread. Thread mode, or
   * Shift in either mode, links from the armed connector and arms the clicked
   * one, so a chain grows click by click without dragging.
   */
  const onSelect = useCallback(
    (connectorId: string, event?: React.MouseEvent) => {
      if (!nodeId) return;
      const clicked = { kind: "card" as const, id: nodeId, connectorId };

      // A link end was armed for moving: this press is the new home for it, not a
      // thread step and not a plain selection.
      if (linkEndMove) {
        workspace.reconnectEdge(linkEndMove.edgeId, linkEndMove.end, nodeId, connectorId, "card");
        cancelLinkEndMove();
        armThread(null);
        setSelectedConnector({ nodeId, connectorId });
        return;
      }

      // A click on a dot arms it, in every mode: place waits for a second dot to
      // finish its one link, and thread and fan write on the *next* click and keep
      // going. Arming is what makes "click this, then that" the same gesture as a drag.
      const thread = useLinkThreadStore.getState();
      if (thread.armed === null) {
        armThread(clicked, "mode", mode);
        setSelectedConnector({ nodeId, connectorId });
        return;
      }

      // The shape decides what the next click means: a thread moves its armed end,
      // a fan keeps it (ADR-0061). An arm outranks the stored mode, so a fan started
      // with Control stays a fan once the key is up.
      const shape = stepShape({
        shiftKey: event?.shiftKey,
        ctrlKey: event?.ctrlKey,
        mode,
        armedShape: thread.armedShape,
      });
      const step = stepLink(shape, thread.armed, clicked);
      // A gesture started by a modifier ends when the modifier is released; only a
      // shape chosen in the control survives the key.
      const by = shape === mode ? "mode" : "gesture";
      if (step.link && boardId) {
        workspace.addEdge({
          boardId,
          source: step.link.from.id,
          sourceKind: step.link.from.kind,
          sourceConnector: step.link.from.connectorId,
          target: step.link.to.id,
          targetKind: step.link.to.kind,
          ...(step.link.to.kind === "card" ? { targetConnector: step.link.to.connectorId } : {}),
        });
      }
      // Place writes one link and lets go; thread moves its arm on, fan keeps it.
      const next = shape === "place" ? null : step.armed;
      armThread(next, by, shape);
      setSelectedConnector(
        next ? { nodeId: next.id, connectorId: next.connectorId } : { nodeId, connectorId },
      );
    },
    [
      nodeId,
      boardId,
      mode,
      armThread,
      setSelectedConnector,
      workspace,
      linkEndMove,
      cancelLinkEndMove,
    ],
  );

  const onMoveStart = useCallback(
    (connectorId: string) => {
      if (!canManageStructure || !nodeId) return;
      setMovingConnector({ nodeId, connectorId });
    },
    [canManageStructure, nodeId, setMovingConnector],
  );

  const onMove = useCallback(
    (connectorId: string, position: Point) => {
      if (!canManageStructure || !nodeId) return;
      setMovingConnector({ nodeId, connectorId, position });
    },
    [canManageStructure, nodeId, setMovingConnector],
  );

  const onMoveFinished = useCallback(() => setMovingConnector(null), [setMovingConnector]);

  const onMoveEnd = useCallback(
    (connectorId: string, position: Point) => {
      if (!canManageStructure || !nodeId) return;
      // The dot has already magnetised on the way here; snap here would pull a
      // deliberately free drop back onto an anchor.
      workspace.moveConnector(nodeId, connectorId, position);
    },
    [canManageStructure, nodeId, workspace],
  );

  const onContextMenu = useCallback(
    (event: React.MouseEvent, connectorId: string) => {
      if (!canManageStructure || !nodeId) return;
      openContextMenu({
        x: event.clientX,
        y: event.clientY,
        kind: "connector",
        nodeId,
        connectorId,
      });
    },
    [canManageStructure, nodeId, openContextMenu],
  );

  const peerActive =
    Object.keys(movingConnectorPeers).length > 0 || Object.keys(selectingConnectorPeers).length > 0;
  // Read the arm, not just whether one exists: this node is the origin only when
  // the armed end names it.
  const armedEnd = useLinkThreadStore((state) => state.armed);

  return {
    nodeId,
    connectors,
    chaining,
    draftActive,
    // Moving a link end makes every dot a candidate: reveal them all, exactly as
    // an armed thread does, or there is nothing to aim at.
    armed: threadArmed || linkEndMove !== null,
    armedConnectorId: armedEnd && nodeId && armedEnd.id === nodeId ? armedEnd.connectorId : null,
    peerActive,
    color,
    selectedConnectorId:
      selectedConnector?.nodeId === nodeId ? selectedConnector.connectorId : null,
    movingConnectorPeers,
    selectingConnectorPeers,
    onSelect,
    onMoveStart,
    onMove,
    onMoveFinished,
    onMoveEnd,
    onContextMenu,
  };
}
