import {
  type Annotation,
  type AnnotationAnchor,
  type AnnotationPart,
  type AnnotationPartTarget,
  type AnnotationStyle,
  annotationAnchorSchema,
  annotationPartSchema,
  annotationSchema,
  annotationStyleSchema,
  DEFAULT_ANNOTATION_STYLES,
  sortedStyles,
} from "../annotations.js";
import { isList, isMap, readNumber, readString } from "../records/values.js";
import { STRUCT_ORIGIN } from "./constants.js";
import type { DocContext } from "./context.js";
import type { CreateAnnotationInput, CreateAnnotationStyleInput } from "./model.js";

/**
 * Owns annotations and the palette that colours them.
 *
 * A highlight is written once and rarely touched again, so the writes here are deliberately coarse: `add`
 * writes a whole record, `setCard` links a promotion, `delete` removes it. That is the opposite of a saved
 * view, whose facets are edited one key at a time — the difference is that a view is *authored* and a highlight
 * is *made*.
 *
 * The styles are a workspace list, shared across media: a colour is a colour whether it fills a line of a book,
 * a rectangle on a page or a band on a timeline. Nothing here branches on which medium an anchor names.
 */
export function annotationsMethods(ctx: DocContext) {
  const notify = (): void => {
    ctx.annotationRevision += 1;
    for (const listener of ctx.annotationListeners) listener();
  };

  /**
   * A container as a plain record.
   *
   * An anchor just written is the object the caller passed, while one that arrived through a projection is a
   * nested Loro container. Both have to reach the schema as values, so this is the one place the difference is
   * absorbed — and it is also where a hand-edited record is caught, because the schema sees only the keys this
   * reader chose to copy.
   */
  const recordOf = (value: unknown): Record<string, unknown> | null => {
    if (isMap(value)) {
      const out: Record<string, unknown> = {};
      for (const key of [
        "kind",
        "locator",
        "quote",
        "prefix",
        "suffix",
        "page",
        "startMs",
        "endMs",
      ]) {
        const read = value.get(key);
        if (read !== undefined) out[key] = read;
      }
      const rects = value.get("rects");
      out.rects = isList(rects) ? rects.toArray() : rects;
      return out;
    }
    if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
    return null;
  };

  const readAnchor = (value: unknown): AnnotationAnchor | undefined => {
    const record = recordOf(value);
    if (record === null) return undefined;
    const parsed = annotationAnchorSchema.safeParse(record);
    return parsed.success ? parsed.data : undefined;
  };

  /**
   * A highlight's parts, read back from either representation.
   *
   * A part is a plain object just written or a container that arrived through a projection, and the schema is what
   * decides whether either is a part. Undefined rather than an empty list when a highlight has none, because "absent"
   * and "broken into nothing" are different answers to a surface asking what it should show.
   */
  const readParts = (value: unknown): Annotation["parts"] | undefined => {
    const items = isList(value) ? value.toArray() : Array.isArray(value) ? value : null;
    if (items === null) return undefined;
    const parsed = items.flatMap((item) => {
      const record = recordOf(item);
      const part = record === null ? undefined : annotationPartSchema.safeParse(record);
      return part?.success === true ? [part.data] : [];
    });
    return parsed.length === 0 ? undefined : parsed;
  };

  const readAnnotation = (id: string): Annotation | undefined => {
    const fields = ctx.annotationsMap.get(id);
    if (!isMap(fields)) return undefined;
    const anchor = readAnchor(fields.get("anchor"));
    const parsed = annotationSchema.safeParse({
      id,
      sourceCardId: readString(fields, "sourceCardId") ?? "",
      styleId: readString(fields, "styleId") ?? "",
      anchor,
      ...(readString(fields, "excerpt") === undefined
        ? {}
        : { excerpt: readString(fields, "excerpt") }),
      ...(readString(fields, "cardId") === undefined
        ? {}
        : { cardId: readString(fields, "cardId") }),
      ...(readParts(fields.get("parts")) === undefined
        ? {}
        : { parts: readParts(fields.get("parts")) }),
      createdAt: readNumber(fields, "createdAt") ?? 0,
    });
    // A hand-edited or corrupt record is skipped rather than thrown on: one bad highlight must not cost a
    // reader their book.
    return parsed.success ? parsed.data : undefined;
  };

  const readStyle = (id: string): AnnotationStyle | undefined => {
    const fields = ctx.annotationStylesMap.get(id);
    if (!isMap(fields)) return undefined;
    const parsed = annotationStyleSchema.safeParse({
      id,
      name: readString(fields, "name") ?? "",
      color: readString(fields, "color") ?? "",
      order: readNumber(fields, "order") ?? 0,
      ...(readString(fields, "templateTypeId") === undefined
        ? {}
        : { templateTypeId: readString(fields, "templateTypeId") }),
      ...(Array.isArray(fields.get("recipe")) ? { recipe: fields.get("recipe") } : {}),
    });
    return parsed.success ? parsed.data : undefined;
  };

  return {
    /** Every highlight, oldest first, which is the order a reader made them in. */
    listAnnotations(): Annotation[] {
      return ctx.annotationsMap
        .keys()
        .map((id) => ctx.api.annotations.getAnnotation(id))
        .filter((annotation): annotation is Annotation => annotation !== undefined)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    },

    getAnnotation(id: string): Annotation | undefined {
      return readAnnotation(id);
    },

    /** The highlights of one source, which is what a reader's book draws. */
    listAnnotationsOf(sourceCardId: string): Annotation[] {
      return ctx.api.annotations
        .listAnnotations()
        .filter((annotation) => annotation.sourceCardId === sourceCardId);
    },

    addAnnotation(input: CreateAnnotationInput): Annotation {
      const id = input.id ?? crypto.randomUUID();
      if (ctx.annotationsMap.get(id) !== undefined) throw new Error(`Annotation exists: ${id}`);
      const annotation = annotationSchema.parse({
        id,
        sourceCardId: input.sourceCardId,
        styleId: input.styleId,
        anchor: input.anchor,
        ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt }),
        ...(input.parts === undefined ? {} : { parts: input.parts }),
        createdAt: input.createdAt ?? Date.now(),
      });
      const fields = ctx.annotationsMap.ensureMergeableMap(id);
      fields.set("sourceCardId", annotation.sourceCardId);
      fields.set("styleId", annotation.styleId);
      fields.set("anchor", annotation.anchor);
      fields.set("createdAt", annotation.createdAt);
      if (annotation.excerpt !== undefined) fields.set("excerpt", annotation.excerpt);
      if (annotation.parts !== undefined) fields.set("parts", annotation.parts);
      ctx.commit(`${STRUCT_ORIGIN}add-annotation`);
      notify();
      return annotation;
    },

    /** Moves a highlight to another colour without touching where it is. */
    setAnnotationStyle(id: string, styleId: string): Annotation | undefined {
      const fields = ctx.annotationsMap.get(id);
      if (!isMap(fields)) return undefined;
      fields.set("styleId", styleId);
      ctx.commit(`${STRUCT_ORIGIN}annotate-style`);
      notify();
      return ctx.api.annotations.getAnnotation(id);
    },

    /**
     * Records the card a highlight was promoted into.
     *
     * The one later write a highlight takes: the card is a decision the reader made after reading, and the
     * record keeps the link so the book can show which passages have already left it.
     */
    setAnnotationCard(id: string, cardId: string): Annotation | undefined {
      const fields = ctx.annotationsMap.get(id);
      if (!isMap(fields)) return undefined;
      fields.set("cardId", cardId);
      ctx.commit(`${STRUCT_ORIGIN}annotate-promoted`);
      notify();
      return ctx.api.annotations.getAnnotation(id);
    },

    /**
     * Replaces a highlight's parts.
     *
     * Written whole rather than per part, and that is deliberate: a part is a range, so two people editing different
     * parts of one highlight would produce ranges that overlap or leave gaps — a shape neither of them chose. One
     * list, last writer wins, is the honest semantics for a structure whose parts are about each other.
     */
    setAnnotationParts(id: string, parts: AnnotationPart[]): Annotation | undefined {
      const fields = ctx.annotationsMap.get(id);
      if (!isMap(fields)) return undefined;
      const current = ctx.api.annotations.getAnnotation(id);
      if (current === undefined) return undefined;
      // Validate against the quote before writing: a range outside it would be a highlight that cannot draw itself.
      annotationSchema.parse({ ...current, parts });
      if (parts.length === 0) fields.delete("parts");
      else fields.set("parts", parts);
      ctx.commit(`${STRUCT_ORIGIN}annotate-parts`);
      notify();
      return ctx.api.annotations.getAnnotation(id);
    },

    /** Removes a highlight. The card it became, if it became one, is left alone: the reader wrote that. */
    deleteAnnotation(id: string): void {
      if (ctx.annotationsMap.get(id) === undefined) return;
      ctx.annotationsMap.delete(id);
      ctx.commit(`${STRUCT_ORIGIN}delete-annotation`);
      notify();
    },

    /** Removes every highlight of one source, which is what deleting a book's card has to do. */
    deleteAnnotationsOf(sourceCardId: string): number {
      const doomed = ctx.api.annotations
        .listAnnotationsOf(sourceCardId)
        .map((annotation) => annotation.id);
      for (const id of doomed) ctx.annotationsMap.delete(id);
      if (doomed.length === 0) return 0;
      ctx.commit(`${STRUCT_ORIGIN}delete-annotations`);
      notify();
      return doomed.length;
    },

    /** The palette, in the order it is drawn; the defaults when a workspace has never set one. */
    listAnnotationStyles(): AnnotationStyle[] {
      const stored = ctx.annotationStylesMap
        .keys()
        .map((id) => readStyle(id))
        .filter((style): style is AnnotationStyle => style !== undefined);
      return sortedStyles(stored);
    },

    getAnnotationStyle(id: string): AnnotationStyle | undefined {
      return readStyle(id);
    },

    /**
     * Writes the palette a workspace starts with, once.
     *
     * Idempotent: a workspace that already has styles keeps whatever the reader called them, so seeding on boot
     * cannot overwrite a renamed colour.
     */
    ensureAnnotationStyles(): AnnotationStyle[] {
      if (ctx.annotationStylesMap.size === 0) {
        for (const style of DEFAULT_ANNOTATION_STYLES) ctx.api.annotations.writeStyle(style);
        ctx.commit(`${STRUCT_ORIGIN}seed-annotation-styles`);
        notify();
      }
      return ctx.api.annotations.listAnnotationStyles();
    },

    addAnnotationStyle(input: CreateAnnotationStyleInput): AnnotationStyle {
      const style = annotationStyleSchema.parse({
        id: input.id ?? crypto.randomUUID(),
        name: input.name,
        color: input.color,
        order: input.order ?? ctx.annotationStylesMap.size,
        ...(input.templateTypeId === undefined ? {} : { templateTypeId: input.templateTypeId }),
      });
      if (ctx.annotationStylesMap.get(style.id) !== undefined) {
        throw new Error(`Annotation style exists: ${style.id}`);
      }
      ctx.api.annotations.writeStyle(style);
      ctx.commit(`${STRUCT_ORIGIN}add-annotation-style`);
      notify();
      return style;
    },

    /** Restyles one palette entry. `templateTypeId` is cleared by passing null. */
    patchAnnotationStyle(
      id: string,
      patch: {
        name?: string;
        color?: string;
        order?: number;
        templateTypeId?: string | null;
        /** The destinations this type fills. An empty list clears the mapping. */
        recipe?: AnnotationPartTarget[] | null;
      },
    ): AnnotationStyle | undefined {
      const fields = ctx.annotationStylesMap.get(id);
      if (!isMap(fields)) return undefined;
      const merged = annotationStyleSchema.parse({
        ...(readStyle(id) ?? {}),
        id,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.color === undefined ? {} : { color: patch.color }),
        ...(patch.order === undefined ? {} : { order: patch.order }),
        ...(patch.templateTypeId === null
          ? { templateTypeId: undefined }
          : patch.templateTypeId === undefined
            ? {}
            : { templateTypeId: patch.templateTypeId }),
        ...(patch.recipe === null || (patch.recipe !== undefined && patch.recipe.length === 0)
          ? { recipe: undefined }
          : patch.recipe === undefined
            ? {}
            : { recipe: patch.recipe }),
      });
      ctx.api.annotations.writeStyle(merged);
      ctx.commit(`${STRUCT_ORIGIN}patch-annotation-style`);
      notify();
      return readStyle(id);
    },

    /** Removes a palette entry. The highlights that used it keep the id and read as the first style. */
    deleteAnnotationStyle(id: string): void {
      if (ctx.annotationStylesMap.get(id) === undefined) return;
      ctx.annotationStylesMap.delete(id);
      ctx.commit(`${STRUCT_ORIGIN}delete-annotation-style`);
      notify();
    },

    writeStyle(style: AnnotationStyle): void {
      const fields = ctx.annotationStylesMap.ensureMergeableMap(style.id);
      fields.set("name", style.name);
      fields.set("color", style.color);
      fields.set("order", style.order);
      if (style.templateTypeId === undefined) fields.delete("templateTypeId");
      else fields.set("templateTypeId", style.templateTypeId);
      if (style.recipe === undefined || style.recipe.length === 0) fields.delete("recipe");
      else fields.set("recipe", style.recipe);
    },

    /** One anchor as the medium would describe it, for a surface that lists highlights without the source. */
    anchorOf(id: string): AnnotationAnchor | undefined {
      return ctx.api.annotations.getAnnotation(id)?.anchor;
    },

    /** Subscribes to every annotation or palette change. One listener, because the two arrive together. */
    observeAnnotations(listener: () => void): () => void {
      ctx.annotationListeners.add(listener);
      return () => ctx.annotationListeners.delete(listener);
    },

    annotationsRevision(): number {
      return ctx.annotationRevision;
    },
  };
}
