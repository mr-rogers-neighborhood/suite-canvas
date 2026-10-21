import type { NodeKind } from "@suite/graph";

export interface CardTypeDefinition {
  kind: NodeKind;
  label: string;
  /** Single glyph used in the dock and the card header. */
  glyph: string;
}

/**
 * The one place a card kind is described to the UI. Adding a kind means adding a
 * schema variant, a factory branch, and an entry here.
 */
export const CARD_TYPES: readonly CardTypeDefinition[] = [
  { kind: "note", label: "Note", glyph: "\u25a1" },
];

const NOTE_TYPE: CardTypeDefinition = { kind: "note", label: "Note", glyph: "\u25a1" };

export function cardType(kind: NodeKind): CardTypeDefinition {
  return CARD_TYPES.find((type) => type.kind === kind) ?? NOTE_TYPE;
}
