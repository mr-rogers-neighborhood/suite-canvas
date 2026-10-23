import type { Card } from "@suite/graph";
import { PORTAL_BOARD_FIELD_ID, PORTAL_TYPE_ID } from "@suite/graph";

/** Glyph the built-in portal type is seeded with, used when the type is missing. */
export const PORTAL_GLYPH = "\u25c9";

/**
 * A portal is a card whose primary type is the built-in portal type. The type
 * (not the property) decides how the node paints: a note that somehow carries a
 * board value stays a note, exactly as the canvas treats every other card.
 */
export function isPortalCard(card: Pick<Card, "primaryTypeId"> | null | undefined): boolean {
  return card?.primaryTypeId === PORTAL_TYPE_ID;
}

/** The board a portal opens, or null when the value is missing or not a string. */
export function portalTargetId(
  card: Pick<Card, "properties" | "primaryTypeId"> | null | undefined,
): string | null {
  if (!isPortalCard(card)) return null;
  const value = card?.properties[PORTAL_BOARD_FIELD_ID];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
