/**
 * How a Suite card looks on the ICE desk.
 *
 * A card is drawn by the same paper pass as a native note — that is what makes
 * it part of the canvas rather than a DOM panel floating over it: the sheet, its
 * shadow, its greek LOD and its banded text raster all come from the engine. Two
 * things are ours rather than the sticky note's:
 *
 * - the HAND, because a note's law is a marker scrawl (24-unit glyphs, tilted
 *   and wandering) while a card is read, so its type is sized like UI text and
 *   laid perfectly straight;
 * - the PALETTE, because a card is a document surface (the shell's `--surface`
 *   and `--ink`), not a yellow sticky.
 *
 * Nothing here rasterizes the card into a picture: the text stays live, so it is
 * sharp at every zoom and re-rasters only when the zoom crosses a band.
 */

/** The hand's law as the paper kind takes it (`HandLaw` in the desk kit). */
export interface HandLaw {
  readonly size: number;
  readonly lineHeight: number;
  readonly pad: number;
  readonly jitter: {
    readonly rot: number;
    readonly rise: number;
    readonly scale: number;
    readonly press: readonly [number, number];
  };
  readonly wander: { readonly amp: number; readonly period: number };
  readonly wipeMs: number;
}

/**
 * A card's type at rung 1: 13 world units (CSS px at zoom 1, the shell's body
 * size), 1.45 line pitch, 14 units of padding, and no jitter or wander at all —
 * a document reads straight, and the note's hand is what makes text look drawn.
 */
export const SUITE_CARD_HAND: HandLaw = {
  size: 13,
  lineHeight: 1.45,
  pad: 14,
  jitter: { rot: 0, rise: 0, scale: 0, press: [1, 1] },
  wander: { amp: 0, period: 1 },
  wipeMs: 110,
};

/**
 * The hand for a rung: the type and its padding scale with the card, so a
 * bigger card is the same page at a bigger size rather than a bigger page with
 * the same small type. Everything else about the hand is unchanged.
 */
export function handForScale(scale: number): HandLaw {
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    ...SUITE_CARD_HAND,
    size: SUITE_CARD_HAND.size * factor,
    pad: SUITE_CARD_HAND.pad * factor,
  };
}

/**
 * Whether a card also mounts the DOM face on top of its sheet.
 *
 * Off: the sheet IS the card. The engine draws its text at the band the zoom
 * asks for and greeks it far away, so the card is part of the canvas at every
 * distance, with no overlay to pop in or scale against it. On: the read-only
 * `SceneCardView` twin is mounted in the slot instead, which is the older path
 * kept for comparison — it is a second renderer of the same card, so anything
 * that writes must never run from there.
 */
export const SUITE_CARD_DOM_FACE = false;

/** The face key the paper kind asks for by default; ours is the shell's family. */
export const SUITE_FACE = "caveat";

/**
 * The faces the desk writes with.
 *
 * The engine's default hand is Caveat, a third-party file this app does not
 * host, so the desk is given the shell's own family instead: text then reads in
 * the same voice as the rest of Suite, and nothing is fetched from a font CDN to
 * draw it. One family name only — ICE measures the face synchronously, and a
 * family *list* resolves to an unmeasurable stack that leaves every sheet blank.
 */
export const SUITE_PEN_FACES = {
  [SUITE_FACE]: { family: "system-ui", weight: 400 },
  "caveat-bold": { family: "system-ui", weight: 600 },
} as const;

/** Suite's own tokens, read from the document; the light values are the fallback. */
function token(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length === 0 ? fallback : value;
}

interface Ink {
  readonly token: string;
  readonly css: string;
}

interface PaletteLike {
  readonly papers?: Readonly<Record<string, Ink>>;
  readonly pens?: Readonly<Record<string, Ink>>;
}

/**
 * An ICE palette plus the two entries a card needs: a document sheet and its
 * ink. `papers`/`pens` are looked up by the object's `paper`/`pen` prop, so a
 * card names `card` while a note keeps the sticky's `yellow`.
 */
export function suitePalette<P extends PaletteLike>(
  base: P,
): Omit<P, "papers" | "pens"> & {
  readonly papers: Record<string, Ink>;
  readonly pens: Record<string, Ink>;
} {
  const { papers, pens, ...rest } = base;
  return {
    ...rest,
    papers: {
      ...papers,
      card: { token: "--surface", css: token("--surface", "#ffffff") },
    },
    pens: {
      ...pens,
      card: { token: "--ink", css: token("--ink", "#1d1d1f") },
    },
  };
}
