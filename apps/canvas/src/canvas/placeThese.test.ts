import { WorkspaceDocument } from "@suite/graph";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePlaceStackStore } from "./placeStack";
import { placeThese } from "./placeThese";

/**
 * Putting cards into the reader's hand.
 *
 * The library's Place cards and a book's Place N are the same gesture, and they grew separately: the library filtered by
 * the board being looked at and closed its drawer, the book promoted highlights and then started a stack. This is the one
 * implementation, so "what happens when I place" has one answer.
 */
let workspace: WorkspaceDocument;
let board: { id: string };
let cardIds: string[];

beforeEach(() => {
  workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  board = workspace.ensureBoard();
  cardIds = ["One", "Two", "Three"].map((title) => {
    const card = workspace.createCard();
    workspace.setTitleText(card.id, title);
    return card.id;
  });
});

afterEach(() => {
  usePlaceStackStore.getState().stop();
});

describe("placing a set of cards", () => {
  it("should put them in the hand in the order given", () => {
    const outcome = placeThese({ workspace, cardIds, boardId: board.id, canEditPlacement: true });

    expect(outcome.inHand).toBe(true);
    expect(usePlaceStackStore.getState().queue).toEqual(cardIds);
  });

  it("should skip a card already on this board, and keep one that is on another", () => {
    workspace.placeCard(board.id, cardIds[0] as string, { x: 0, y: 0 });
    const elsewhere = workspace.createBoard({ name: "Elsewhere" });
    workspace.placeCard(elsewhere.id, cardIds[1] as string, { x: 0, y: 0 });

    const outcome = placeThese({ workspace, cardIds, boardId: board.id, canEditPlacement: true });

    // The first is already here; the second is only somewhere else, so it is still placeable here.
    expect(outcome.cardIds).toEqual([cardIds[1], cardIds[2]]);
  });

  it("should add to a stack already in hand rather than replacing it", () => {
    placeThese({
      workspace,
      cardIds: [cardIds[0] as string],
      boardId: board.id,
      canEditPlacement: true,
    });
    placeThese({
      workspace,
      cardIds: [cardIds[1] as string],
      boardId: board.id,
      canEditPlacement: true,
    });

    // A second Place before anything is put down adds, which is what a reader means by pressing it again.
    expect(usePlaceStackStore.getState().queue).toEqual([cardIds[0], cardIds[1]]);
  });

  it("should carry the book a stack came from, so running out offers the way back", () => {
    placeThese({
      workspace,
      cardIds: [cardIds[0] as string],
      boardId: board.id,
      fromBook: "a-book",
      canEditPlacement: true,
    });
    expect(usePlaceStackStore.getState().fromBook).toBe("a-book");
  });

  it("should seed the anchor a fan keeps", () => {
    placeThese({
      workspace,
      cardIds,
      boardId: board.id,
      anchorId: cardIds[2] as string,
      canEditPlacement: true,
    });
    expect(usePlaceStackStore.getState().anchorId).toBe(cardIds[2]);
  });

  it("should hand nothing over for a reader who may not place, though the cards exist", () => {
    const outcome = placeThese({ workspace, cardIds, boardId: board.id, canEditPlacement: false });

    expect(outcome.inHand).toBe(false);
    expect(outcome.cardIds).toHaveLength(3);
    expect(usePlaceStackStore.getState().queue).toEqual([]);
  });

  it("should not put the same card in twice", () => {
    const outcome = placeThese({
      workspace,
      cardIds: [cardIds[0] as string, cardIds[0] as string],
      boardId: board.id,
      canEditPlacement: true,
    });
    expect(outcome.cardIds).toEqual([cardIds[0]]);
  });
});
