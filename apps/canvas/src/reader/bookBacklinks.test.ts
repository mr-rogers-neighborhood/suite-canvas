import type { Annotation, Card, CardType } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { type BookBacklinkInput, producedCards, referencingCards } from "./bookBacklinks";

/**
 * What a book is connected to.
 *
 * The relationship that matters is the one promotion writes: a card out of a highlight, pointing back at the book
 * through its `Source` property. It has to be listed once, under "made from this book", and not again as a reference.
 */
const BOOK = "book-1";

function card(id: string, properties: Record<string, string> = {}): Card {
  return {
    id,
    createdAt: 1,
    updatedAt: 1,
    connectors: [],
    typeIds: ["type-note"],
    primaryTypeId: "type-note",
    tags: [],
    properties,
  };
}

function annotation(patch: Partial<Annotation> = {}): Annotation {
  return {
    id: "a1",
    sourceCardId: BOOK,
    styleId: "style-yellow",
    anchor: {
      kind: "quote",
      locator: "chapter1.xhtml",
      quote: "The words.",
      prefix: "",
      suffix: "",
    },
    excerpt: "The words.",
    createdAt: 1,
    ...patch,
  };
}

const types: CardType[] = [
  {
    id: "type-note",
    name: "Note",
    fields: [
      { id: "f-source", name: "Source", kind: "card", order: 0 },
      { id: "f-mentions", name: "Relates to", kind: "card", order: 1 },
      { id: "f-text", name: "Note", kind: "text", order: 2 },
    ],
  },
] as CardType[];

function input(patch: Partial<BookBacklinkInput> = {}): BookBacklinkInput {
  return {
    bookCardId: BOOK,
    annotations: [],
    cards: [],
    types,
    references: {},
    ...patch,
  };
}

describe("a book's backlinks", () => {
  it("should list the card a promotion made, once, even when two highlights share it", () => {
    const annotations = [
      annotation({ id: "a1", cardId: "card-from-a1" }),
      annotation({ id: "a2", cardId: "card-from-a1" }),
    ];
    expect(producedCards(annotations)).toEqual(["card-from-a1"]);
    expect(referencingCards(input({ annotations }))).toEqual([]);
  });

  it("should not count a highlight that was never promoted as a card", () => {
    expect(producedCards([annotation()])).toEqual([]);
  });

  it("should list a card that mentions the book", () => {
    const found = referencingCards(input({ references: { "card-2": [BOOK] } }));
    expect(found).toEqual([{ cardId: "card-2", reason: { kind: "mentions" } }]);
  });

  it("should name the property a card points at the book with", () => {
    const found = referencingCards(input({ cards: [card("card-3", { "f-mentions": BOOK })] }));
    expect(found).toEqual([
      { cardId: "card-3", reason: { kind: "property", fieldName: "Relates to" } },
    ]);
  });

  it("should not list a promoted card a second time under its own source property", () => {
    const annotations = [annotation({ cardId: "card-from-a1" })];
    const found = referencingCards(
      input({ annotations, cards: [card("card-from-a1", { "f-source": BOOK })] }),
    );
    expect(found).toEqual([]);
  });

  it("should never list the book under itself", () => {
    expect(referencingCards(input({ references: { [BOOK]: [BOOK] } }))).toEqual([]);
  });

  it("should list a card once even when it both mentions the book and points at it", () => {
    const found = referencingCards(
      input({
        references: { "card-2": [BOOK] },
        cards: [card("card-2", { "f-mentions": BOOK })],
      }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.reason.kind).toBe("mentions");
  });

  it("should ignore a known property that is not card-valued, whatever it happens to hold", () => {
    const found = referencingCards(input({ cards: [card("card-4", { "f-text": BOOK })] }));
    expect(found).toEqual([]);
  });
});
