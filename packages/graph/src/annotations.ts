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
 * `locator` names the *part* of the source and each kind fixes what it means: a spine index for a book, a page
 * for a PDF, a transcript id for a video. It is a closed field, not an extension point.
 */
export const annotationAnchorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("quote"),
    locator: z.string().min(1),
    quote: z.string().min(1).max(4000),
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
 * One highlight.
 *
 * `excerpt` is optional and medium-produced: a quote, a page's words and a timestamp are different facts, and
 * a canvas region has none of them. There is deliberately no `medium` field — `anchor.kind` already carries it,
 * and a second copy of a derivable fact is the thing that goes stale.
 */
export const annotationSchema = z.object({
  id: entityIdSchema,
  /** The card whose body holds the source: a book, a PDF, a video. */
  sourceCardId: entityIdSchema,
  /** An `AnnotationStyle`, which is shared across media because a colour is a colour. */
  styleId: entityIdSchema,
  anchor: annotationAnchorSchema,
  excerpt: z.string().max(4000).optional(),
  /** The card it was promoted into, once it has one. A highlight has no card until it earns one. */
  cardId: entityIdSchema.optional(),
  createdAt: z.number().int().nonnegative(),
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
