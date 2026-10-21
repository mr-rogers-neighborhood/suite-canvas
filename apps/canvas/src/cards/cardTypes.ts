import type { CardType } from "@suite/graph";

/**
 * Presentation used when a card's type is missing (legacy data, a type deleted
 * by a collaborator, or a document that has not hydrated yet). It never
 * replaces the stored primary id; the picker can repair it.
 */
export const FALLBACK_CARD_TYPE: CardType = {
  id: "note",
  name: "Note",
  glyph: "\u25a1",
  createdAt: 0,
  updatedAt: 0,
  fields: [],
};

export function typesById(types: CardType[]): Map<string, CardType> {
  return new Map(types.map((type) => [type.id, type]));
}

export function resolveCardType(types: Map<string, CardType>, primaryTypeId: string): CardType {
  return types.get(primaryTypeId) ?? FALLBACK_CARD_TYPE;
}
