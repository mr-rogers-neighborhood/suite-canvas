import type { Card, CardType, WorkspaceDocument } from "@suite/graph";

/** The built-in type id is stable so the renderer can recognise the card. */
export const WHITEBOARD_TYPE_ID = "whiteboard";

/**
 * Whiteboards are created on demand instead of seeded, so an existing
 * workspace does not grow a new type until someone asks for a drawing.
 */
export function ensureWhiteboardType(workspace: WorkspaceDocument): CardType {
  const existing = workspace.getType(WHITEBOARD_TYPE_ID);
  if (existing) return existing;
  return workspace.createType({
    id: WHITEBOARD_TYPE_ID,
    name: "Whiteboard",
    pluralName: "Whiteboards",
    glyph: "\u25a7",
  });
}

export function isWhiteboardCard(card: Pick<Card, "primaryTypeId"> | undefined): boolean {
  return card?.primaryTypeId === WHITEBOARD_TYPE_ID;
}
