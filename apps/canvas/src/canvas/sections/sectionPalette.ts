import type { PaletteSwatch, SectionColor } from "@suite/graph";

/**
 * The section colours, in one place.
 *
 * A section's `color` is a palette id like a card's `style.swatch` or a link's, so this module
 * resolves it through the workspace palette and only falls back to the shipped tokens below. The
 * six are the ids `DEFAULT_PALETTE` ships, which is why the tables stay exhaustive: "blue" means
 * one blue whether a frame or a card wears it.
 */
export const SECTION_FILL: Record<SectionColor, string> = {
  slate: "color-mix(in srgb, var(--section-slate) 9%, transparent)",
  blue: "color-mix(in srgb, var(--section-blue) 10%, transparent)",
  green: "color-mix(in srgb, var(--section-green) 10%, transparent)",
  amber: "color-mix(in srgb, var(--section-amber) 11%, transparent)",
  rose: "color-mix(in srgb, var(--section-rose) 10%, transparent)",
  violet: "color-mix(in srgb, var(--section-violet) 10%, transparent)",
};

export const SECTION_STROKE: Record<SectionColor, string> = {
  slate: "var(--section-slate)",
  blue: "var(--section-blue)",
  green: "var(--section-green)",
  amber: "var(--section-amber)",
  rose: "var(--section-rose)",
  violet: "var(--section-violet)",
};

/** The screen a colour is resolved for; a swatch carries one value per mode. */
export type PaintMode = "light" | "dark";

/** A frame's outline, and the wash it is filled with. */
export interface SectionSwatch {
  stroke: string;
  fill: string;
}

/** The theme's own section colour: what a frame with no colour, or an unknown one, wears. */
export const SECTION_DEFAULT: SectionSwatch = {
  stroke: SECTION_STROKE.slate,
  fill: SECTION_FILL.slate,
};

/** The frame's wash: the colour, thinned so a section stays a hint rather than a slab. */
export function sectionWash(colour: string, percent = 10): string {
  return `color-mix(in srgb, ${colour} ${percent}%, transparent)`;
}

function isShipped(id: string): id is SectionColor {
  return Object.hasOwn(SECTION_STROKE, id);
}

/**
 * The swatch a section wears, for the mode on screen.
 *
 * The palette wins, then the shipped token whose id this is, then the theme's own section colour —
 * a frame that never picked a colour, or names one the palette no longer holds, keeps a colour
 * rather than vanishing or borrowing a neighbour's. Every reader goes through here, so editing the
 * workspace palette repaints frames and cards together.
 */
export function sectionSwatch(
  color: string | undefined,
  palette: readonly PaletteSwatch[],
  mode: PaintMode,
): SectionSwatch {
  if (color === undefined) return SECTION_DEFAULT;
  const entry = palette.find((swatch) => swatch.id === color);
  if (entry !== undefined) {
    const stroke = mode === "dark" ? entry.dark : entry.light;
    return { stroke, fill: sectionWash(stroke) };
  }
  if (isShipped(color)) return { stroke: SECTION_STROKE[color], fill: SECTION_FILL[color] };
  return SECTION_DEFAULT;
}
