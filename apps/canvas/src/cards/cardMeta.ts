import type { Card, CardType, FieldDefinition, PropertyValue, Tag } from "@suite/graph";

export interface CardMetaProperty {
  fieldId: string;
  label: string;
  value: string;
}

export interface CardMeta {
  properties: CardMetaProperty[];
  tags: string[];
}

const EMPTY: CardMeta = { properties: [], tags: [] };

function formatValue(value: PropertyValue, field: FieldDefinition): string | null {
  switch (field.kind) {
    case "checkbox":
      return value === true ? "" : null;
    case "select": {
      if (typeof value !== "string") return null;
      return field.options.find((option) => option.id === value)?.label ?? null;
    }
    case "multiSelect":
      return null;
    case "number":
      return typeof value === "number" ? String(value) : null;
    case "date":
    case "text":
      return typeof value === "string" && value.trim() ? value : null;
  }
}

/**
 * A compact, read-only projection for the card face: the first two non-empty
 * scalar properties of the primary type, plus tag names. The inspector owns
 * editing; this only makes a typed card legible on the canvas.
 */
export function cardMeta(
  card: Card,
  types: Map<string, CardType>,
  tags: Map<string, Tag>,
  limit = 2,
): CardMeta {
  const type = types.get(card.primaryTypeId);
  const tagNames = card.tags.flatMap((id) => {
    const tag = tags.get(id);
    return tag ? [tag.name] : [];
  });
  if (!type) return { properties: [], tags: tagNames };

  const properties: CardMetaProperty[] = [];
  for (const field of type.fields) {
    if (properties.length >= limit) break;
    const value = card.properties[field.id];
    if (value === undefined) continue;
    const formatted = formatValue(value, field);
    if (formatted === null) continue;
    properties.push({
      fieldId: field.id,
      label: field.name,
      value: field.kind === "checkbox" ? field.name : formatted,
    });
  }
  return properties.length === 0 && tagNames.length === 0 ? EMPTY : { properties, tags: tagNames };
}
