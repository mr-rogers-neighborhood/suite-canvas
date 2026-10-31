import type { WorkspaceDocument } from "@suite/graph";

/** What a mention node names: a card, or a highlight, or neither. */
export interface MentionAttrs {
  readonly cardId?: string | undefined;
  readonly annotationId?: string | undefined;
}

/**
 * A mention's words, resolved against the document.
 *
 * The unfocused card is a static face, not an editor: it has no node views, so it cannot ask a card for its title the
 * way `CardMentionChip` does. It used to fall back to the raw `cardId`, which is how a promoted highlight showed
 * `@a3f9…` until you clicked into it. This is the one resolver the static faces share, so the two renders of the same
 * body agree.
 *
 * Returns `null` when it has no opinion, which is how the caller knows to fall back to whatever the node stored. That
 * happens in a projection or a story, where there is no document to ask.
 */
export type MentionLabel = (attrs: MentionAttrs) => string | null;

/** The words a passage is known by: its excerpt, then the quote itself, shortened for a chip. */
function passageWords(annotation: {
  excerpt?: string | undefined;
  anchor: { kind: string; quote?: string };
}): string {
  const raw =
    annotation.excerpt ??
    (annotation.anchor.kind === "quote" ? (annotation.anchor.quote ?? "") : "");
  const words = raw.replace(/\s+/gu, " ").trim();
  if (words.length === 0) return "A passage";
  return words.length <= 40 ? words : `${words.slice(0, 39)}…`;
}

export function mentionLabelIn(workspace: WorkspaceDocument | null): MentionLabel {
  return (attrs) => {
    if (workspace === null) return null;

    const annotationId = attrs.annotationId ?? "";
    if (annotationId.length > 0) {
      const annotation = workspace.getAnnotation(annotationId);
      return annotation === undefined ? "Unavailable passage" : passageWords(annotation);
    }

    const cardId = attrs.cardId ?? "";
    if (cardId.length === 0) return null;
    const card = workspace.getCard(cardId);
    if (card !== undefined) {
      // A trashed card is a reference to something the reader put away, which is what the editor's chip says too.
      return workspace.isTrashed(cardId) ? "Unavailable card" : workspace.displayTitle(cardId);
    }
    // A projection stub is a reference the reader may keep but not open: it has a name and no card.
    if (workspace.hasTitle(cardId)) return workspace.displayTitle(cardId);
    return "Unavailable card";
  };
}
