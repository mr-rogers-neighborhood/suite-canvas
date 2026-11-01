import type { Annotation, PortableNode, WorkspaceDocument } from "@suite/graph";
import { annotationValue, fieldParts, partFor } from "@suite/graph";

/**
 * Turning a highlight into a card.
 *
 * A promoted highlight becomes **an ordinary card in every way**: it can be tagged, retyped, linked, searched and
 * trashed like anything else, because it is anything else.
 *
 * **Promotion writes properties, and the type writes the body.** A type's template card already supplies a body, a
 * title, properties, tags and connectors, and `createCard` copies all of it. Promotion used to write a blockquote and
 * a "From …" paragraph over the top of that, which meant a reader could map a highlight onto a type and then have the
 * type's own template thrown away. So what arrives now is the mapping the reader gave it — a part marked `title` names
 * the card, a part marked `field` fills a property — plus two facts the card could not invent: the read-only
 * `annotation` property, and a `Source` card property naming the book. A type with a template keeps its body; a type
 * without one gets no body, which is what an ordinary new card of that type looks like.
 *
 * **One highlight, one card.** The count used to depend on the mapping — a part marked "a card of its own" made
 * another — which meant one press could produce an unpredictable number of cards and no single gesture could undo it.
 * The destinations are now all places on one card, and a highlight that already has one is never given a second: the
 * press opens the card, or says the card is in the trash.
 */

/**
 * Where a promoted card lands.
 *
 * A board with no point on it is not a placement — it used to write neither, which left the card in the inbox while
 * the caller believed it had put the card on a board. The union makes that call unrepresentable, and the inbox is
 * the only way to say "nowhere yet" — which is the truth, because a card in the reader's hand has no board.
 */
export type Placement =
  | { readonly onBoard: { readonly boardId: string; readonly position: { x: number; y: number } } }
  | { readonly inbox: true };

export interface PromoteInput {
  workspace: WorkspaceDocument;
  annotation: Annotation;
  placement: Placement;
}

export interface PromoteResult {
  /** The card the highlight became: the one its record names. */
  readonly cardId: string;
  /** True when the highlight already had a card and nothing was created. */
  readonly existed: boolean;
  /**
   * True when the card the record names is in the trash.
   *
   * Nothing is created for it. A second card would orphan the link to the first — the record holds one id — and the
   * card the reader already made is still theirs, sitting in the trash with everything they wrote in it.
   */
  readonly trashed: boolean;
  /** The passage had no words to borrow, so the card is titled from its style instead. */
  readonly excerptMissing: boolean;
}

export function promoteAnnotation(input: PromoteInput): PromoteResult | null {
  const { workspace, placement: target } = input;
  // The caller's copy of the record, re-read from the document. A stale object — the one a surface captured when it
  // rendered — has no `cardId`, and a promotion that trusted it would make a second card and overwrite the link to
  // the first. That is the orphaning this rule exists to prevent, so the record is read where it is true.
  const annotation = workspace.getAnnotation(input.annotation.id) ?? input.annotation;

  if (annotation.cardId !== undefined) {
    const existing = workspace.getCard(annotation.cardId);
    if (existing !== undefined && existing.deletedAt == null) {
      return { cardId: existing.id, existed: true, trashed: false, excerptMissing: false };
    }
    if (existing !== undefined) {
      return { cardId: existing.id, existed: true, trashed: true, excerptMissing: false };
    }
    // A record naming a card that no longer exists is a dead link, not a second card: fall through and make one, and
    // the link below replaces the one that cannot resolve.
  }

  const style = workspace.getAnnotationStyle(annotation.styleId);
  const titlePart = partFor(annotation, "title");
  const excerpt = annotation.excerpt ?? null;
  const placement =
    "onBoard" in target
      ? { boardId: target.onBoard.boardId, position: target.onBoard.position }
      : {};
  const fallbackTitle = titleFrom(excerpt ?? style?.name ?? "Highlight");

  // One gesture, one undo step. `createCard`, `setTitleText`, `addField`, `setProperty` and `setAnnotationCard` each
  // commit on their own, and a promotion that took six presses of undo to reverse is exactly the thing the one-card
  // rule was meant to stop.
  const cardId = workspace.batch("annotation:promote", () => {
    // The style's template is how "green highlights become Claim cards" without a branch on a type.
    const card = workspace.createCard({
      ...(style?.templateTypeId === undefined ? {} : { typeId: style.templateTypeId }),
      ...placement,
    });

    // A part the reader mapped to the title wins; otherwise the template's own title stands, because the template is
    // what the reader authored for this kind of card; otherwise the passage's first sentence names it.
    const templateTitle = workspace.cardTitle(card.id).trim();
    if (titlePart !== null) workspace.setTitleText(card.id, titlePart.text);
    else if (templateTitle.length === 0) workspace.setTitleText(card.id, fallbackTitle);

    const fieldId = ensureAnnotationField(workspace, card.primaryTypeId);
    if (fieldId !== null) {
      workspace.setProperty(card.id, fieldId, annotationValue(annotation.id) as never, {
        asApp: true,
      });
    }

    // The backlink. A mention would have worked, but a mention lives in the body and the body now belongs to the
    // template. A card-valued property is the same relationship in the one place the reader can arrange it: the book's
    // Links list shows the card, and the card's shows the book.
    const sourceFieldId = ensureSourceField(workspace, card.primaryTypeId);
    if (sourceFieldId !== null) {
      workspace.setProperty(card.id, sourceFieldId, annotation.sourceCardId);
    }

    // Every part that names a property, placed on this card. A missing property is made here: a recipe has to
    // survive a type change, so it names fields rather than binding to ids.
    for (const entry of fieldParts(annotation)) {
      const target = ensureTextField(workspace, card.primaryTypeId, entry.name);
      if (target !== null) workspace.setProperty(card.id, target, entry.text);
    }

    workspace.setAnnotationCard(annotation.id, card.id);
    return card.id;
  });

  return {
    cardId,
    existed: false,
    trashed: false,
    excerptMissing: excerpt === null && titlePart === null,
  };
}

/**
 * The `annotation` field, added to a type the first time one of its cards is promoted.
 *
 * Added rather than required everywhere: a workspace that never annotates pays nothing, and a type that gains the
 * field shows it on every card of that type, which is the honest trade — a field belongs to a type.
 */
function ensureAnnotationField(workspace: WorkspaceDocument, typeId: string): string | null {
  const type = workspace.getType(typeId);
  if (type === undefined) return null;
  const existing = type.fields.find((field) => field.kind === "annotation");
  if (existing !== undefined) return existing.id;
  try {
    return workspace.addField(typeId, { name: "Highlight", kind: "annotation", readOnly: true }).id;
  } catch {
    // A type whose schema refuses the field is a type with no place for a highlight; the card is still made, and the
    // record still remembers it.
    return null;
  }
}

/**
 * A `card` property naming the book, which is the promoted card's link back to its source.
 *
 * A property rather than a paragraph because the body belongs to the type's template now, and a field is the one place
 * a reader can arrange what a card shows. A `card` kind and not `annotation`: `propertySources` and
 * `outgoingPropertyLinks` read a card-valued property as a link, so the book's Links list shows the card and the card's
 * shows the book. An existing `Source` of another kind is left alone — a text field holding an id would be a link in
 * name only, and overwriting the reader's own field to make one is worse than having none.
 */
function ensureSourceField(workspace: WorkspaceDocument, typeId: string): string | null {
  const type = workspace.getType(typeId);
  if (type === undefined) return null;
  const named = type.fields.find((field) => field.name.trim().toLowerCase() === "source");
  if (named !== undefined) return named.kind === "card" ? named.id : null;
  try {
    return workspace.addField(typeId, { name: "Source", kind: "card" }).id;
  } catch {
    return null;
  }
}

/** A text field by name, made when the type does not have one yet. */
function ensureTextField(
  workspace: WorkspaceDocument,
  typeId: string,
  name: string,
): string | null {
  const type = workspace.getType(typeId);
  if (type === undefined) return null;
  const existing = type.fields.find((field) => field.name.toLowerCase() === name.toLowerCase());
  if (existing !== undefined) return existing.id;
  try {
    return workspace.addField(typeId, { name, kind: "text" }).id;
  } catch {
    return null;
  }
}

/**
 * The source's name, or null when it has none worth printing.
 *
 * `displayTitle` answers "Untitled" for a card with no words, and that is a placeholder for a card, not a name for a
 * book: quoting it would make every passage say `From …, "Untitled"`.
 */
export function sourceTitle(workspace: WorkspaceDocument, annotation: Annotation): string | null {
  const source = workspace.getCard(annotation.sourceCardId);
  if (source === undefined) return null;
  const title = workspace.displayTitle(source.id).trim();
  return title.length === 0 || title === "Untitled" ? null : title;
}

/**
 * The passage as body nodes: the words as a blockquote, then a paragraph naming where they came from.
 *
 * Promotion does not write this any more — the type's template is the body. One place still needs it: **Keep it**,
 * which de-links a card from its highlight and has to leave the reader with the passage that was the whole reason for
 * the card. It is one function rather than two shapes, so a card that keeps its passage reads the same as a card that
 * was promoted before templates existed.
 */
export function passageNodes(
  quote: string | null,
  source: { readonly cardId: string; readonly title: string | null },
): PortableNode[] {
  const nodes: PortableNode[] = [];
  if (quote !== null && quote.trim().length > 0) {
    nodes.push({
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: quote }] }],
    });
  }
  // The mention is always there: it is what makes the backlink a real reference in the graph, and a card whose source
  // has no title still came from somewhere. The title is quoted only when the source has one worth printing.
  nodes.push({
    type: "paragraph",
    content: [
      { type: "text", text: "From " },
      { type: "mention", attrs: { cardId: source.cardId } },
      ...(source.title === null ? [] : [{ type: "text" as const, text: `, “${source.title}”` }]),
    ],
  });
  return nodes;
}

/** A card's title, from the first sentence of the passage and kept short enough to read on one. */
export function titleFrom(text: string): string {
  const trimmed = text.replace(/\s+/gu, " ").trim();
  if (trimmed.length === 0) return "Highlight";
  const sentence = trimmed.split(/(?<=[.!?])\s/u)[0] ?? trimmed;
  return sentence.length <= 60 ? sentence : `${sentence.slice(0, 57)}…`;
}
