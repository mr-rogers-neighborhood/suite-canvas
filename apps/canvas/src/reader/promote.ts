import type { Annotation, PortableNode, WorkspaceDocument } from "@suite/graph";
import { annotationValue } from "@suite/graph";

/**
 * Turning a highlight into a card.
 *
 * A promoted highlight becomes **an ordinary card in every way**: it can be tagged, retyped, linked, searched and
 * trashed like anything else, because it is anything else. The one thing it arrives with is a default, read-only
 * `annotation` property pointing at the record — so the card is never a second copy of the quote, and the anchor
 * stays the truth.
 *
 * The reference back to the source needs no field of its own: the card points at the annotation, the annotation
 * names its source, and the field's face shows both. A comment on a highlight needs no feature either: it is the
 * next block in the body of this card, because the card is an ordinary card.
 */
export interface PromoteInput {
  workspace: WorkspaceDocument;
  annotation: Annotation;
  /** Where the card lands. Absent means the inbox, which is where an unplaced thought belongs. */
  boardId?: string | null;
  position?: { x: number; y: number };
}

export interface PromoteResult {
  readonly cardId: string;
  /** The passage had no words to borrow, so the card is titled from its style instead. */
  readonly excerptMissing: boolean;
}

export function promoteAnnotation({
  workspace,
  annotation,
  boardId = null,
  position,
}: PromoteInput): PromoteResult | null {
  const style = workspace.getAnnotationStyle(annotation.styleId);
  const excerpt = annotation.excerpt ?? null;

  // The style's template is how "green highlights become Claim cards" without a branch on a type: a reader
  // points a colour at a type, and promoting through that colour instantiates it.
  const card = workspace.createCard({
    ...(style?.templateTypeId === undefined ? {} : { typeId: style.templateTypeId }),
    ...(boardId !== null && position !== undefined ? { boardId, position } : {}),
  });

  workspace.setTitleText(card.id, titleFrom(excerpt ?? style?.name ?? "Highlight"));

  // The body opens with the passage, then a paragraph holding the way back to it. A comment on a highlight is the
  // next block after that, which is the whole reason an annotation card is an ordinary card.
  workspace.setBodyNodes(card.id, bodyFor(annotation, sourceTitle(workspace, annotation)));

  const fieldId = ensureAnnotationField(workspace, card.primaryTypeId);
  if (fieldId !== null) {
    workspace.setProperty(card.id, fieldId, annotationValue(annotation.id) as never);
  }
  // The record learns which card it became, which is what lets the book show a passage as already taken out.
  workspace.setAnnotationCard(annotation.id, card.id);

  return { cardId: card.id, excerptMissing: excerpt === null };
}

/**
 * The `annotation` field, added to a type the first time one of its cards is promoted.
 *
 * Added rather than required everywhere: a workspace that never annotates pays nothing, and a type that gains the
 * field shows it on every card of that type — which is the honest trade, because a field belongs to a type.
 */
function ensureAnnotationField(workspace: WorkspaceDocument, typeId: string): string | null {
  const type = workspace.getType(typeId);
  if (type === undefined) return null;
  const existing = type.fields.find((field) => field.kind === "annotation");
  if (existing !== undefined) return existing.id;
  try {
    const added = workspace.addField(typeId, { name: "Highlight", kind: "annotation" });
    return added.id;
  } catch {
    // A type whose schema refuses the field is a type with no place for a highlight; the card is still made,
    // and the record still remembers it.
    return null;
  }
}

/** A card's title, from the first sentence of the passage. */
export function titleFrom(text: string): string {
  const trimmed = text.replace(/\s+/gu, " ").trim();
  if (trimmed.length === 0) return "Highlight";
  const sentence = trimmed.split(/(?<=[.!?])\s/u)[0] ?? trimmed;
  return sentence.length <= 60 ? sentence : `${sentence.slice(0, 57)}…`;
}

/** The title of the source, or null when it has none to show. */
function sourceTitle(workspace: WorkspaceDocument, annotation: Annotation): string | null {
  const source = workspace.getCard(annotation.sourceCardId);
  if (source === undefined) return null;
  return workspace.displayTitle(source.id) || null;
}

/**
 * What a promoted card says.
 *
 * The quote as a blockquote, then one paragraph naming where it came from. The paragraph carries the source's own
 * card as a mention, so the reference is a real backlink in the graph rather than a second kind of link: the book
 * knows which cards came out of it, and the card knows which book it came from, through one mechanism.
 */
function bodyFor(annotation: Annotation, source: string | null): PortableNode[] {
  const quote = annotation.excerpt ?? "";
  const paragraph: PortableNode = {
    type: "paragraph",
    content: [
      { type: "text", text: annotation.anchor.kind === "time" ? "From the recording" : "From" },
    ],
  };
  const nodes: PortableNode[] = [];
  if (quote.length > 0) {
    nodes.push({
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: quote }] }],
    });
  }
  if (source !== null) {
    paragraph.content = [
      ...(paragraph.content ?? []),
      { type: "text", text: ` “${source}”, ` },
      { type: "mention", attrs: { cardId: annotation.sourceCardId } },
    ];
  }
  nodes.push(paragraph);
  return nodes;
}
