import type { Card, CardType, Tag } from "@suite/graph";
import { formatPropertyValue } from "@suite/graph";

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

/**
 * A compact, read-only projection for the card face: every non-empty scalar
 * property of the primary type, plus tag names. The inspector owns editing; the
 * card shows this only when its frontmatter is expanded.
 */
export function cardMeta(
  card: Card,
  types: Map<string, CardType>,
  tags: Map<string, Tag>,
  limit = Number.POSITIVE_INFINITY,
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
    const formatted = formatPropertyValue(field, value, { includeCard: false, empty: "" });
    if (!formatted) continue;
    properties.push({ fieldId: field.id, label: field.name, value: formatted });
  }
  return properties.length === 0 && tagNames.length === 0 ? EMPTY : { properties, tags: tagNames };
}
