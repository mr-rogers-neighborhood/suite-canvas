import {
  DEFAULT_PALETTE,
  type PaletteSwatch,
  type StyleColourRole,
  type SurfaceStyle,
  swatchColour,
  swatchInk,
} from "@suite/graph";
import { createContext, useContext } from "react";
import {
  type ContrastCorrection,
  readPalette,
  type SurfacePalette,
  type SurfaceSubject,
  type SwatchPaint,
  surfacePaintFor,
} from "./rules";

/**
 * What a surface needs to know to paint: the workspace palette, the live role
 * colours the contrast floor measures against, and which mode is on screen.
 *
 * One context rather than three props, because every painter reads all three and
 * a card that got one wrong would paint the wrong mode's colour.
 */
export interface SurfacePaintContextValue {
  palette: readonly PaletteSwatch[];
  /** Role → the colour the token layer resolves it to right now. */
  roles: SurfacePalette;
  mode: "light" | "dark";
}

export const NO_SURFACE_PAINT: SurfacePaintContextValue = {
  palette: DEFAULT_PALETTE,
  roles: {},
  mode: "light",
};

export const SurfacePaintProvider = createContext<SurfacePaintContextValue>(NO_SURFACE_PAINT);

export function useSurfacePaint(): SurfacePaintContextValue {
  return useContext(SurfacePaintProvider);
}

/**
 * The swatch a style names, resolved for this screen: its colour and the ink that
 * was chosen to read on it.
 *
 * Both come from the palette rather than from the style, because the ink is a
 * property of the colour, not of the thing wearing it. A style that names an ink
 * of its own still wins.
 */
export function swatchOf(
  style: SurfaceStyle | undefined,
  context: SurfacePaintContextValue,
): SwatchPaint | null {
  const colour = swatchColour(context.palette, style?.swatch, context.mode);
  if (colour === null) return null;
  const ink: StyleColourRole = swatchInk(context.palette, style?.swatch, context.mode) ?? "ink";
  return { colour, ink };
}

export interface SurfacePainted {
  paint: Record<string, string>;
  corrections: ContrastCorrection[];
}

/**
 * The paint one surface wears: its type's style, then its own, then the contrast
 * floor. A card passes its type's `style` as `inherited`; a link passes nothing,
 * because a link has no type.
 */
export function paintSurface(
  own: SurfaceStyle | undefined,
  inherited: SurfaceStyle | undefined,
  subject: SurfaceSubject,
  context: SurfacePaintContextValue,
): SurfacePainted {
  const swatch = swatchOf(own, context) ?? swatchOf(inherited, context);
  return surfacePaintFor(own, inherited, subject, context.roles, swatch);
}

/** The palette for a DOM root, read from the tokens the theme just painted. */
export function readLivePalette(root: HTMLElement | null): SurfacePalette {
  return root === null ? {} : readPalette(root);
}
