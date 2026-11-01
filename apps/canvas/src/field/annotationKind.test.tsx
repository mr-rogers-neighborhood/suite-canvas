import { WorkspaceDocument } from "@suite/graph";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { promoteAnnotation } from "../reader/promote";
import { useCanvasStore } from "../store/useCanvasStore";
import { AnnotationField } from "./annotationKind";

/**
 * The `Highlight` field's face.
 *
 * `PropertyField` used to return a formatted string for every read-only field before it consulted the kind registry, so
 * a `Highlight` block in a body printed the placeholder word. The value is a passage; the face had to draw it, and it
 * draws the same component the card's header draws so a template can own the quotation.
 */
let workspace: WorkspaceDocument;
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
      locator: "OEBPS/text/chapter1.xhtml",
      quote: "The sentence that mattered, in full, with the clause that made it worth marking.",
      prefix: "",
      suffix: "",
    },
    excerpt: "The sentence that mattered, in full, with the clause that made it worth marking.",
  });
  annotationId = annotation.id;
  promoteAnnotation({ workspace, annotation, placement: { inbox: true } });
  useCanvasStore.setState({ workspace });
});

describe("the highlight field", () => {
  it("should draw the whole passage, not a placeholder", () => {
    render(<AnnotationField value={{ annotationId }} />);

    // The whole sentence: a two-line clamp here is what made the one place the passage belongs the one that cropped it.
    expect(screen.getByTestId("annotation-passage-words")).toHaveTextContent(
      "with the clause that made it worth marking.",
    );
  });

  it("should say which kind it is and which book it came from", () => {
    render(<AnnotationField value={{ annotationId }} />);
    expect(screen.getByTestId("annotation-passage")).toHaveTextContent("Important from");
    expect(screen.getByTestId("annotation-passage")).toHaveTextContent("A Small Book");
  });

  it("should say the passage is gone rather than drawing an empty one", () => {
    workspace.deleteAnnotation(annotationId);
    render(<AnnotationField value={{ annotationId }} />);
    expect(screen.getByTestId("annotation-missing")).toBeInTheDocument();
  });

  it("should draw nothing for a card with no value at all", () => {
    render(<AnnotationField value={undefined} />);
    expect(screen.getByTestId("annotation-missing")).toBeInTheDocument();
  });
});
