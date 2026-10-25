import type { Card, Connector as ConnectorModel } from "@suite/graph";
import { useCallback, useMemo } from "react";
import { create } from "zustand";
import type { PresenceUser } from "../collab/presence";
import { usePresenceStore } from "../collab/usePresenceStore";
import type { Point } from "../components/Connector";
import { useBoardPeers } from "../hooks/useBoardPeers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
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
  /** W2: true while thread mode is choosing link targets. */
  threadMode: boolean;
  /** True while this client is dragging a link out of (or into) a connector. */
  draftActive: boolean;
  /** Peer colour while a peer focuses or drags this node, for the dot outline. */
  color: string | undefined;
  selectedConnectorId: string | null;
  movingConnectorPeers: Record<string, ConnectorPeerState>;
  selectingConnectorPeers: Record<string, PresenceUser[]>;
  onSelect: (connectorId: string) => void;
  onMoveStart: (connectorId: string) => void;
  onMove: (connectorId: string, position: Point) => void;
  onMoveFinished: () => void;
  onMoveEnd: (connectorId: string, position: Point) => void;
  onContextMenu: (event: React.MouseEvent, connectorId: string) => void;
}

/**
 * Thread mode reveals every node's connectors, because the user is picking link
 * targets. One reader, so every node kind and the section layer agree.
 */
export function useThreadMode(): boolean {
  return useUiStore((state) => state.linkMode === "thread");
}

/** The reveal inputs for sections and node faces, read from the one place. */
export function useConnectorRevealState(): { threadMode: boolean; draftActive: boolean } {
  const threadMode = useThreadMode();
  const draftActive = useLinkDraftStore((state) => state.draftActive);
  return { threadMode, draftActive };
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
  const { threadMode, draftActive } = useConnectorRevealState();
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

  const onSelect = useCallback(
    (connectorId: string) => {
      if (!nodeId) return;
      setSelectedConnector({ nodeId, connectorId });
    },
    [nodeId, setSelectedConnector],
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

  return {
    nodeId,
    connectors,
    threadMode,
    draftActive,
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
