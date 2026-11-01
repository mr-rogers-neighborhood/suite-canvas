import { z } from "zod";
import { entityIdSchema } from "./schema.js";

/**
 * Annotations: a highlight in a source, and the palette that colours it.
 *
 * A highlight is not a card. It is made while reading, it exists before anybody decides what it becomes, and a
 * single book carries hundreds — so it is a small record in its own root, and the **card** is a promotion the
 * reader chooses. That split is what keeps the library, the inbox and every view from filling with things
 * nobody wrote.
 *
 * Two rules make the record survive its medium. The anchor is a **union**, not an EPUB-shaped object, so a PDF
 * page and a span of video share the record, the styles, the field kind and the promotion command. And the
 * anchor is a **quote** rather than an offset, because reflow invalidates an offset on every screen.
 */

/**
 * The longest passage a highlight may quote, in characters.
 *
 * A cap rather than none because a record travels in every snapshot and every share, and a highlight of a whole chapter
 * is a copy of the book rather than a note about it. Named here so a surface can refuse a selection with the same
 * number the schema enforces, instead of discovering it in a thrown parse error with nothing to show the reader.
 */
export const ANNOTATION_QUOTE_MAX_LENGTH = 4000;

/** A rectangle in a page's own coordinates, 0..1, so it survives a zoom. */
export const anchorRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

/**
 * Where in a source an annotation sits.
 *
 * `locator` names the *part* of the source and each kind fixes what it means: a chapter's path inside a book, a page
 * for a PDF, a transcript id for a video. It is a closed field, not an extension point.
 *
 * A book's locator is an **archive path** rather than a spine index, because that is the thing a reader can still
 * match after the book is re-spined: a path survives an inserted chapter, an index does not. Records written before
 * the anchor meant anything hold a character count instead; a surface that paints reads a purely numeric locator as
 * "chapter unknown" and tolerates it, which is the whole repair — the same choice schema 6 made for a stored
 * `own-card` target. There is deliberately no migration script for either.
 */
export const annotationAnchorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("quote"),
    locator: z.string().min(1),
    quote: z.string().min(1).max(ANNOTATION_QUOTE_MAX_LENGTH),
    prefix: z.string().max(200),
    suffix: z.string().max(200),
  }),
  z.object({
    kind: z.literal("page"),
    locator: z.string().min(1),
    page: z.number().int().nonnegative(),
    rects: z.array(anchorRectSchema).max(64),
  }),
  z.object({
    kind: z.literal("time"),
    locator: z.string().min(1),
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
  }),
]);

/**
 * Where a part of a highlight goes when the highlight becomes a card.
 *
 * A target is a *destination*, never a promise that something exists there: `field` names a property, and promotion
 * creates it on the promoted type when it is missing. Naming beats an id because a recipe has to survive a type
 * change, which is the whole reason a reader writes one.
 *
 * A highlight produces **one** card, so every destination is a place on that card. Schema 5 also had `own-card`, which
 * asked a part to become a card of its own; schema 6 removed it, because a promotion that makes an unpredictable
 * number of cards is a promotion nobody can undo in one gesture. The reader normalises a stored `own-card` to `body`,
 * which is where those words already are: the passage is the card's first block.
 */
export const annotationPartTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("title") }),
  z.object({ kind: z.literal("body") }),
  z.object({ kind: z.literal("field"), name: z.string().min(1).max(60) }),
]);

/**
 * A range inside a highlight, and what it is for.
 *
 * `start` and `end` index the annotation's own quote. That is the point: the quote is text, so a range of it is
 * stable under reflow exactly as the quote is, and unlike a second `quote/prefix/suffix` it cannot be ambiguous
 * inside its own paragraph. A part inherits the annotation's own resolution — if the highlight still finds its words,
 * its parts still find theirs.
 */
export const annotationPartSchema = z.object({
  id: entityIdSchema,
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  target: annotationPartTargetSchema,
});

/**
 * One highlight.
 *
 * `excerpt` is optional and medium-produced: a quote, a page's words and a timestamp are different facts, and
 * a canvas region has none of them. There is deliberately no `medium` field — `anchor.kind` already carries it,
 * and a second copy of a derivable fact is the thing that goes stale.
 */
export const annotationSchema = z
  .object({
    id: entityIdSchema,
    /** The card whose body holds the source: a book, a PDF, a video. */
    sourceCardId: entityIdSchema,
    /** An `AnnotationStyle`, which is shared across media because a colour is a colour. */
    styleId: entityIdSchema,
    anchor: annotationAnchorSchema,
    excerpt: z.string().max(ANNOTATION_QUOTE_MAX_LENGTH).optional(),
    /** The card it was promoted into, once it has one. A highlight has no card until it earns one. */
    cardId: entityIdSchema.optional(),
    /**
     * The ranges a reader broke this highlight into, and where each one goes.
     *
     * Absent means "the whole quote is the passage", which is the ordinary case: a part exists because somebody
     * decided the concept was not at the start of the sentence.
     */
    parts: z.array(annotationPartSchema).max(24).optional(),
    createdAt: z.number().int().nonnegative(),
  })
  .superRefine((annotation, ctx) => {
    const parts = annotation.parts ?? [];
    if (parts.length === 0) return;
    if (annotation.anchor.kind !== "quote") {
      // Only a quote has characters to index. A page's rectangles and a span of time have their own shape, and a part
      // of either would need a different idea rather than a silently ignored field.
      ctx.addIssue({ code: "custom", message: "Only a quote can be broken into parts" });
      return;
    }
    const length = annotation.anchor.quote.length;
    for (const part of parts) {
      if (part.end <= part.start) {
        ctx.addIssue({ code: "custom", message: `Part ${part.id} ends before it starts` });
      }
      if (part.end > length) {
        ctx.addIssue({ code: "custom", message: `Part ${part.id} runs past the end of its quote` });
      }
    }
  });

/**
 * A colour a reader can highlight with.
 *
 * Data, not code: nothing anywhere branches on a style's id, so a reader can add one, rename one, and later
 * point one at a template without a release. `templateTypeId` is the RemNote-shaped hook — "green highlights
 * become Claim cards" — expressed as the templates the graph already has rather than as behaviour on a type.
 */
export const annotationStyleSchema = z.object({
  id: entityIdSchema,
  name: z.string().min(1).max(60),
  /** A CSS colour, because the reader paints it on a card, a page and a timeline alike. */
  color: z.string().min(1).max(40),
  /** The card type a promoted highlight instantiates. Absent means the workspace's default type. */
  templateTypeId: entityIdSchema.optional(),
  /** Paint order in the palette, smallest first. */
  order: z.number().int().nonnegative(),
  /**
   * The destinations this style expects a highlight to be broken into.
   *
   * A suggestion, not a schema: "green means the title is the claim and `Source` is the book" is data a reader
   * writes once, and a new green highlight starts with those parts empty and named. The highlight stays the truth,
   * because the words a part covers are the reader's choice every time.
   */
  recipe: z.array(annotationPartTargetSchema).max(12).optional(),
});

export type AnchorRect = z.infer<typeof anchorRectSchema>;
export type AnnotationAnchor = z.infer<typeof annotationAnchorSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type AnnotationStyle = z.infer<typeof annotationStyleSchema>;
export type AnchorKind = AnnotationAnchor["kind"];

/**
 * The palette a workspace starts with.
 *
 * Four, because a reader who can make a highlight needs one press, not a colour picker, and four is what fits
 * a floating palette over a selection without covering the words it is for.
 */
export const DEFAULT_ANNOTATION_STYLES: readonly AnnotationStyle[] = [
  { id: "style-yellow", name: "Important", color: "#f5d90a", order: 0 },
  { id: "style-green", name: "Agree", color: "#3fb950", order: 1 },
  { id: "style-blue", name: "Reference", color: "#4c8dff", order: 2 },
  { id: "style-rose", name: "Question", color: "#f0616d", order: 3 },
];

/** The styles a reader can choose from, in palette order, falling back to the defaults. */
export function sortedStyles(styles: readonly AnnotationStyle[]): AnnotationStyle[] {
  const source = styles.length === 0 ? DEFAULT_ANNOTATION_STYLES : styles;
  return [...source].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** The annotations of one source, oldest first, which is the order a reader made them in. */
export function annotationsOf(
  annotations: readonly Annotation[],
  sourceCardId: string,
): Annotation[] {
  return annotations
    .filter((annotation) => annotation.sourceCardId === sourceCardId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/**
 * The annotations a share may carry: those whose source is inside the scope.
 *
 * A projection copies the document, and a book's highlights must not leak a passage from a source the share
 * does not include. Same rule a card reference already follows.
 */
export function annotationsWithin(
  annotations: readonly Annotation[],
  sourceCardIds: ReadonlySet<string>,
): { kept: Annotation[]; withheld: number } {
  const kept = annotations.filter((annotation) => sourceCardIds.has(annotation.sourceCardId));
  return { kept, withheld: annotations.length - kept.length };
}

export type AnnotationPart = z.infer<typeof annotationPartSchema>;
export type AnnotationPartTarget = z.infer<typeof annotationPartTargetSchema>;

/**
 * The words a part covers, or null when the annotation cannot say.
 *
 * Read through the annotation rather than stored on the part: a copy of the text would be a second truth that
 * drifts the moment the highlight is resolved again.
 */
export function partText(annotation: Annotation, part: AnnotationPart): string | null {
  if (annotation.anchor.kind !== "quote") return null;
  if (part.start < 0 || part.end > annotation.anchor.quote.length || part.end <= part.start)
    return null;
  return annotation.anchor.quote.slice(part.start, part.end);
}

/** Quality-of-life for a surface that lists parts: their text, in the order they appear. */
export function partsOf(annotation: Annotation): { part: AnnotationPart; text: string }[] {
  return [...(annotation.parts ?? [])]
    .sort((a, b) => a.start - b.start || a.id.localeCompare(b.id))
    .flatMap((part) => {
      const text = partText(annotation, part);
      return text === null ? [] : [{ part, text }];
    });
}

/** The first part with one target kind, which is how promotion reads a title or a body. */
export function partFor(
  annotation: Annotation,
  kind: AnnotationPartTarget["kind"],
): { part: AnnotationPart; text: string } | null {
  return partsOf(annotation).find((entry) => entry.part.target.kind === kind) ?? null;
}

/** Every part that names a property, paired with its name, in reading order. */
export function fieldParts(
  annotation: Annotation,
): { part: AnnotationPart; text: string; name: string }[] {
  return partsOf(annotation).flatMap(({ part, text }) =>
    part.target.kind === "field" ? [{ part, text, name: part.target.name }] : [],
  );
}
