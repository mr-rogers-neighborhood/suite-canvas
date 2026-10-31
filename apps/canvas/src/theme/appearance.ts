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
/** What the reader's page is printed on, which is not the app's theme. */
export type ReadingTheme = "app" | "sepia" | "dim";
/** How wide a column of prose is: 56, 68 or 80 characters. */
export type ReadingMeasure = "narrow" | "standard" | "wide";

/**
 * How a book reads on this screen.
 *
 * Separate from the four canvas knobs because it is a separate act: a reader at midnight wants a dim page at 17px
 * without their boards turning sepia. Still a device preference, for the same reason — the size somebody needs is
 * about their eyes, not about the document.
 */
export interface ReadingAppearance {
  /** Body text in pixels. */
  size: number;
  measure: ReadingMeasure;
  theme: ReadingTheme;
}

export interface Appearance {
  density: Density;
  /** Card corner rounding in pixels; the document's own radius still wins per card. */
  radius: number;
  canvasBackground: CanvasBackground;
  motion: MotionPreference;
  reading: ReadingAppearance;
}

/** The sizes the reader offers, in the order the panel shows them. */
export const READING_SIZES = [
  { value: 12, label: "Small" },
  { value: 13, label: "Standard" },
  { value: 15, label: "Large" },
  { value: 17, label: "Larger" },
] as const;

export const READING_MEASURES: readonly { value: ReadingMeasure; label: string; ch: number }[] = [
  { value: "narrow", label: "Narrow", ch: 56 },
  { value: "standard", label: "Standard", ch: 68 },
  { value: "wide", label: "Wide", ch: 80 },
];

export const READING_THEMES: readonly { value: ReadingTheme; label: string }[] = [
  { value: "app", label: "The app's" },
  { value: "sepia", label: "Sepia" },
  { value: "dim", label: "Dim" },
];

export const APPEARANCE_STORAGE_KEY = "suite.appearance";

export const DEFAULT_APPEARANCE: Appearance = {
  density: "comfortable",
  radius: 12,
  canvasBackground: "dots",
  motion: "full",
  reading: { size: 13, measure: "standard", theme: "app" },
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
    reading: readReading(record.reading),
  };
}

/** A partial or hand-edited reading record falls back field by field, like the rest of the appearance. */
function readReading(value: unknown): ReadingAppearance {
  const record =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  const sizes = READING_SIZES.map((entry) => entry.value);
  const smallest = sizes[0] ?? 12;
  const largest = sizes[sizes.length - 1] ?? 17;
  const size =
    typeof record.size === "number" && Number.isFinite(record.size)
      ? Math.min(largest, Math.max(smallest, Math.round(record.size)))
      : DEFAULT_APPEARANCE.reading.size;
  return {
    size,
    measure: oneOf(
      record.measure,
      ["narrow", "standard", "wide"] as const,
      DEFAULT_APPEARANCE.reading.measure,
    ),
    theme: oneOf(record.theme, ["app", "sepia", "dim"] as const, DEFAULT_APPEARANCE.reading.theme),
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
  // The reading group is published as its own attributes, so a book's page can change without the boards changing.
  root.dataset.reading = appearance.reading.theme;
  root.style.setProperty("--reader-size", `${appearance.reading.size}px`);
  const measure = READING_MEASURES.find((entry) => entry.value === appearance.reading.measure);
  root.style.setProperty("--reader-measure", `${measure?.ch ?? 68}ch`);
}
