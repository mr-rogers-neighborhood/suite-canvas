import { useMemo } from "react";
import { type PeerPresence, usePresenceStore } from "../collab/usePresenceStore";

/**
 * Peers looking at the same board. Presence is workspace-wide (one document),
 * so everything board-scoped has to filter, or cursors from another board leak in.
 */
export function useBoardPeers(boardId: string | null): PeerPresence[] {
  const peers = usePresenceStore((state) => state.peers);
  return useMemo(
    () => Object.values(peers).filter((peer) => peer.board === boardId),
    [peers, boardId],
  );
}
