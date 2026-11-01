/**
 * The anchor model, and the registry every medium registers with.
 *
 * The union itself lives in `@suite/graph`, because the document is what stores it: `annotationSchema` is the only
 * definition, and this module re-exports it rather than keeping a second copy that a schema change would leave
 * behind. What belongs here is the part the graph cannot own — the registry a medium registers with, and the
 * functions that ask a registered medium to describe or open an anchor.
 *
 * Two more media are coming: a PDF annotation is a rectangle on a page and a video annotation is a span of time,
 * and both share this record, this palette, the `annotation` field kind and one promotion command with a book's
 * quote. So each medium contributes a module, never a shape.
 */
import type { AnchorKind, AnnotationAnchor } from "@suite/graph";

export type { AnchorKind, AnchorRect, AnnotationAnchor } from "@suite/graph";

/**
 * What a medium contributes.
 *
 * Everything above the anchor — the record, the styles, the field kind, the library facet and the promotion
 * command — talks to the app through this interface and never to a book, a PDF or a player. A new medium is a
 * module and a registration; if it ever needs more than this, the interface is what changes, once.
 */
export interface AnnotationMedium {
  readonly anchorKind: AnchorKind;
  /** A short name for the part of the source, for a card that says where it came from. */
  describe(anchor: AnnotationAnchor): string | null;
  /** The words, the frame label or the time range, as the medium reports them. */
  excerpt(anchor: AnnotationAnchor): string | null;
  /** Opens the source at this anchor. The board's card chip calls this and nothing else. */
  openAt(anchor: AnnotationAnchor): void;
}

const mediums = new Map<AnchorKind, AnnotationMedium>();

/**
 * Registers a medium. Called at module scope by the module that owns it, so importing that module is what
 * makes the anchor kind renderable — the same shape the embed and field-kind registries use.
 */
export function registerAnnotationMedium(medium: AnnotationMedium): void {
  mediums.set(medium.anchorKind, medium);
}

export function annotationMedium(kind: AnchorKind): AnnotationMedium | undefined {
  return mediums.get(kind);
}

/** Registered anchor kinds, for a test that asserts every medium has somewhere to render. */
export function registeredAnchorKinds(): AnchorKind[] {
  return [...mediums.keys()];
}

/** For a test or a story that has to put the registry back the way it was. */
export function forgetAnnotationMediums(): void {
  mediums.clear();
}

/**
 * The excerpt a card shows, from whichever medium can read it.
 *
 * Null rather than a thrown error when the medium is not registered: a document may arrive carrying a PDF
 * annotation on a build that has no PDF module, and that has to be a sentence on a card, not a crash.
 */
export function excerptOf(anchor: AnnotationAnchor, stored: string | undefined): string | null {
  if (stored !== undefined && stored.length > 0) return stored;
  return annotationMedium(anchor.kind)?.excerpt(anchor) ?? null;
}

/** Where the chip on a promoted card goes. A medium this build lacks says so instead of doing nothing. */
export function openAtAnchor(anchor: AnnotationAnchor): boolean {
  const medium = annotationMedium(anchor.kind);
  if (medium === undefined) return false;
  medium.openAt(anchor);
  return true;
}

export { occurrences, type QuoteAnchor, type ResolveResult, resolveQuote } from "./resolve";
export { chapterTextIndex, rangeOf, surroundings, type TextIndex } from "./textIndex";
