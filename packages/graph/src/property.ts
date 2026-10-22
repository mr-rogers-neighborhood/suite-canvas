import type { FieldDefinition, PropertyValue } from "./schema.js";

/** Everything a value needs besides its field to be publishable. */
export interface PropertyValidationContext {
  /** The card that owns the value; a `card` value may never point at it. */
  cardId?: string | undefined;
  /** Whether a card a `card` value points at exists in the publish target. */
  cardExists?: ((cardId: string) => boolean) | undefined;
}

/** `YYYY-MM-DD` and a real calendar day, not just a string that looks close. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Why a stored value cannot be published, or `null` when it can. A `null` or
 * `undefined` value is a clear and always allowed; `card` targets are only
 * checked when the caller can resolve them, because the target may live
 * outside a shared projection.
 */
export function propertyValueError(
  field: FieldDefinition,
  value: PropertyValue | null | undefined,
  context: PropertyValidationContext = {},
): string | null {
  if (value === null || value === undefined) return null;
  switch (field.kind) {
    case "text":
      return typeof value === "string" ? null : `Field "${field.name}" expects a string`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : `Field "${field.name}" expects a finite number`;
    case "date":
      return typeof value === "string" && isCalendarDate(value)
        ? null
        : `Field "${field.name}" expects a date (YYYY-MM-DD)`;
    case "checkbox":
      return typeof value === "boolean" ? null : `Field "${field.name}" expects a boolean`;
    case "select":
      if (typeof value !== "string") return `Field "${field.name}" expects an option id`;
      return field.options.some((option) => option.id === value)
        ? null
        : `Field "${field.name}" selected an option that no longer exists: "${value}"`;
    case "multiSelect": {
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        return `Field "${field.name}" expects a list of option ids`;
      }
      const unknown = value.find((id) => !field.options.some((option) => option.id === id));
      return unknown === undefined
        ? null
        : `Field "${field.name}" selected an option that no longer exists: "${unknown}"`;
    }
    case "card": {
      if (typeof value !== "string" || value.trim().length === 0) {
        return `Field "${field.name}" expects a card id`;
      }
      if (value === context.cardId) {
        return `Field "${field.name}" cannot point at its own card`;
      }
      if (context.cardExists && !context.cardExists(value)) {
        return `Field "${field.name}" points at a card that does not exist: "${value}"`;
      }
      return null;
    }
    default:
      return `Field "${field.name}" has an unknown kind`;
  }
}

/**
 * True when a stored value may be published. Malformed draft values are
 * rejected instead of silently written; see `propertyValueError` for the why.
 */
export function isPropertyValueValid(
  field: FieldDefinition,
  value: PropertyValue | null | undefined,
  context: PropertyValidationContext = {},
): boolean {
  return propertyValueError(field, value, context) === null;
}

/** The one place a stored value becomes the text a surface shows. */
export interface FormatPropertyOptions {
  /** Live title of the card a `card` value points at, when it still exists. */
  cardTitle?: string | undefined;
  /** Text for "no value"; defaults to an em dash. */
  empty?: string;
  /** Text for a deleted option or a missing target; defaults to "Unavailable". */
  unavailable?: string;
  /** Text for a checked box; defaults to a check mark. */
  checked?: string;
  /** Omit `card` values entirely (the compact card face does this). */
  includeCard?: boolean;
  /** Wrap a resolved card title, for example as `[[Title]]` in Markdown. */
  formatCard?: ((title: string) => string) | undefined;
}

const EM_DASH = "\u2014";

/**
 * Formats one property value for display. Never mutates the stored value: a
 * deleted option is still stored, but it reads as unavailable and counts as
 * empty. Every surface (panel, card face, property block, mention chip, export)
 * calls this so their readings cannot drift apart.
 */
export function formatPropertyValue(
  field: FieldDefinition,
  value: PropertyValue | undefined,
  options: FormatPropertyOptions = {},
): string {
  const empty = options.empty ?? EM_DASH;
  const unavailable = options.unavailable ?? "Unavailable";

  switch (field.kind) {
    case "text":
    case "date":
      return typeof value === "string" && value.trim().length > 0 ? value : empty;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? String(value) : empty;
    case "checkbox":
      return value === true ? (options.checked ?? "\u2713") : empty;
    case "select": {
      if (typeof value !== "string" || value.trim().length === 0) return empty;
      const option = field.options.find((candidate) => candidate.id === value);
      return option ? option.label : unavailable;
    }
    case "multiSelect": {
      if (!Array.isArray(value) || value.length === 0) return empty;
      const selected = new Set(value);
      const labels = field.options
        .filter((option) => selected.has(option.id))
        .map((option) => option.label);
      return labels.length > 0 ? labels.join(", ") : unavailable;
    }
    case "card": {
      if (options.includeCard === false) return empty;
      if (typeof value !== "string" || value.trim().length === 0) return empty;
      const title = options.cardTitle?.trim();
      if (!title) return unavailable;
      return options.formatCard ? options.formatCard(title) : title;
    }
  }
}

/**
 * True when the value counts as unanswered for a required field. Uses the
 * visible value: deleted options, all-deleted multi-selects and dangling card
 * targets are empty even though their dormant values stay stored.
 */
export function isPropertyValueEmpty(
  field: FieldDefinition,
  value: PropertyValue | undefined,
  options: FormatPropertyOptions = {},
): boolean {
  if (value === undefined) return true;
  switch (field.kind) {
    case "checkbox":
      return value !== true;
    case "number":
      return !(typeof value === "number" && Number.isFinite(value));
    case "select":
      return (
        typeof value !== "string" ||
        value.trim().length === 0 ||
        !field.options.some((option) => option.id === value)
      );
    case "multiSelect": {
      if (!Array.isArray(value) || value.length === 0) return true;
      return !value.some((id) => field.options.some((option) => option.id === id));
    }
    case "card":
      return (
        typeof value !== "string" ||
        value.trim().length === 0 ||
        (options.cardTitle?.trim().length ?? 0) === 0
      );
    case "text":
    case "date":
      return typeof value !== "string" || value.trim().length === 0;
  }
}
