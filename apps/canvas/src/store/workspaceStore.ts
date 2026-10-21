import type { Board, Card, GraphEdge } from "@suite/graph";
import { useEffect, useSyncExternalStore } from "react";
import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import { useCanvasStore } from "./useCanvasStore";
import { type WorkspaceSnapshotStore, workspaceSnapshotStore } from "./workspaceSnapshotStore";

export function useWorkspaceStore(): WorkspaceSnapshotStore {
  const workspace = useCanvasStore((state) => state.workspace);
  return workspaceSnapshotStore(workspace);
}

function useSelect<T>(select: (snapshot: WorkspaceSnapshot) => T): T {
  const store = useWorkspaceStore();
  const get = () => select(store.getSnapshot());
  return useSyncExternalStore(store.subscribe, get, get);
}

/**
 * Whole-workspace binding for consumers that genuinely read several sections
 * (`CanvasBoard`, the shell). The snapshot identity only changes when a
 * section did, and unchanged sections keep their array identity.
 */
export function useWorkspaceSnapshot(): WorkspaceSnapshot {
  const store = useWorkspaceStore();
  const ready = useCanvasStore((state) => state.ready);
  const synced = useCanvasStore((state) => state.synced);

  // biome-ignore lint/correctness/useExhaustiveDependencies: ready/synced are re-read triggers, not inputs.
  useEffect(() => {
    store.refresh();
  }, [store, ready, synced]);

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useBoards(): Board[] {
  return useSelect((snapshot) => snapshot.boards);
}

export function useCards(): Card[] {
  return useSelect((snapshot) => snapshot.cards);
}

export function useEdges(): GraphEdge[] {
  return useSelect((snapshot) => snapshot.edges);
}

export function useCard(cardId: string | null | undefined): Card | undefined {
  const store = useWorkspaceStore();
  const get = () => (cardId ? store.card(cardId) : undefined);
  return useSyncExternalStore(store.subscribe, get, get);
}
