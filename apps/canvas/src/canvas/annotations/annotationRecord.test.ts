import type { Card, CardType, FieldDefinition } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  ANNOTATION_EXCERPT_RADIUS,
  annotationExcerpt,
  readAnnotation,
  resolveAnnotation,
  resolveAnnotationIn,
} from "./annotationRecord";

function field(id: string, name: string, kind: FieldDefinition["kind"]): FieldDefinition {
  return { id, name, kind, required: false, order: 0, options: [] };
}

const annotationType: CardType = {
  id: "annotation",
  name: "Annotation",
  glyph: "\u25c7",
  createdAt: 0,
  updatedAt: 0,
  fields: [
    field("f-source", "Source", "card"),
    field("f-quote", "Quote", "text"),
    field("f-start", "Start", "number"),
    field("f-end", "End", "number"),
  ],
};

function card(overrides: Partial<Card> = {}): Card {
  return {
    id: "note-1",
    createdAt: 0,
    updatedAt: 0,
    connectors: [],
    typeIds: ["annotation"],
    primaryTypeId: "annotation",
    tags: [],
    properties: {
      "f-source": "paper-1",
      "f-quote": "retrieval practice",
      "f-start": 11,
      "f-end": 29,
    },
    ...overrides,
  };
}

const sourceText = "A study of retrieval practice shows that testing beats rereading.";

describe("readAnnotation", () => {
  it("should read the four fields into one record", () => {
    const read = readAnnotation(card(), [annotationType]);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.record).toEqual({
      cardId: "note-1",
      sourceCardId: "paper-1",
      quote: "retrieval practice",
      start: 11,
      end: 29,
    });
  });

  it("should match a field name whatever its case or spacing", () => {
    const spaced: CardType = {
      ...annotationType,
      fields: annotationType.fields.map((entry) => ({ ...entry, name: ` ${entry.name} ` })),
    };
    expect(readAnnotation(card(), [spaced]).ok).toBe(true);
  });

  it("should find the fields on any type the card carries", () => {
    const mixed = card({ typeIds: ["note", "annotation"], primaryTypeId: "note" });
    expect(readAnnotation(mixed, [annotationType]).ok).toBe(true);
  });

  it("should name the fields a plain card is missing", () => {
    const read = readAnnotation(card({ typeIds: ["note"], primaryTypeId: "note" }), [
      annotationType,
    ]);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.code).toBe("annotation.record.incomplete");
    expect(read.fields).toEqual(["source", "quote", "start", "end"]);
  });

  it("should reject a value that does not fit its field", () => {
    const read = readAnnotation(card({ properties: { "f-source": "", "f-quote": "" } }), [
      annotationType,
    ]);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.fields).toEqual(["source", "quote", "start", "end"]);
  });

  it("should reject an end that is not after the start", () => {
    const read = readAnnotation(
      card({ properties: { ...card().properties, "f-start": 29, "f-end": 11 } }),
      [annotationType],
    );
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.fields).toEqual(["end"]);
  });

  it("should reject a fractional offset", () => {
    const read = readAnnotation(card({ properties: { ...card().properties, "f-start": 1.5 } }), [
      annotationType,
    ]);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.fields).toEqual(["start"]);
  });
});

describe("resolveAnnotation", () => {
  const record = { start: 11, end: 29, quote: "retrieval practice" };

  it("should resolve as intact when the offsets still hold the quote", () => {
    expect(resolveAnnotation(record, sourceText)).toEqual({
      state: "intact",
      range: { start: 11, end: 29 },
      occurrences: 1,
    });
  });

  it("should follow the quote when an edit moved it, and call that shifted", () => {
    const moved = `Prefaced. ${sourceText}`;
    const match = resolveAnnotation(record, moved);
    expect(match.state).toBe("shifted");
    expect(match.range).toEqual({ start: 21, end: 39 });
    expect(moved.slice(21, 39)).toBe("retrieval practice");
  });

  it("should stay intact when a second copy appears below an unchanged first one", () => {
    const twice = `${sourceText} And again: retrieval practice.`;
    expect(resolveAnnotation(record, twice).state).toBe("intact");
  });

  it("should refuse to pick between two matches", () => {
    const twice = `Intro. ${sourceText} And again: retrieval practice.`;
    const match = resolveAnnotation(record, twice);
    expect(match.state).toBe("ambiguous");
    expect(match.range).toBeNull();
    expect(match.occurrences).toBe(2);
  });

  it("should call a passage that is gone stale, and that is the only stale case", () => {
    const gone = "The source was rewritten and says something else entirely.";
    const match = resolveAnnotation(record, gone);
    expect(match.state).toBe("stale");
    expect(match.range).toBeNull();
    expect(match.occurrences).toBe(0);
  });

  it("should treat an edit above the passage as shifted rather than stale", () => {
    const trimmed = sourceText.replace("A study of ", "");
    const match = resolveAnnotation(record, trimmed);
    expect(match.state).not.toBe("stale");
    expect(trimmed.slice(match.range?.start ?? 0, match.range?.end ?? 0)).toBe(record.quote);
  });
});

describe("resolveAnnotationIn", () => {
  const record = { start: 11, end: 29, quote: "retrieval practice" };

  it("should carry no code while the passage can be pointed at", () => {
    expect(resolveAnnotationIn(record, { text: sourceText }).code).toBeNull();
  });

  it("should name the code for an unanchored range", () => {
    const twice = `Intro. ${sourceText} And again: retrieval practice.`;
    expect(resolveAnnotationIn(record, { text: twice }).code).toBe("annotation.range.unanchored");
  });

  it("should name the code for a stale range", () => {
    expect(resolveAnnotationIn(record, { text: "nothing here" }).code).toBe(
      "annotation.range.stale",
    );
  });

  it("should say the source is missing when the source is gone", () => {
    const resolution = resolveAnnotationIn(record, null);
    expect(resolution.state).toBe("stale");
    expect(resolution.code).toBe("annotation.source.missing");
  });
});

describe("annotationExcerpt", () => {
  const record = { start: 11, end: 29, quote: "retrieval practice" };

  it("should show the passage from the source, with its surroundings", () => {
    const match = resolveAnnotation(record, sourceText);
    const excerpt = annotationExcerpt(sourceText, match, record);
    expect(excerpt.quote).toBe("retrieval practice");
    expect(excerpt.before.endsWith("A study of ")).toBe(true);
    expect(excerpt.after.startsWith(" shows")).toBe(true);
  });

  it("should clamp the surroundings to the start and the end of the source", () => {
    const match = resolveAnnotation(record, sourceText);
    const excerpt = annotationExcerpt(sourceText, match, record, 10_000);
    expect(excerpt.before).toBe("A study of ");
    expect(excerpt.after).toBe(" shows that testing beats rereading.");
  });

  it("should keep the recorded quote when there is no range to read", () => {
    const excerpt = annotationExcerpt("nothing", { state: "stale", range: null }, record);
    expect(excerpt).toEqual({ before: "", quote: record.quote, after: "" });
  });

  it("should default to a readable amount of context", () => {
    expect(ANNOTATION_EXCERPT_RADIUS).toBeGreaterThan(40);
  });
});
