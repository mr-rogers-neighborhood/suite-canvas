import type { PresenceUser } from "../collab/presence";

export interface PresenceCursorProps {
  user: PresenceUser;
  x: number;
  y: number;
  /** Counter-scale so the cursor keeps a constant size while zooming. */
  scale?: number;
  /** The pointer is morphing away into the element's name chip. */
  leaving?: boolean;
}

export function PresenceCursor({ user, x, y, scale = 1, leaving = false }: PresenceCursorProps) {
  return (
    <div
      data-testid="peer-cursor"
      data-leaving={leaving ? "true" : undefined}
      className="pointer-events-none absolute left-0 top-0 z-50"
      style={{
        transform: `translate(${x}px, ${y}px) scale(${scale})`,
        transformOrigin: "0 0",
        transition: "transform 80ms linear",
      }}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 16 16"
        className="presence-cursor-arrow -ml-1 -mt-0.5 drop-shadow-md"
      >
        <title>{user.name}</title>
        <path fill={user.color} stroke="white" strokeWidth="1.2" d="M3 1.5l9.5 6.2-4.8.6L5 13z" />
      </svg>
      <span
        className="presence-cursor-label ml-4 inline-block rounded-md px-2 py-0.5 text-xs font-medium text-white shadow-sm"
        style={{ backgroundColor: user.color }}
      >
        {user.name}
      </span>
    </div>
  );
}
