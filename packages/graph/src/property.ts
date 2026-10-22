import type { FieldDefinition, PropertyValue } from "./schema.js";

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
