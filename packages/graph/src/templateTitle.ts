import { formatPropertyValue } from "./property.js";
import type { Card, CardType } from "./schema.js";

/**
 * Title tokens for a type template.
 *
 * A template card's title is copied to a new card as rich text, so mentions and
 * formatting survive. On top of that, a *plain* title may carry `{{Field Name}}`
 * tokens, which are filled from the new card's own values once, at creation.
 *
 * They expand once and never again: `displayTitle` stays a plain string, so
 * search, board tabs, mentions and shares keep reading a title the way they
 * always have. A live title view would have to teach all of them to render rich
 * text, which is a far larger change than the feature is worth.
 */

/**
 * `{{Field Name}}`. The name must hold a non-space character, so `{{ }}` stays
 * literal text rather than becoming a nameless token.
 */
const TOKEN = /\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g;

/** Value text per lower-cased field name, for the card's own types. */
export function titleTemplateValues(
  card: Pick<Card, "properties" | "typeIds">,
  types: readonly CardType[],
): Map<string, string> {
  const values = new Map<string, string>();
  for (const typeId of card.typeIds) {
    const type = types.find((candidate) => candidate.id === typeId);
    if (!type) continue;
    for (const field of type.fields) {
      const key = field.name.trim().toLocaleLowerCase();
      if (!key || values.has(key)) continue;
      values.set(key, formatPropertyValue(field, card.properties[field.id], { empty: "" }));
    }
  }
  return values;
}

/**
 * Expands the tokens this card knows about. An unknown token is left in place
 * rather than blanked: a typo should be visible in the new card's title, not
 * silently produce an empty one.
 */
export function expandTitleTemplate(text: string, values: ReadonlyMap<string, string>): string {
  if (!text.includes("{{")) return text;
  return text.replace(TOKEN, (match, rawName: string) => {
    const key = rawName.trim().toLocaleLowerCase();
    return values.get(key) ?? match;
  });
}

/** Whether a title carries any token at all, so the caller can skip the work. */
export function hasTitleToken(text: string): boolean {
  return /\{\{\s*[^{}\s][^{}]*?\s*\}\}/.test(text);
}
