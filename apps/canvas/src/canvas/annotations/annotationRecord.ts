import type { Card, CardType, FieldDefinition } from "@suite/graph";
import type { ErrorCode } from "../../i18n";

/**
 * An annotation is a card that points into a source (ADR-0072).
 *
 * No new object class and no second comment thread: the card is the unit, and the pointer
 * into the source is a range it carries. This module is the *contract* half — what a
 * stored range is, what it resolves against, and what "stale" means — because those
 * answers decide how the reader behaves and none of them need a renderer.
 *
 * The range lives in fields the card's type declares, so it is written through
 * `WorkspaceDocument.setProperty` like every other property and a card with no such type
 * is simply a plain card. Field kinds are the closed set the schema already has:
 * `card` for the source, `text` for the quote, `number` for the two offsets.
 */

/** The field names an annotation type declares, matched case-insensitively. */
export const ANNOTATION_FIELDS = {
  source: "source",
  quote: "quote",
  start: "start",
  end: "end",
} as const;

export interface AnnotationRecord {
  cardId: string;
  /** The card this annotation points into. */
  sourceCardId: string;
  /** The exact text at capture. This is the anchor. */
  quote: string;
  /** Character offsets into the source's plain text, as captured. A hint, not the anchor. */
  start: number;
  end: number;
}

export type AnnotationRead =
  | { ok: true; record: AnnotationRecord }
  | { ok: false; code: ErrorCode; fields: readonly string[] };

function fieldNamed(fields: readonly FieldDefinition[], name: string): FieldDefinition | undefined {
  return fields.find((field) => field.name.trim().toLowerCase() === name);
}

/**
 * The record a card carries, or the reason it carries none.
 *
 * The fields are looked up across every type the card belongs to, because a card can
 * carry several (ADR-0053) and an annotation type is not privileged over the others. A
 * name is matched case-insensitively and trimmed; the value's shape is checked here rather
 * than trusted, because a property can be written by any client.
 */
export function readAnnotation(card: Card, types: readonly CardType[]): AnnotationRead {
  const owned = types.filter((type) => card.typeIds.includes(type.id));
  const declared = owned.flatMap((type) => type.fields);

  const sourceField = fieldNamed(declared, ANNOTATION_FIELDS.source);
  const quoteField = fieldNamed(declared, ANNOTATION_FIELDS.quote);
  const startField = fieldNamed(declared, ANNOTATION_FIELDS.start);
  const endField = fieldNamed(declared, ANNOTATION_FIELDS.end);

  if (!sourceField || !quoteField || !startField || !endField) {
    const absent: string[] = [];
    if (!sourceField) absent.push(ANNOTATION_FIELDS.source);
    if (!quoteField) absent.push(ANNOTATION_FIELDS.quote);
    if (!startField) absent.push(ANNOTATION_FIELDS.start);
    if (!endField) absent.push(ANNOTATION_FIELDS.end);
    return { ok: false, code: "annotation.record.incomplete", fields: absent };
  }

  const sourceCardId = card.properties[sourceField.id];
  const quote = card.properties[quoteField.id];
  const start = card.properties[startField.id];
  const end = card.properties[endField.id];

  if (
    typeof sourceCardId === "string" &&
    sourceCardId !== "" &&
    typeof quote === "string" &&
    quote !== "" &&
    typeof start === "number" &&
    Number.isInteger(start) &&
    start >= 0 &&
    typeof end === "number" &&
    Number.isInteger(end) &&
    end > start
  ) {
    return { ok: true, record: { cardId: card.id, sourceCardId, quote, start, end } };
  }

  // The fields exist but a value does not fit them: name the ones that failed the check, so
  // the reader knows which property to fix rather than which type to add.
  const invalid: string[] = [];
  if (typeof sourceCardId !== "string" || sourceCardId === "") {
    invalid.push(ANNOTATION_FIELDS.source);
  }
  if (typeof quote !== "string" || quote === "") invalid.push(ANNOTATION_FIELDS.quote);
  if (typeof start !== "number" || !Number.isInteger(start) || start < 0) {
    invalid.push(ANNOTATION_FIELDS.start);
  }
  if (typeof end !== "number" || !Number.isInteger(end) || end <= 0) {
    invalid.push(ANNOTATION_FIELDS.end);
  } else if (typeof start === "number" && end <= start) {
    invalid.push(ANNOTATION_FIELDS.end);
  }
  return { ok: false, code: "annotation.record.incomplete", fields: invalid };
}

/** A marked range in the source's plain text. */
export interface AnnotationRange {
  start: number;
  end: number;
}

/**
 * What the recorded range means now.
 *
 * - `intact` — the source still holds the quote at the recorded offsets.
 * - `shifted` — the source moved the passage. The quote is found exactly once, so the
 *   range follows it and no reader has to do anything.
 * - `ambiguous` — the quote appears more than once and neither the recorded offsets nor
 *   any unique context picks one. The reader shows the quote without a highlight.
 * - `stale` — the source no longer contains the quote at all.
 *
 * **"Stale" means exactly the last one.** A source that was edited above the passage is
 * not stale; it is shifted, and shifting is silent. That distinction is the contract: a
 * reader only has to act when the passage itself is gone.
 */
export type AnnotationState = "intact" | "shifted" | "ambiguous" | "stale";

export interface AnnotationMatch {
  state: AnnotationState;
  /** Where the passage is now; null when nothing can be pointed at. */
  range: AnnotationRange | null;
  /** Occurrences of the quote in the source; 0 is what makes a record stale. */
  occurrences: number;
}

function occurrenceOffsets(text: string, quote: string): number[] {
  const found: number[] = [];
  if (quote === "") return found;
  let index = text.indexOf(quote);
  while (index !== -1) {
    found.push(index);
    index = text.indexOf(quote, index + 1);
  }
  return found;
}

/**
 * Resolves a record against the source as it stands now.
 *
 * The quote is the anchor and the offsets are a hint, which is the only arrangement that
 * survives an edit above the passage: offsets drift, text does not.
 */
export function resolveAnnotation(
  record: Pick<AnnotationRecord, "start" | "end" | "quote">,
  sourceText: string,
): AnnotationMatch {
  if (sourceText.slice(record.start, record.end) === record.quote) {
    return {
      state: "intact",
      range: { start: record.start, end: record.end },
      occurrences: occurrenceOffsets(sourceText, record.quote).length,
    };
  }

  const offsets = occurrenceOffsets(sourceText, record.quote);
  if (offsets.length === 1) {
    const start = offsets[0] as number;
    return {
      state: "shifted",
      range: { start, end: start + record.quote.length },
      occurrences: 1,
    };
  }
  if (offsets.length > 1) return { state: "ambiguous", range: null, occurrences: offsets.length };
  return { state: "stale", range: null, occurrences: 0 };
}

export interface AnnotationResolution {
  state: AnnotationState;
  range: AnnotationRange | null;
  occurrences: number;
  /** The sentence the reader needs, or null when there is nothing to explain. */
  code: ErrorCode | null;
}

/**
 * The resolution a reader shows, including the sentence a failure needs.
 *
 * The source text is passed in rather than fetched: content lives in rich text owned by
 * the editor, and the surface that has it is the one that asks. A source that is gone from
 * the workspace resolves as stale with its own code, so the reader can say which of the
 * two things happened.
 */
export function resolveAnnotationIn(
  record: Pick<AnnotationRecord, "start" | "end" | "quote">,
  source: { text: string } | null,
): AnnotationResolution {
  if (!source) {
    return { state: "stale", range: null, occurrences: 0, code: "annotation.source.missing" };
  }
  const match = resolveAnnotation(record, source.text);
  if (match.state === "ambiguous") {
    return { ...match, code: "annotation.range.unanchored" };
  }
  if (match.state === "stale") return { ...match, code: "annotation.range.stale" };
  return { ...match, code: null };
}

export interface AnnotationExcerpt {
  before: string;
  quote: string;
  after: string;
}

/** How much of the source either side of the passage the reader shows. */
export const ANNOTATION_EXCERPT_RADIUS = 120;

/**
 * The passage with its surroundings, for the reader.
 *
 * The quote is taken from the source at the resolved range, so an excerpt cannot show
 * text the source does not have. A record with no range still shows its own quote: the
 * card keeps what was written even when the source cannot confirm it.
 */
export function annotationExcerpt(
  sourceText: string,
  match: Pick<AnnotationMatch, "range"> & { state: AnnotationState },
  record: Pick<AnnotationRecord, "quote">,
  radius = ANNOTATION_EXCERPT_RADIUS,
): AnnotationExcerpt {
  if (!match.range) return { before: "", quote: record.quote, after: "" };
  const { start, end } = match.range;
  return {
    before: sourceText.slice(Math.max(0, start - radius), start),
    quote: sourceText.slice(start, end),
    after: sourceText.slice(end, Math.min(sourceText.length, end + radius)),
  };
}
