import type { CSSProperties } from "react";
import { useIconBody } from "./iconSets";

export interface IconGlyphProps {
  /** An icon reference ("lucide:check"), or nothing. */
  icon: string | null | undefined;
  size?: number;
  /** A CSS colour; absent inherits the text colour. */
  color?: string;
  /** An accessible name. Absent keeps the icon decorative. */
  title?: string;
  className?: string;
}

/**
 * One icon, drawn from the bundled sets.
 *
 * Absent, unresolved or unreadable is **nothing** rather than a placeholder: a
 * broken box is worse than no icon, and an icon whose set has not loaded yet
 * appears a frame later without the layout moving greedily around it. Callers
 * that have a glyph to fall back to pass it themselves.
 */
export function IconGlyph({ icon, size = 14, color, title, className }: IconGlyphProps) {
  // Reactive rather than a bare read: the set arrives asynchronously, and a glyph that
  // only read the cache drew nothing on the load after the one that picked the icon.
  const body = useIconBody(icon);
  if (body === null) return null;

  const style: CSSProperties = {
    width: size,
    height: size,
    color: color ?? "currentColor",
    flex: "none",
    display: "block",
  };
  return (
    // The body is the icon set's own markup, which is the only way to draw an
    // arbitrary Iconify icon without a component per icon. It comes from a
    // checked-in dependency, never from the document or the network.
    <svg
      {...(title === undefined
        ? { "aria-hidden": true as const }
        : { role: "img", "aria-label": title })}
      viewBox={`0 0 ${body.width} ${body.height}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the set's own markup, from a pinned dependency
      dangerouslySetInnerHTML={{ __html: body.body }}
      style={style}
      className={className}
      data-icon={icon ?? undefined}
    />
  );
}
