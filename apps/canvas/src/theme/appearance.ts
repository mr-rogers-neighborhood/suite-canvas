/**
 * Reader appearance preferences (ADR-0071).
 *
 * These four knobs are the *only* styling a reader owns alone, and they are device
 * preferences rather than document data: density and canvas treatment change how this
 * screen draws, never what a collaborator sees. Everything else a card can wear is a
 * utility written through the graph, where the rungs decide who wins.
 *
 * They are applied as attributes on `<html>`, so a change is one repaint and the CSS
 * owns the consequence — the same shape as the theme, and the reason the preview is
 * live without a render of the canvas.
 */
export type Density = "comfortable" | "compact";
export type CanvasBackground = "plain" | "dots";
export type MotionPreference = "full" | "reduced";

export interface Appearance {
  density: Density;
  /** Card corner rounding in pixels; the document's own radius still wins per card. */
  radius: number;
  canvasBackground: CanvasBackground;
  motion: MotionPreference;
}

export const APPEARANCE_STORAGE_KEY = "suite.appearance";

export const DEFAULT_APPEARANCE: Appearance = {
  density: "comfortable",
  radius: 12,
  canvasBackground: "dots",
  motion: "full",
};

/** The range the radius control offers. Wide enough to see, narrow enough to stay a card. */
export const RADIUS_RANGE = { min: 0, max: 28, step: 1 } as const;

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Read a stored preference, tolerating a partial or hand-edited record.
 *
 * A missing field falls back rather than failing the whole record: a reader who once had
 * a build without `motion` should keep their density.
 */
export function readStoredAppearance(storage: Pick<Storage, "getItem"> | undefined): Appearance {
  const raw = storage?.getItem(APPEARANCE_STORAGE_KEY);
  if (raw === null || raw === undefined) return DEFAULT_APPEARANCE;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A corrupt value is a reason to start from the defaults, not to fail boot.
    return DEFAULT_APPEARANCE;
  }
  if (typeof parsed !== "object" || parsed === null) return DEFAULT_APPEARANCE;
  const record = parsed as Record<string, unknown>;
  const radius =
    typeof record.radius === "number" && Number.isFinite(record.radius)
      ? Math.min(RADIUS_RANGE.max, Math.max(RADIUS_RANGE.min, Math.round(record.radius)))
      : DEFAULT_APPEARANCE.radius;
  return {
    density: oneOf(record.density, ["comfortable", "compact"] as const, DEFAULT_APPEARANCE.density),
    radius,
    canvasBackground: oneOf(
      record.canvasBackground,
      ["plain", "dots"] as const,
      DEFAULT_APPEARANCE.canvasBackground,
    ),
    motion: oneOf(record.motion, ["full", "reduced"] as const, DEFAULT_APPEARANCE.motion),
  };
}

/**
 * Paint the preferences onto the document root.
 *
 * Attributes rather than inline styles: the stylesheet decides what compact means, and a
 * test can assert the decision reached the root without measuring pixels.
 */
export function applyAppearance(appearance: Appearance, root: HTMLElement): void {
  root.dataset.density = appearance.density;
  root.dataset.canvas = appearance.canvasBackground;
  root.dataset.motion = appearance.motion;
  root.style.setProperty("--reader-card-radius", `${appearance.radius}px`);
}
