/**
 * Display templates: how one value reads where it is shown.
 *
 * A template is literal text plus a few tokens. It is rendered, never stored as
 * content, and it cannot express markup or CSS — a chip lives inside
 * collaborative rich text, so anything richer would be an injection hazard and
 * would defeat the "one value, many views" rule the card model rests on.
 *
 * The same parser is meant to carry a future `computed` field kind: a display
 * template reads one field of a card, a computed field reads several, and both
 * should render through this module rather than growing separate syntaxes.
 */

export const TEMPLATE_TOKENS = ["label", "value", "card", "type"] as const;
export type TemplateToken = (typeof TEMPLATE_TOKENS)[number];

/** One piece of a rendered template, tagged so the label can stay muted. */
export interface TemplateSegment {
  kind: TemplateToken | "literal";
  text: string;
}

/** What a template can read. A computed field would widen this, not replace it. */
export interface TemplateContext {
  /** The field's name. */
  label: string;
  /** The value as it already reads elsewhere (option labels, not ids). */
  value: string;
  /** The card's display title. */
  card: string;
  /** The owning type's name. */
  type: string;
}

/** Long enough for a sentence, short enough to stay a label. */
export const MAX_TEMPLATE_LENGTH = 160;

/**
 * The templates the preset buttons write. `custom` means "whatever is stored".
 * The `@` is literal text on purpose: a mention marker is chrome the reader can
 * drop, not something the chip adds behind their back.
 */
export const DISPLAY_PRESETS = {
  value: "{{value}}",
  labeled: "{{label}} \u00b7 {{value}}",
  trailing: "{{value}} \u00b7 {{label}}",
  carded: "@{{card}} \u00b7 {{value}}",
} as const;

export type DisplayPreset = keyof typeof DISPLAY_PRESETS;

/**
 * What an unset `display` means in a body block: the field's own name and its
 * value. The block sits on the card that owns the field, so naming the card
 * again would only repeat the card it is already in.
 */
export const DEFAULT_DISPLAY_TEMPLATE = DISPLAY_PRESETS.labeled;

/**
 * What an unset `display` means on a mention chip. A chip is a reference from
 * somewhere else, so it names its target: a bare "Ada" is ambiguous once a body
 * can hold several fields, and clicking it navigates somewhere invisible.
 */
export const MENTION_DISPLAY_TEMPLATE = DISPLAY_PRESETS.carded;

/** Shown for an empty value so a template never renders as a dangling prefix. */
export const EMPTY_VALUE_TEXT = "\u2014";

const tokenPattern = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/**
 * Splits a template into literal text and tokens. Unknown tokens and stray
 * braces stay literal, so a typo renders as typed instead of disappearing.
 */
export function templateSegments(template: string): TemplateSegment[] {
  const segments: TemplateSegment[] = [];
  const source = template.slice(0, MAX_TEMPLATE_LENGTH);
  let lastIndex = 0;

  // Adjacent literals merge, so "{{nope}} " is one segment rather than two.
  const pushLiteral = (text: string) => {
    if (!text) return;
    const previous = segments.at(-1);
    if (previous?.kind === "literal") previous.text += text;
    else segments.push({ kind: "literal", text });
  };

  for (const match of source.matchAll(tokenPattern)) {
    const [whole, name] = match;
    const at = match.index ?? 0;
    pushLiteral(source.slice(lastIndex, at));
    const token = TEMPLATE_TOKENS.find((entry) => entry === name?.toLocaleLowerCase());
    if (token) segments.push({ kind: token, text: whole });
    else pushLiteral(whole);
    lastIndex = at + whole.length;
  }
  pushLiteral(source.slice(lastIndex));
  return segments;
}

/** A template with every token replaced, for plain-text surfaces (clipboard, export). */
export function renderTemplate(template: string, context: TemplateContext): string {
  return templateSegments(template)
    .map((segment) =>
      segment.kind === "literal"
        ? segment.text
        : segment.kind === "value"
          ? context.value || EMPTY_VALUE_TEXT
          : context[segment.kind] || segment.text,
    )
    .join("");
}

type DisplayField = { display?: string | undefined };

/**
 * The template a field uses in one surface: its stored style, or that surface's
 * default. Centralised so a chip, a body block and a future rollup cannot drift
 * apart — an explicit style always wins, everywhere.
 */
export function displayTemplate(
  field: DisplayField,
  fallback: string = DEFAULT_DISPLAY_TEMPLATE,
): string {
  const stored = field.display?.trim();
  return stored && stored.length > 0 ? stored : fallback;
}

/** Which preset a template matches, or `custom` for anything hand-written. */
export function presetOf(template: string): DisplayPreset | "custom" {
  const trimmed = template.trim();
  for (const [id, value] of Object.entries(DISPLAY_PRESETS) as [DisplayPreset, string][]) {
    if (value === trimmed) return id;
  }
  return "custom";
}

/**
 * Keeps a stored template sane: one line, trimmed, capped. Display styles are
 * decoration, so there is nothing here worth refusing a write over.
 */
export function normalizeTemplate(template: string | null | undefined): string | null {
  const flat = (template ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TEMPLATE_LENGTH);
  return flat.length > 0 ? flat : null;
}
