import type { PresenceUser } from "../collab/presence";

export interface PresenceAvatarsProps {
  users: PresenceUser[];
  max?: number;
}

export function PresenceAvatars({ users, max = 4 }: PresenceAvatarsProps) {
  if (users.length === 0) return null;

  return (
    <div className="flex -space-x-1.5">
      {users.slice(0, max).map((user) => (
        <span
          key={`${user.name}:${user.color}`}
          data-testid="presence-avatar"
          className="flex h-5 w-5 items-center justify-center rounded-full border border-white text-[9px] font-semibold text-white"
          style={{ backgroundColor: user.color }}
          title={user.name}
        >
          {user.name.charAt(0).toUpperCase()}
        </span>
      ))}
    </div>
  );
}
