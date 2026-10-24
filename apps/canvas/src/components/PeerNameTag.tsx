import { type PresenceUser, presenceChipInk } from "../collab/presence";

export { presenceChipInk };

export interface PeerNameTagProps {
  user: PresenceUser;
  /** Extra context, e.g. how many cards a multi-drag is moving. */
  detail?: string | undefined;
  className?: string;
}

/** Compact label attached to the thing a peer is actively manipulating. */
export function PeerNameTag({ user, detail, className = "" }: PeerNameTagProps) {
  return (
    <span
      data-testid="peer-name-tag"
      className={`peer-name-tag max-w-28 truncate ${className}`}
      style={{ backgroundColor: user.color, color: presenceChipInk(user.color) }}
    >
      {user.name}
      {detail ? <span className="opacity-75"> · {detail}</span> : null}
    </span>
  );
}
