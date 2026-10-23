import { z } from "zod";
import { entityIdSchema, sectionColors } from "./schema.js";

/**
 * A pin is a spatial bookmark: a labeled point on one board (ADR-0035).
 *
 * It is navigation metadata, not content. A pin never creates a placement, a
 * card, a reference or a board membership, and its optional `target` is a
 * navigation action, not an anchor: moving the target does not move the pin,
 * and deleting the target leaves the marker where it was dropped.
 *
 * Pins are workspace-shared in v1 and live in the `pins` root map of the same
 * Loro document as everything else, one key per field exactly like sections. A
 * per-user private pin layer would be a second map, never a field here.
 */

/** A pin renders one short line at every LOD, so the label has a hard cap. */
export const PIN_LABEL_MAX_LENGTH = 80;

/** Used when a caller does not pick a marker colour. */
export const DEFAULT_PIN_COLOR = "amber";

/**
 * Marker colours reuse the section swatches, so a pin and a region read as one
 * system instead of two palettes.
 */
export const pinColors = sectionColors;
export const pinColorSchema = z.enum(pinColors);

/** What a pin can navigate to. A target is optional and never creates content. */
export const pinTargetKinds = ["card", "section", "view"] as const;
export const pinTargetKindSchema = z.enum(pinTargetKinds);

export const pinTargetSchema = z.object({
  kind: pinTargetKindSchema,
  /** Soft target: an id whose record may be gone, rendering as unavailable. */
  id: entityIdSchema,
});

export const pinSchema = z.object({
  id: entityIdSchema,
  /** The board the marker sits on; the pin is not drawn on any other board. */
  boardId: entityIdSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  label: z.string().trim().min(1).max(PIN_LABEL_MAX_LENGTH),
  color: pinColorSchema,
  /** Actor id of the creator. Pins are shared, so this is attribution only. */
  createdBy: entityIdSchema,
  createdAt: z.number().int().nonnegative(),
  target: pinTargetSchema.optional(),
});

export type PinColor = z.infer<typeof pinColorSchema>;
export type PinTargetKind = z.infer<typeof pinTargetKindSchema>;
export type PinTarget = z.infer<typeof pinTargetSchema>;
export type Pin = z.infer<typeof pinSchema>;

/**
 * Deterministic read order: creation time, then id. There is no `position`
 * field — a pin's order is the order the places were marked — so every client
 * (and every export) lists them the same way.
 */
export function sortPins(pins: readonly Pin[]): Pin[] {
  return [...pins].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}
