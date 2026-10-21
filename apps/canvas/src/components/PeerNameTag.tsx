import type { PresenceUser } from "../collab/presence";

export interface PeerNameTagProps {
  user: PresenceUser;
  className?: string;
}

/** Compact label attached to the thing a peer is actively manipulating. */
export function PeerNameTag({ user, className = "" }: PeerNameTagProps) {
  return (
    <span
      data-testid="peer-name-tag"
      className={`peer-name-tag max-w-28 truncate ${className}`}
      style={{ backgroundColor: user.color }}
    >
      {user.name}
    </span>
  );
}
