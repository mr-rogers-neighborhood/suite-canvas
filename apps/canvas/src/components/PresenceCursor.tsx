import type { PresenceUser } from "../collab/presence";

export interface PresenceCursorProps {
  user: PresenceUser;
  x: number;
  y: number;
  /** Counter-scale so the cursor keeps a constant size while zooming. */
  scale?: number;
}

export function PresenceCursor({ user, x, y, scale = 1 }: PresenceCursorProps) {
  return (
    <div
      className="pointer-events-none absolute left-0 top-0 z-50"
      style={{
        transform: `translate(${x}px, ${y}px) scale(${scale})`,
        transformOrigin: "0 0",
        transition: "transform 80ms linear",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" className="drop-shadow-sm">
        <title>{user.name}</title>
        <path fill={user.color} stroke="white" strokeWidth="1" d="M3 1.5l9.5 6.2-4.8.6L5 13z" />
      </svg>
      <span
        className="ml-3 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium text-white"
        style={{ backgroundColor: user.color }}
      >
        {user.name}
      </span>
    </div>
  );
}
