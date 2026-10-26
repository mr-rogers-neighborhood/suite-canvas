import type { FieldKind, PropertyValue, SelectOption } from "@suite/graph";
import { describeValue } from "./frontmatter.js";

/**
 * Owns what happens to a frontmatter key: a value written to a field the
 * workspace already defines, or text kept at the end of the card body.
 *
 * There is no third outcome. A key the importer cannot place is kept, because a
 * property someone wrote is data, and an export that drops it is a bug.
 */

/** The parts of a field definition the mapping reads. */
export interface PropertyField {
  id: string;
  name: string;
  kind: FieldKind;
  options: readonly SelectOption[];
}

export interface PlannedProperty {
  fieldId: string;
  value: PropertyValue;
}

export interface KeptProperty {
  key: string;
  text: string;
}

export interface PropertyPlan {
  properties: PlannedProperty[];
  kept: KeptProperty[];
  /** Keys a field claimed but whose value did not fit it; each also lands in `kept`. */
  problems: string[];
}

export interface PropertyContext {
  data: Record<string, unknown>;
  keys: readonly string[];
  fields: readonly PropertyField[];
  /** Key to field id, for a key whose name does not match any field. */
  fieldByKey?: Readonly<Record<string, string>> | undefined;
  /** A card id for a wikilink-shaped value, or null. */
  resolveCard?: ((target: string) => string | null) | undefined;
}

/** Keys Obsidian owns, which are never a field even when a field shares the name. */
const RESERVED_KEYS = new Set([
  "tags",
  "tag",
  "aliases",
  "alias",
  "cssclasses",
  "cssclass",
  "type",
]);

function truthy(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const needle = value.trim().toLocaleLowerCase();
    if (["true", "yes", "on", "1", "checked"].includes(needle)) return true;
    if (["false", "no", "off", "0", "unchecked", ""].includes(needle)) return false;
  }
  return null;
}

function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(describeValue).filter((entry) => entry.length > 0);
  const text = describeValue(value);
  return text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function optionIdFor(field: PropertyField, label: string): string | null {
  const needle = label.trim().toLocaleLowerCase();
  const option = field.options.find(
    (entry) =>
      entry.label.toLocaleLowerCase() === needle || entry.id.toLocaleLowerCase() === needle,
  );
  return option?.id ?? null;
}

type Coerced = { ok: true; value: PropertyValue } | { ok: false; reason: string };

/** One value, coerced to the kind of the field that will hold it. */
export function coercePropertyValue(
  field: PropertyField,
  value: unknown,
  resolveCard?: (target: string) => string | null,
): Coerced {
  switch (field.kind) {
    case "text":
    case "date": {
      const text = describeValue(value);
      if (text.length === 0) return { ok: false, reason: "is empty" };
      if (field.kind === "date" && !/^\d{4}-\d{2}-\d{2}/u.test(text)) {
        return { ok: false, reason: "is not a date" };
      }
      return { ok: true, value: text };
    }
    case "number":
    case "rating": {
      const number = typeof value === "number" ? value : Number(describeValue(value));
      if (!Number.isFinite(number)) return { ok: false, reason: "is not a number" };
      if (field.kind === "rating" && number < 0) return { ok: false, reason: "is below zero" };
      return { ok: true, value: number };
    }
    case "checkbox": {
      const flag = truthy(value);
      return flag === null ? { ok: false, reason: "is not a checkbox" } : { ok: true, value: flag };
    }
    case "select": {
      const id = optionIdFor(field, describeValue(value));
      return id ? { ok: true, value: id } : { ok: false, reason: "names no option" };
    }
    case "multiSelect": {
      const labels = asList(value);
      if (labels.length === 0) return { ok: false, reason: "is empty" };
      const ids: string[] = [];
      for (const label of labels) {
        const id = optionIdFor(field, label);
        if (!id) return { ok: false, reason: `names no option (${label})` };
        ids.push(id);
      }
      return { ok: true, value: ids };
    }
    case "card": {
      const text =
        describeValue(value)
          .replace(/^\[\[|\]\]$/gu, "")
          .split("|")[0] ?? "";
      const cardId = resolveCard?.(text.trim()) ?? null;
      return cardId
        ? { ok: true, value: cardId }
        : { ok: false, reason: "names a note this vault does not have" };
    }
    case "board":
      return { ok: false, reason: "is a board reference, which needs a board name" };
    case "group":
    case "list":
      return { ok: false, reason: "is a composite field, which an import does not build" };
    default:
      return { ok: false, reason: "is a kind this import does not map" };
  }
}

function fieldFor(
  key: string,
  fields: readonly PropertyField[],
  fieldByKey: Readonly<Record<string, string>> | undefined,
): PropertyField | undefined {
  const explicit = fieldByKey?.[key];
  if (explicit) return fields.find((field) => field.id === explicit);
  const needle = key.trim().toLocaleLowerCase();
  return fields.find((field) => field.name.trim().toLocaleLowerCase() === needle);
}

/** How every frontmatter key is placed, and what happens to the ones with no field. */
export function planProperties(context: PropertyContext): PropertyPlan {
  const plan: PropertyPlan = { properties: [], kept: [], problems: [] };
  for (const key of context.keys) {
    const name = key.trim();
    if (name.length === 0) continue;
    if (RESERVED_KEYS.has(name.toLocaleLowerCase())) continue;
    const value = context.data[key];
    const field = fieldFor(name, context.fields, context.fieldByKey);
    if (!field) {
      const text = describeValue(value);
      if (text.length > 0) plan.kept.push({ key: name, text });
      continue;
    }
    const coerced = coercePropertyValue(field, value, context.resolveCard);
    if (coerced.ok) {
      plan.properties.push({ fieldId: field.id, value: coerced.value });
      continue;
    }
    const text = describeValue(value);
    plan.problems.push(`"${name}" ${coerced.reason}, so it was kept as text`);
    if (text.length > 0) plan.kept.push({ key: name, text });
  }
  return plan;
}

/** The paragraphs kept keys are written as, so the card still shows them. */
export function keptPropertyLines(kept: readonly KeptProperty[]): string[] {
  return kept.map((entry) => `${entry.key}: ${entry.text}`);
}
