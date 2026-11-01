import type { Annotation, Card, CardType } from "@suite/graph";
import { incomingReferences, propertySources } from "@suite/graph";

/**
 * What a book is connected to, both ways round.
 *
 * A book card is unusual: cards come *out* of it that nothing else records. A promoted card points back at the book
 * through its `Source` property, which is what makes the relationship findable at all, and the rows a reader wants when
 * they open a book are "what did I make from this" and "what else talks about it".
 *
 * Pure: ids and reasons out, titles are the caller's, because a card's text lives in the document rather than in the
 * snapshot.
 */
export type BacklinkReason =
  /** A card some highlight in this book was promoted into. */
  | { readonly kind: "produced" }
  /** A card that mentions this book in its body. */
  | { readonly kind: "mentions" }
  /** A card whose `card` property points at this book, and the property it is. */
  | { readonly kind: "property"; readonly fieldName: string };

export interface BookBacklink {
  readonly cardId: string;
  readonly reason: BacklinkReason;
}

export interface BookBacklinkInput {
  readonly bookCardId: string;
  readonly annotations: readonly Annotation[];
  readonly cards: readonly Card[];
  readonly types?: readonly CardType[];
  readonly references: Readonly<Record<string, readonly string[]>>;
}

/**
 * Cards made from this book, in the order they were marked.
 *
 * Read from the highlights rather than from the references, because a promotion is what "made from" means here: two
 * highlights that share one card are one card, and the first mention of it is where it sits.
 */
export function producedCards(annotations: readonly Annotation[]): string[] {
  const seen = new Set<string>();
  for (const annotation of annotations) {
    if (annotation.cardId !== undefined) seen.add(annotation.cardId);
  }
  return [...seen];
}

/** Everything else that points here: mentions, then card-valued properties, de-duplicated and never the book itself. */
export function referencingCards(input: BookBacklinkInput): BookBacklink[] {
  const produced = new Set(producedCards(input.annotations));
  const out: BookBacklink[] = [];
  const seen = new Set<string>();
  for (const cardId of incomingReferences(input.bookCardId, input.references)) {
    if (cardId === input.bookCardId || produced.has(cardId) || seen.has(cardId)) continue;
    seen.add(cardId);
    out.push({ cardId, reason: { kind: "mentions" } });
  }
  for (const source of propertySources(input.bookCardId, input.cards, input.types ?? [])) {
    // A promoted card already points here through its `Source` property, and listing it twice would read as two cards.
    if (
      source.cardId === input.bookCardId ||
      produced.has(source.cardId) ||
      seen.has(source.cardId)
    ) {
      continue;
    }
    seen.add(source.cardId);
    out.push({ cardId: source.cardId, reason: { kind: "property", fieldName: source.fieldName } });
  }
  return out;
}
