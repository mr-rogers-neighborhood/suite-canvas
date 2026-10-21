import type { PresenceUser } from "../collab/presence";

export interface PresenceAvatarsProps {
  users: PresenceUser[];
  max?: number;
}

export function PresenceAvatars({ users, max = 4 }: PresenceAvatarsProps) {
  if (users.length === 0) return null;

  // Two peers can share a generated identity; one avatar per identity is enough.
  const unique = users.filter(
    (user, index) =>
      users.findIndex((other) => other.name === user.name && other.color === user.color) === index,
  );

  return (
    <div className="flex -space-x-1.5">
      {unique.slice(0, max).map((user) => (
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
