import { ANNOTATION_QUOTE_MAX_LENGTH, WorkspaceDocument } from "@suite/graph";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useHighlights } from "./useHighlights";

/**
 * Marking a passage that is too long.
 *
 * The schema caps a quote because a record travels in every snapshot and every share. That cap used to arrive as a
 * thrown parse error inside the palette's click handler: the press did nothing, said nothing, and the reader had no
 * way to tell a bug from a limit. `add` now refuses it and hands back null, and the reader has a sentence to show.
 */
const BOOK = "book-1";

function seed() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const book = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  workspace.ensureAnnotationStyles();
  useCanvasStore.setState({ workspace });
  return { workspace, book };
}

function anchorOf(quote: string) {
  return {
    kind: "quote" as const,
    locator: "OEBPS/text/chapter1.xhtml",
    quote,
    prefix: "",
    suffix: "",
  };
}

beforeEach(() => {
  seed();
});

describe("marking a passage", () => {
  it("should record a passage that fits", () => {
    const { workspace } = seed();
    const { result } = renderHook(() => useHighlights(BOOK));

    const made = result.current.add({ styleId: "style-yellow", anchor: anchorOf("A sentence.") });

    expect(made).not.toBeNull();
    expect(workspace.listAnnotationsOf(BOOK)).toHaveLength(1);
  });

  it("should refuse a passage longer than the schema allows, without throwing", () => {
    const { workspace } = seed();
    const { result } = renderHook(() => useHighlights(BOOK));

    // Exactly at the limit is allowed; one over is refused rather than thrown out of a click handler.
    expect(
      result.current.add({
        styleId: "style-yellow",
        anchor: anchorOf("a".repeat(ANNOTATION_QUOTE_MAX_LENGTH)),
      }),
    ).not.toBeNull();
    expect(
      result.current.add({
        styleId: "style-yellow",
        anchor: anchorOf("a".repeat(ANNOTATION_QUOTE_MAX_LENGTH + 1)),
      }),
    ).toBeNull();
    expect(workspace.listAnnotationsOf(BOOK)).toHaveLength(1);
  });
});
