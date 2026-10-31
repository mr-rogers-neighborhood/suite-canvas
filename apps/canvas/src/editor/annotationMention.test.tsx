import { RICH_TEXT_NODE_ATTRIBUTE_NAMES, WorkspaceDocument } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { workspaceSnapshotStore } from "../store/workspaceSnapshotStore";
import { rankItems } from "./SuggestionList";

/**
 * A mention of a highlight.
 *
 * Two things can go wrong without a test: the picker never offers one, and publishing rejects the document because the
 * validator does not know the attribute. Both are checked here rather than discovered in a share.
 */
function seed() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const host = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const book = workspace.createCard({ boardId: board.id, position: { x: 300, y: 0 } });
  workspace.ensureAnnotationStyles();
  const annotation = workspace.addAnnotation({
    sourceCardId: book.id,
    styleId: "style-yellow",
    anchor: {
      kind: "quote",
      locator: "1",
      quote: "The domain is what we call it.",
      prefix: "",
      suffix: "",
    },
    excerpt: "The domain is what we call it.",
  });
  useCanvasStore.setState({ workspace });
  workspaceSnapshotStore(workspace).refresh();
  return { workspace, host, book, annotation };
}

describe("mentioning a highlight", () => {
  it("should be offered by the picker, above the cards", () => {
    const { annotation } = seed();
    const items = rankItems("domain");

    const found = items.find((item) => item.kind === "annotation");
    expect(found?.annotationId).toBe(annotation.id);
    expect(found?.title).toContain("The domain");
  });

  it("should not appear when the query does not match the words", () => {
    seed();
    expect(rankItems("zzzz").some((item) => item.kind === "annotation")).toBe(false);
  });

  it("should be legal in a published document, which is the validator's call", () => {
    // A node attribute the validator does not know rejects the whole publish, and a mention of a highlight is one.
    expect(RICH_TEXT_NODE_ATTRIBUTE_NAMES.mention).toContain("annotationId");
  });
});
