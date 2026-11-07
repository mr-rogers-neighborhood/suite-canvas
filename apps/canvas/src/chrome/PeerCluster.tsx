import { usePresenceStore } from "../collab/usePresenceStore";

/**
 * Who else is in this workspace, beside the sync pill.
 *
 * Presence is live and scoped to the workspace, not to the board: somebody reading a different
 * board is still *here*, and a thinking tool where another person can be in the room without
 * you knowing is worse than one that says so. Cursors already show where a peer is on this
 * board, so a dot is enough for the ones elsewhere.
 */
export interface PeerClusterProps {
  /** The board this window is on, so a peer elsewhere can be said to be elsewhere. */
  boardId: string | null;
}

export function PeerCluster({ boardId }: PeerClusterProps) {
  const peers = usePresenceStore((state) => state.peers);
  const here = Object.values(peers);
  if (here.length === 0) return null;

  const elsewhere = here.filter((peer) => peer.board !== null && peer.board !== boardId);
  const label =
    elsewhere.length === 0
      ? `${here.length} other ${here.length === 1 ? "person" : "people"} here`
      : `${elsewhere.length} ${elsewhere.length === 1 ? "person" : "people"} elsewhere in this workspace`;

  return (
    <div
      data-testid="peer-cluster"
      title={here.map((peer) => peer.user.name).join(", ")}
      className="flex items-center gap-1"
    >
      <div className="flex -space-x-1.5">
        {here.slice(0, 4).map((peer) => (
          <span
            key={peer.clientId}
            data-testid="peer-dot"
            className="flex h-4 w-4 items-center justify-center rounded-full border border-white text-[8px] font-semibold text-white"
            style={{ backgroundColor: peer.user.color }}
            title={`${peer.user.name}${peer.board === boardId ? "" : " — on another board"}`}
          >
            {peer.user.name.charAt(0).toUpperCase()}
          </span>
        ))}
      </div>
      <span className="text-[11px] text-[var(--ink-muted)]">{label}</span>
    </div>
  );
}
