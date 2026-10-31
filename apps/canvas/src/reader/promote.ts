import type { Annotation, AnnotationPart, PortableNode, WorkspaceDocument } from "@suite/graph";
import { annotationValue, fieldParts, partFor } from "@suite/graph";

/**
 * Turning a highlight into a card — or into the cards a reader broke it into.
 *
 * A promoted highlight becomes **an ordinary card in every way**: it can be tagged, retyped, linked, searched and
 * trashed like anything else, because it is anything else. What it arrives with is the mapping the reader gave it: a
 * part marked `title` names the card, a part marked `field` fills a property, and a part marked `own-card` becomes a
 * card of its own. Everything else stays in the passage.
 *
 * The reference back to the source needs no field of its own: the card points at the annotation, the annotation names
 * its source. A comment on a highlight needs no feature either, because the card is an ordinary card.
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
  /**
   * Make another card even though this highlight already has one.
   *
   * Off by default, and that is a rule rather than a preference: a press on a highlight that already came out of the
   * book should take the reader to *that* card, not silently make a second one and orphan the first from its record.
   */
  again?: boolean;
}

export interface PromoteResult {
  /** The highlight's primary card: the one its record names. */
  readonly cardId: string;
  /** Cards made by `own-card` parts, in reading order. */
  readonly ownCardIds: readonly string[];
  /** True when the highlight already had a card and nothing was created. */
  readonly existed: boolean;
  /** The passage had no words to borrow, so the card is titled from its style instead. */
  readonly excerptMissing: boolean;
}

export function promoteAnnotation(input: PromoteInput): PromoteResult | null {
  const { workspace, annotation, placement: target, again = false } = input;

  if (!again && annotation.cardId !== undefined) {
    const existing = workspace.getCard(annotation.cardId);
    if (existing !== undefined && existing.deletedAt == null) {
      return { cardId: existing.id, ownCardIds: [], existed: true, excerptMissing: false };
    }
  }

  const style = workspace.getAnnotationStyle(annotation.styleId);
  const titlePart = partFor(annotation, "title");
  const excerpt = annotation.excerpt ?? null;
  const placement =
    "onBoard" in target
      ? { boardId: target.onBoard.boardId, position: target.onBoard.position }
      : {};

  const make = (title: string, quote: string | null): string => {
    // The style's template is how "green highlights become Claim cards" without a branch on a type.
    const card = workspace.createCard({
      ...(style?.templateTypeId === undefined ? {} : { typeId: style.templateTypeId }),
      ...placement,
    });
    workspace.setTitleText(card.id, title);

    const fieldId = ensureAnnotationField(workspace, card.primaryTypeId);
    if (fieldId !== null) {
      workspace.setProperty(card.id, fieldId, annotationValue(annotation.id) as never, {
        asApp: true,
      });
    }
    workspace.setBodyNodes(card.id, bodyFor(quote, sourceTitle(workspace, annotation), annotation));

    // Every part that names a property, placed on this card. A missing property is made here: a recipe has to
    // survive a type change, so it names fields rather than binding to ids.
    for (const entry of fieldParts(annotation)) {
      const target = ensureTextField(workspace, card.primaryTypeId, entry.name);
      if (target !== null) workspace.setProperty(card.id, target, entry.text);
    }
    return card.id;
  };

  const title = titlePart?.text ?? titleFrom(excerpt ?? style?.name ?? "Highlight");
  const cardId = make(title, excerpt);
  workspace.setAnnotationCard(annotation.id, cardId);

  // A part the reader marked `own card` becomes one, and it points at the same highlight: several cards from one
  // passage are found by their property rather than by a second list.
  const ownCardIds = partsOfKind(annotation, "own-card").map((text) => make(titleFrom(text), text));

  return {
    cardId,
    ownCardIds,
    existed: false,
    excerptMissing: excerpt === null && titlePart === null,
  };
}

/** The text of every part with one target kind, in reading order. */
function partsOfKind(annotation: Annotation, kind: AnnotationPart["target"]["kind"]): string[] {
  const parts = annotation.anchor.kind === "quote" ? (annotation.parts ?? []) : [];
  return [...parts]
    .sort((a, b) => a.start - b.start)
    .filter((part) => part.target.kind === kind)
    .map((part) =>
      annotation.anchor.kind === "quote" ? annotation.anchor.quote.slice(part.start, part.end) : "",
    )
    .filter((text) => text.trim().length > 0);
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
 * book: quoting it would make every promoted card say `From …, "Untitled"`.
 */
function sourceTitle(workspace: WorkspaceDocument, annotation: Annotation): string | null {
  const source = workspace.getCard(annotation.sourceCardId);
  if (source === undefined) return null;
  const title = workspace.displayTitle(source.id).trim();
  return title.length === 0 || title === "Untitled" ? null : title;
}

/**
 * What a promoted card says.
 *
 * The passage as a blockquote — the whole quote, even when parts carved pieces out of it, because the passage is what
 * was marked and a card that silently dropped the rest would be a card about a sentence nobody can find again — then
 * one paragraph naming where it came from. The paragraph carries the source's own card as a mention, so the reference
 * is a real backlink in the graph rather than a second kind of link.
 */
function bodyFor(
  quote: string | null,
  source: string | null,
  annotation: Annotation,
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
  const paragraph: PortableNode = {
    type: "paragraph",
    content: [
      { type: "text", text: "From " },
      { type: "mention", attrs: { cardId: annotation.sourceCardId } },
      ...(source === null ? [] : [{ type: "text" as const, text: `, “${source}”` }]),
    ],
  };
  nodes.push(paragraph);
  return nodes;
}

/** A card's title, from the first sentence of the passage and kept short enough to read on one. */
export function titleFrom(text: string): string {
  const trimmed = text.replace(/\s+/gu, " ").trim();
  if (trimmed.length === 0) return "Highlight";
  const sentence = trimmed.split(/(?<=[.!?])\s/u)[0] ?? trimmed;
  return sentence.length <= 60 ? sentence : `${sentence.slice(0, 57)}…`;
}
