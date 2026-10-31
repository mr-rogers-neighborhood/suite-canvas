import type { Card, SavedView, viewKindOf, WorkspaceDocument } from "@suite/graph";

/** Stable id, so the renderer and the library recognise a view card. */
export const VIEW_TYPE_ID = "view";

export const VIEW_TYPE_NAME = "View";
export const VIEW_TYPE_PLURAL = "Views";

/**
 * The field holding the view a card presents.
 *
 * The id is fixed rather than generated because the card has to be recognisable from
 * its property values alone: a reader who renames the field should not break every view
 * card in the workspace.
 */
export const VIEW_CARD_FIELD_ID = "view-of";
export const VIEW_CARD_FIELD_NAME = "View";

/**
 * The view type, created on demand.
 *
 * A view card is a *reference*. The query lives in the saved view, so several cards can
 * present the same query and editing the view updates all of them; a card that carried
 * its own query would be a second definition that could drift.
 */
export function ensureViewType(workspace: WorkspaceDocument) {
  const existing = workspace.getType(VIEW_TYPE_ID);
  if (existing) return existing;
  const type = workspace.createType({
    id: VIEW_TYPE_ID,
    name: VIEW_TYPE_NAME,
    pluralName: VIEW_TYPE_PLURAL,
    glyph: "\u25a6",
  });
  workspace.addField(VIEW_TYPE_ID, { name: VIEW_CARD_FIELD_NAME, kind: "text" });
  return workspace.getType(VIEW_TYPE_ID) ?? type;
}

/** Whether a card presents a view. */
export function isViewCard(card: Card): boolean {
  return card.primaryTypeId === VIEW_TYPE_ID || card.typeIds.includes(VIEW_TYPE_ID);
}

/** The saved view a card presents, or null when it names none. */
export function viewIdOf(card: Card, workspace?: WorkspaceDocument): string | null {
  const direct = card.properties[VIEW_CARD_FIELD_ID];
  if (typeof direct === "string" && direct.length > 0) return direct;
  if (workspace === undefined) return null;
  // A reader who renamed the field keeps their cards working: the value is still the
  // only string naming a view, so the field's own id is not the only way to find it.
  const type = workspace.getType(VIEW_TYPE_ID);
  for (const field of type?.fields ?? []) {
    const value = card.properties[field.id];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/** One row of the caption under a view figure. */
export interface ViewSummary {
  readonly name: string;
  readonly kind: ReturnType<typeof viewKindOf>;
  /** Matches in the current document, which is what the caption counts. */
  readonly count: number;
}

export function savedViewName(view: SavedView | undefined): string {
  return view?.name ?? "Untitled view";
}
