import type { PresenceUser } from "../collab/presence";

export interface PeerNameTagProps {
  user: PresenceUser;
  /** Extra context, e.g. how many cards a multi-drag is moving. */
  detail?: string | undefined;
  className?: string;
}

/** `#rgb` / `#rrggbb` to channels; anything else is left to the caller. */
function parseHex(color: string): [number, number, number] | null {
  const hex = color.trim().replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((char) => char + char)
          .join("")
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((start) => Number.parseInt(full.slice(start, start + 2), 16)) as [
    number,
    number,
    number,
  ];
}

/**
 * Presence colours are picked by people, so a chip cannot assume white ink:
 * pick the side of the chip that clears 4.5:1 on whatever colour it was given.
 */
export function presenceChipInk(color: string): string {
  const rgb = parseHex(color);
  if (!rgb) return "#ffffff";
  const linear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = rgb;
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  // 0.179 is where black and white text swap places for a 4.5:1 target.
  return luminance > 0.179 ? "#1d1d1f" : "#ffffff";
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
