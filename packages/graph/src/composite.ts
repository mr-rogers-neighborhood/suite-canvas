import type { FieldDefinition, PropertyValue, SubField, SubFieldKind } from "./schema.js";

/**
 * Helpers for composing field kinds — `rating`, `group` and `list`
 * ([ADR-0057](../../../docs/decisions/0057-fields-can-compose.md)).
 *
 * The rules live here rather than in the writer so every surface agrees: the
 * Loro writer validates with `compositeValueError`, the publish validator
 * returns the same message, and the inspector reads the same sub-fields. The
 * module is deliberately Loro-free — storage shapes belong to
 * `loro/WorkspaceDocument.ts`.
 */

/**
 * Depth, in nested containers, that a composite value may reach. One level of
 * nesting is the Alpha rule (§4): a `list` may hold a `group` of scalars, and a
 * `group` may hold only scalars — so at most two containers on the way down.
 */
export const MAX_COMPOSITE_DEPTH = 2;

/** The one sub-field id a scalar `list` uses to describe its item. */
export const LIST_ITEM_SUB_FIELD_ID = "item";

/**
 * A reserved key a stored group always carries, so the value is readable as a
 * group even after its field (or type) is removed: a dormant value revives,
 * exactly like a dormant scalar ([ADR-0016](../../../docs/decisions/0016-semantic-core.md) §6).
 * Sub-field ids are generated ids, so they can never collide with it.
 */
export const GROUP_VALUE_TAG = "@suite:group";

/** The default rating scale when a field does not declare one. */
export const DEFAULT_RATING_SCALE = 5;

/** A rating's declared scale top (1–20), falling back to five marks. */
export function ratingScale(field: FieldDefinition | undefined): number {
  const scale = field?.rating?.scale;
  return typeof scale === "number" && Number.isFinite(scale) && scale >= 1
    ? Math.floor(scale)
    : DEFAULT_RATING_SCALE;
}

/** Whether a rating accepts half marks. */
export function ratingAllowsHalf(field: FieldDefinition | undefined): boolean {
  return field?.rating?.half === true;
}

/** A group's members, or a list-of-groups' item members, in declared order. */
export function fieldSubFields(field: FieldDefinition | undefined): SubField[] {
  const subFields = field?.subFields ?? [];
  return [...subFields].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  );
}

/** What a `list` repeats. A field with no declared `itemKind` is a scalar list. */
export function listItemKind(field: FieldDefinition | undefined): "scalar" | "group" {
  return field?.itemKind === "group" ? "group" : "scalar";
}

/**
 * The sub-field that describes a scalar list's item. A list of groups has no
 * single item sub-field; callers read `fieldSubFields` for its members instead.
 */
export function scalarItemSubField(field: FieldDefinition | undefined): SubField | undefined {
  return fieldSubFields(field)[0];
}

/** A plain record of values — not an array, not `null`. */
export function isValueRecord(value: unknown): value is Record<string, PropertyValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A value with no structure: what a sub-field may hold. */
export function isScalarValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/**
 * How deep a stored value nests: 0 for a scalar, 1 for a record or array of
 * scalars, 2 for anything deeper. Used by tests and by the depth rule.
 */
export function valueDepth(value: PropertyValue | undefined): number {
  if (value === undefined || isScalarValue(value)) return 0;
  const children = Array.isArray(value) ? value : Object.values(value);
  let deepest = 0;
  for (const child of children) deepest = Math.max(deepest, valueDepth(child));
  return deepest + 1;
}

/** Structural equality for stored JSON, so a writer can skip unchanged slots. */
export function storedEquals(left: unknown, right: PropertyValue): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false;
    return left.every((entry, index) => {
      const other = right[index];
      return other !== undefined && storedEquals(entry, other);
    });
  }
  if (isValueRecord(left) && isValueRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key, index) => {
      if (key !== rightKeys[index]) return false;
      const other = right[key];
      return other !== undefined && storedEquals(left[key], other);
    });
  }
  return false;
}

/**
 * Why a value cannot be stored on this field, or `null` when it can. Only the
 * composing kinds are handled here; the writer keeps the scalar kinds' own
 * rules. Messages are the sentences a caller may surface verbatim.
 */
export function compositeValueError(field: FieldDefinition, value: PropertyValue): string | null {
  const fail = (expected: string): string => `Field "${field.name}" expects ${expected}`;
  switch (field.kind) {
    case "rating":
      return ratingError(field, value, fail);
    case "group":
      return groupError(field, value, fail);
    case "list":
      return listError(field, value, fail);
    default:
      return null;
  }
}

function ratingError(
  field: FieldDefinition,
  value: PropertyValue,
  fail: (expected: string) => string,
): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return fail("a number");
  const scale = ratingScale(field);
  if (value < 0 || value > scale) return fail(`a number between 0 and ${scale}`);
  if (!ratingAllowsHalf(field) && !Number.isInteger(value)) {
    return fail(`a whole number between 0 and ${scale}`);
  }
  return null;
}

function groupError(
  field: FieldDefinition,
  value: PropertyValue,
  fail: (expected: string) => string,
): string | null {
  if (!isValueRecord(value)) return fail("an object keyed by its sub-fields");
  const declared = new Map(fieldSubFields(field).map((sub) => [sub.id, sub]));
  for (const [key, entry] of Object.entries(value)) {
    const sub = declared.get(key);
    if (!sub) return fail(`only its declared sub-fields; "${key}" is not one of them`);
    const error = subValueError(sub, entry, fail);
    if (error) return error;
  }
  // Missing members are allowed: a group may be incomplete (§9).
  return null;
}

function listError(
  field: FieldDefinition,
  value: PropertyValue,
  fail: (expected: string) => string,
): string | null {
  if (!Array.isArray(value)) return fail("a list of items");
  if (listItemKind(field) === "scalar") {
    const item = scalarItemSubField(field);
    if (!item) return fail("a declared item kind");
    for (const entry of value) {
      const error = subValueError(item, entry, fail);
      if (error) return error;
    }
    return null;
  }
  const members = fieldSubFields(field);
  if (members.length === 0) return fail("a declared item shape");
  for (const entry of value) {
    if (!isValueRecord(entry)) {
      return fail(`each item to be a group of ${members.map((sub) => sub.name).join(", ")}`);
    }
    for (const [key, subValue] of Object.entries(entry)) {
      const sub = members.find((candidate) => candidate.id === key);
      if (!sub) return fail(`only its declared sub-fields; "${key}" is not one of them`);
      const error = subValueError(sub, subValue, fail);
      if (error) return error;
    }
  }
  return null;
}

/**
 * One sub-value against its declared sub-field. A nested record or array is
 * refused with the depth rule rather than with a type complaint, because that is
 * the mistake a caller actually made.
 */
function subValueError(
  sub: SubField,
  value: PropertyValue,
  fail: (expected: string) => string,
): string | null {
  const label = `sub-field "${sub.name}" (${sub.kind})`;
  if (!isScalarValue(value)) {
    return fail(
      `${label} to be ${expectedFor(sub.kind)}, not a nested value — a composite nests one level`,
    );
  }
  switch (sub.kind) {
    case "text":
    case "card":
      return typeof value === "string" ? null : fail(`${label} to be ${expectedFor(sub.kind)}`);
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : fail(`${label} to be ${expectedFor(sub.kind)}`);
    case "checkbox":
      return typeof value === "boolean" ? null : fail(`${label} to be ${expectedFor(sub.kind)}`);
    case "date":
      return typeof value === "string" && isCalendarDateLike(value)
        ? null
        : fail(`${label} to be ${expectedFor(sub.kind)}`);
    case "rating": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return fail(`${label} to be ${expectedFor(sub.kind)}`);
      }
      // A sub-field carries no presentation, so it uses the default scale and
      // half marks stay available: the mark count is a property of the value.
      if (value < 0 || value > DEFAULT_RATING_SCALE) {
        return fail(`${label} to be ${expectedFor(sub.kind)}`);
      }
      return null;
    }
    default:
      return fail(`${label} to be a scalar`);
  }
}

function expectedFor(kind: SubFieldKind | FieldDefinition["kind"]): string {
  switch (kind) {
    case "text":
      return "a string";
    case "number":
      return "a finite number";
    case "date":
      return "a date (YYYY-MM-DD)";
    case "checkbox":
      return "a boolean";
    case "card":
      return "a card id";
    case "rating":
      return `a number between 0 and ${DEFAULT_RATING_SCALE}`;
    default:
      return "a scalar";
  }
}

/**
 * `YYYY-MM-DD` and a real calendar day. Kept local rather than imported from
 * `property.ts` so this module never depends on the formatter — the formatter
 * depends on it.
 */
function isCalendarDateLike(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Whether one sub-value counts as unanswered. A composite is incomplete rather
 * than invalid (§9), so this feeds the completeness dot instead of validation.
 */
export function subValueIsEmpty(sub: SubField, value: PropertyValue | undefined): boolean {
  if (value === undefined) return true;
  switch (sub.kind) {
    case "text":
    case "date":
    case "card":
      return typeof value !== "string" || value.trim().length === 0;
    case "number":
    case "rating":
      return !(typeof value === "number" && Number.isFinite(value));
    case "checkbox":
      return value !== true;
    default:
      return false;
  }
}

/** How many of a group's declared members carry a value. */
export function groupFilledCount(
  field: FieldDefinition | undefined,
  value: PropertyValue | undefined,
): number {
  if (!isValueRecord(value)) return 0;
  return fieldSubFields(field).filter((sub) => !subValueIsEmpty(sub, value[sub.id])).length;
}

/**
 * The read-only reading of a composite value, for a chip, a database cell and a
 * canvas summary. A view counts rather than edits composite fields
 * ([ADR-0057](../../../docs/decisions/0057-fields-can-compose.md)), so a group
 * reads as how much of it is filled and a list as how many items it holds;
 * editing happens in the inspector.
 */
export function compositeSummary(field: FieldDefinition, value: PropertyValue | undefined): string {
  switch (field.kind) {
    case "rating": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "";
      return `${value}/${ratingScale(field)}`;
    }
    case "group": {
      const total = fieldSubFields(field).length;
      const filled = groupFilledCount(field, value);
      return filled === 0 ? "" : `${filled}/${total} filled`;
    }
    case "list": {
      if (!Array.isArray(value)) return "";
      if (value.length === 1) return "1 item";
      return value.length === 0 ? "" : `${value.length} items`;
    }
    default:
      return "";
  }
}
