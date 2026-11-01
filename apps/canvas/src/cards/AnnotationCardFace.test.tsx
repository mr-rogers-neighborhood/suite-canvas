import type { Card } from "@suite/graph";
import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { promoteAnnotation } from "../reader/promote";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { AnnotationCardFace } from "./AnnotationCardFace";

/**
 * A card that came out of a book.
 *
 * The card is an ordinary card — that is the whole design — so the face is a strip *over* the writing rather than a
 * replacement for it: the passage it came from, the kind's colour, the way back, and the way out. Taking the way out
 * has to leave a card the reader owns and a highlight that can produce another one.
 */
let workspace: WorkspaceDocument;
let card: Card;
let annotationId: string;

beforeEach(() => {
  workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const book = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  workspace.setTitleText(book.id, "A Small Book");
  workspace.ensureAnnotationStyles();
  const annotation = workspace.addAnnotation({
    sourceCardId: book.id,
    styleId: "style-yellow",
    anchor: {
      kind: "quote",
      locator: "2",
      quote: "The sentence that mattered.",
      prefix: "",
      suffix: "",
    },
    excerpt: "The sentence that mattered.",
  });
  annotationId = annotation.id;
  const promoted = promoteAnnotation({
    workspace,
    annotation,
    placement: { inbox: true },
  });
  const made = workspace.getCard(promoted?.cardId ?? "");
  if (made === undefined) throw new Error("no card");
  card = made;
  useCanvasStore.setState({ workspace });
  useUiStore.setState({ cardFocusId: null });
});

describe("the annotation on a card", () => {
  it("should show the passage and where it came from", () => {
    render(<AnnotationCardFace card={card} />);
    expect(screen.getByTestId("annotation-strip-passage")).toHaveTextContent(
      "The sentence that mattered.",
    );
    expect(screen.getByText("A Small Book")).toBeInTheDocument();
  });

  it("should go back to the book the passage is in", () => {
    render(<AnnotationCardFace card={card} />);
    fireEvent.click(screen.getByTestId("annotation-strip-reopen"));
    expect(useUiStore.getState().cardFocusId).toBe(
      workspace.getAnnotation(annotationId)?.sourceCardId,
    );
  });

  it("should write the passage into the body when the reader keeps the card", async () => {
    render(<AnnotationCardFace card={card} />);
    fireEvent.click(screen.getByTestId("annotation-strip-keep"));

    await waitFor(() => expect(workspace.getAnnotation(annotationId)?.cardId).toBeUndefined());
    // The card is still a card, and the passage is now in it: promotion writes no body, so de-linking is the moment
    // the words have to be handed over. They arrive as the blockquote a promoted card used to open with.
    const kept = workspace.getCard(card.id);
    expect(kept).toBeDefined();
    const nodes = workspace.bodyNodes(card.id);
    expect(nodes[0]?.type).toBe("blockquote");
    expect(nodes[0]?.content?.[0]?.content?.[0]).toEqual({
      type: "text",
      text: "The sentence that mattered.",
    });
    // And the way back is a real reference, not a sentence: a mention of the book.
    expect(nodes[1]?.content?.some((node) => node.type === "mention")).toBe(true);
  });

  it("should clear the read-only property, and leave the passage alone when undone", async () => {
    render(<AnnotationCardFace card={card} />);
    fireEvent.click(screen.getByTestId("annotation-strip-keep"));

    await waitFor(() => expect(workspace.getAnnotation(annotationId)?.cardId).toBeUndefined());
    const field = workspace
      .getType(card.primaryTypeId)
      ?.fields.find((entry) => entry.kind === "annotation");
    expect(workspace.getCard(card.id)?.properties[field?.id ?? ""]).toBeUndefined();

    // One gesture, one undo step: the body, the link and the field come back together.
    workspace.undo();
    expect(workspace.getAnnotation(annotationId)?.cardId).toBe(card.id);
    expect(workspace.bodyNodes(card.id)).toEqual([]);
  });

  it("should draw nothing for a card that never came from a book", () => {
    const plain = workspace.createCard({ boardId: workspace.listBoards()[0]?.id ?? "" });
    const { container } = render(<AnnotationCardFace card={plain} />);
    expect(container).toBeEmptyDOMElement();
  });
});
