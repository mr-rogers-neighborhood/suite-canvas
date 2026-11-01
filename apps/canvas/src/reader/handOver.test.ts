import { WorkspaceDocument } from "@suite/graph";
import { afterEach, describe, expect, it } from "vitest";
import { usePlaceStackStore } from "../canvas/placeStack";
import { handOverHighlight, handOverHighlights } from "./handOver";

/**
 * Putting a highlight on the board.
 *
 * The bug this pins down: `Place` used to name a board and no point, so the card was made and written nowhere — it
 * belonged to the inbox and the board showed nothing at all. A second press then found the card and "opened" it, which
 * looks exactly like a dead button. The card now goes into the reader's hand, which is the pattern the library already
 * uses for a stack, and the next press puts it down.
 */
function fixture() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const book = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  workspace.ensureAnnotationStyles();
  const annotation = workspace.addAnnotation({
    sourceCardId: book.id,
    styleId: "style-yellow",
    anchor: {
      kind: "quote",
      locator: "2",
      quote: "The words.",
      prefix: "Before. ",
      suffix: " After.",
    },
    excerpt: "The words.",
  });
  return { workspace, board, book, annotation };
}

afterEach(() => {
  usePlaceStackStore.getState().stop();
});

describe("handing a highlight over", () => {
  it("should make the card and put it in the reader's hand", () => {
    const { workspace, annotation } = fixture();
    const outcome = handOverHighlight({ workspace, annotation, canEditPlacement: true });

    expect(outcome?.cardId).toBeDefined();
    expect(outcome?.inHand).toBe(true);
    // The card is real and it is not on a board yet: the press that follows is what places it.
    expect(workspace.getCard(outcome?.cardId ?? "")).toBeDefined();
    expect(workspace.listCardPlacements(outcome?.cardId ?? "")).toHaveLength(0);
    expect(usePlaceStackStore.getState().queue).toEqual([outcome?.cardId]);
  });

  it("should add to a hand that is already full rather than replacing it", () => {
    const { workspace, annotation } = fixture();
    const second = workspace.addAnnotation({
      sourceCardId: annotation.sourceCardId,
      styleId: "style-yellow",
      anchor: { kind: "quote", locator: "3", quote: "More words.", prefix: "", suffix: "" },
      excerpt: "More words.",
    });

    const first = handOverHighlight({ workspace, annotation, canEditPlacement: true });
    handOverHighlight({ workspace, annotation: second, canEditPlacement: true });

    expect(usePlaceStackStore.getState().queue).toEqual([first?.cardId, expect.any(String)]);
    expect(usePlaceStackStore.getState().queue).toHaveLength(2);
  });

  it("should hand back the card a highlight already has instead of making a second one", () => {
    const { workspace, annotation } = fixture();
    const first = handOverHighlight({ workspace, annotation, canEditPlacement: true });
    usePlaceStackStore.getState().stop();

    const again = handOverHighlight({
      workspace,
      annotation: workspace.getAnnotation(annotation.id) ?? annotation,
      canEditPlacement: true,
    });

    expect(again?.existed).toBe(true);
    expect(again?.cardId).toBe(first?.cardId);
    expect(again?.inHand).toBe(true);
    expect(usePlaceStackStore.getState().queue).toEqual([first?.cardId]);
  });

  it("should send the reader to a card that is already on a board", () => {
    const { workspace, board, annotation } = fixture();
    const first = handOverHighlight({ workspace, annotation, canEditPlacement: true });
    workspace.placeCard(board.id, first?.cardId ?? "", { x: 20, y: 20 });
    usePlaceStackStore.getState().stop();

    const again = handOverHighlight({
      workspace,
      annotation: workspace.getAnnotation(annotation.id) ?? annotation,
      canEditPlacement: true,
    });

    expect(again?.placedAlready).toBe(true);
    expect(again?.inHand).toBe(false);
    expect(usePlaceStackStore.getState().queue).toEqual([]);
  });

  it("should carry nothing when the highlight's card is in the trash", () => {
    const { workspace, annotation } = fixture();
    const first = handOverHighlight({ workspace, annotation, canEditPlacement: true });
    usePlaceStackStore.getState().stop();
    workspace.trashCard(first?.cardId ?? "");

    const again = handOverHighlight({
      workspace,
      annotation: workspace.getAnnotation(annotation.id) ?? annotation,
      canEditPlacement: true,
    });

    // Nothing in hand: a trashed card has no placement, so putting it down would contradict the library.
    expect(again?.trashed).toBe(true);
    expect(again?.inHand).toBe(false);
    expect(again?.cardId).toBe(first?.cardId);
    expect(usePlaceStackStore.getState().queue).toEqual([]);
  });

  it("should leave the card in the inbox when the reader may not place anything", () => {
    const { workspace, annotation } = fixture();
    const outcome = handOverHighlight({ workspace, annotation, canEditPlacement: false });

    expect(outcome?.inHand).toBe(false);
    expect(outcome?.cardId).toBeDefined();
    expect(usePlaceStackStore.getState().queue).toEqual([]);
  });
});

describe("handing several highlights over", () => {
  /** Three highlights in one book, which is the shape the outline's picker produces. */
  function three() {
    const { workspace, board, book, annotation } = fixture();
    const second = workspace.addAnnotation({
      sourceCardId: book.id,
      styleId: "style-blue",
      anchor: { kind: "quote", locator: "2", quote: "More words.", prefix: "", suffix: "" },
      excerpt: "More words.",
    });
    const third = workspace.addAnnotation({
      sourceCardId: book.id,
      styleId: "style-green",
      anchor: { kind: "quote", locator: "2", quote: "Last words.", prefix: "", suffix: "" },
      excerpt: "Last words.",
    });
    return { workspace, board, book, annotations: [annotation, second, third] };
  }

  it("should put every card in one hand, in the order given", () => {
    const { workspace, annotations } = three();
    const outcome = handOverHighlights({
      workspace,
      annotations,
      canEditPlacement: true,
    });

    expect(outcome.inHand).toBe(true);
    expect(outcome.cardIds).toHaveLength(3);
    // One press each, in the order the reader ticked: that is the sequence they chose.
    expect(usePlaceStackStore.getState().queue).toEqual(outcome.cardIds);
  });

  it("should reuse the card a highlight already has rather than making a second", () => {
    const { workspace, annotations } = three();
    const first = handOverHighlight({
      workspace,
      annotation: annotations[0] as (typeof annotations)[number],
      canEditPlacement: false,
    });
    usePlaceStackStore.getState().stop();

    const outcome = handOverHighlights({
      workspace,
      annotations: [annotations[0] as (typeof annotations)[number]],
      canEditPlacement: true,
    });

    expect(outcome.existed).toBe(1);
    expect(outcome.cardIds).toEqual([first.cardId]);
  });

  it("should skip a highlight whose card is in the trash, and say how many", () => {
    const { workspace, annotations } = three();
    const doomed = handOverHighlight({
      workspace,
      annotation: annotations[1] as (typeof annotations)[number],
      canEditPlacement: false,
    });
    usePlaceStackStore.getState().stop();
    workspace.trashCard(doomed.cardId);

    const outcome = handOverHighlights({
      workspace,
      annotations,
      canEditPlacement: true,
    });

    expect(outcome.trashed).toBe(1);
    expect(outcome.cardIds).toHaveLength(2);
    expect(outcome.cardIds).not.toContain(doomed.cardId);
  });

  it("should not carry a card that is already on the board", () => {
    const { workspace, board, annotations } = three();
    const placed = handOverHighlight({
      workspace,
      annotation: annotations[0] as (typeof annotations)[number],
      canEditPlacement: false,
    });
    workspace.placeCard(board.id, placed.cardId, { x: 10, y: 10 });
    usePlaceStackStore.getState().stop();

    const outcome = handOverHighlights({ workspace, annotations, canEditPlacement: true });

    // The gesture is about the ones that are not there yet.
    expect(outcome.cardIds).not.toContain(placed.cardId);
    expect(outcome.cardIds).toHaveLength(2);
  });

  it("should hand nothing over for a reader who may not place", () => {
    const { workspace, annotations } = three();
    const outcome = handOverHighlights({ workspace, annotations, canEditPlacement: false });

    expect(outcome.inHand).toBe(false);
    // The cards exist: they are in the inbox, which is what "saved" means for a read-only board.
    expect(outcome.cardIds).toHaveLength(3);
    expect(usePlaceStackStore.getState().queue).toEqual([]);
  });
});
