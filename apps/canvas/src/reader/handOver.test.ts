import { WorkspaceDocument } from "@suite/graph";
import { afterEach, describe, expect, it } from "vitest";
import { usePlaceStackStore } from "../canvas/placeStack";
import { handOverHighlight } from "./handOver";

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

  it("should leave the card in the inbox when the reader may not place anything", () => {
    const { workspace, annotation } = fixture();
    const outcome = handOverHighlight({ workspace, annotation, canEditPlacement: false });

    expect(outcome?.inHand).toBe(false);
    expect(outcome?.cardId).toBeDefined();
    expect(usePlaceStackStore.getState().queue).toEqual([]);
  });
});
