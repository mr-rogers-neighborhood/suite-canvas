/**
 * What an embed should draw, decided as data.
 *
 * Pure on purpose: the renderer asks a question and gets an answer, so the cycle rule
 * and the depth budget live in one testable place instead of in a node view that has to
 * defend itself while rendering. Nothing here reads or writes a document.
 */

/** Why an embed is not a card this reader can see. */
export type EmbedStubReason = "missing" | "not-shared" | "cycle" | "unset";

export type EmbedResolution =
  | { readonly kind: "card"; readonly cardId: string; readonly depth: number }
  | { readonly kind: "stub"; readonly reason: EmbedStubReason; readonly cardId: string | null };

export interface EmbedLookup {
  /** The card exists in this document. */
  readonly cardExists: (cardId: string) => boolean;
  /**
   * The reader may see it. A share projection holds only the cards it publishes, so a
   * missing one is the projection talking, not a broken document.
   */
  readonly visible?: ((cardId: string) => boolean) | undefined;
}

export interface EmbedOptions {
  /** How deep this embed sits. The host card is 0, its embed is 1. */
  readonly depth: number;
  /** Cards already being drawn above this one, nearest last. */
  readonly ancestors: readonly string[];
  /**
   * How many levels render. One means an embed draws its card but not that card's own
   * embeds, which is the default: two cards embedding each other is one click away and
   * has to stop somewhere readable.
   */
  readonly maxDepth?: number | undefined;
}

export const DEFAULT_EMBED_DEPTH = 1;

/**
 * Decide one embed.
 *
 * Order matters: a card this reader cannot see says so before the cycle check, because
 * "hidden from you" is the more useful answer than "it would have looped".
 */
export function resolveEmbed(
  cardId: string | null | undefined,
  options: EmbedOptions,
  lookup: EmbedLookup,
): EmbedResolution {
  const id = typeof cardId === "string" ? cardId.trim() : "";
  if (id.length === 0) return { kind: "stub", reason: "unset", cardId: null };

  if (lookup.visible !== undefined && !lookup.visible(id)) {
    return { kind: "stub", reason: "not-shared", cardId: id };
  }
  if (!lookup.cardExists(id)) return { kind: "stub", reason: "missing", cardId: id };
  if (options.ancestors.includes(id)) return { kind: "stub", reason: "cycle", cardId: id };

  const maxDepth = options.maxDepth ?? DEFAULT_EMBED_DEPTH;
  if (options.depth > maxDepth) return { kind: "stub", reason: "cycle", cardId: id };

  return { kind: "card", cardId: id, depth: options.depth };
}

/** The words a stub shows. Kept here so every surface says the same thing. */
export function embedStubLabel(reason: EmbedStubReason): string {
  switch (reason) {
    case "unset":
      return "No card chosen";
    case "missing":
      return "This card no longer exists";
    case "not-shared":
      return "Not shared with you";
    case "cycle":
      return "This card is already shown above";
  }
}
