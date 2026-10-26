import type { SectionColor } from "@suite/graph";

/**
 * The section palette, in one place. A section's wash, its outline and a colour
 * swatch in the container panel all read these tokens, so "blue" means one blue.
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
