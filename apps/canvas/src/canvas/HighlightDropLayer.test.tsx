import { WorkspaceDocument } from "@suite/graph";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useHighlightDrag } from "../reader/highlightDrag";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";

/**
 * Where a carried highlight lands.
 *
 * The board's own React Flow provider is what turns a screen point into a flow point, so it is stubbed here: what is
 * under test is the rule — a release over the canvas promotes at that point, a release anywhere else creates nothing
 * — rather than React Flow's arithmetic.
 */
vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({ screenToFlowPosition: (point: { x: number; y: number }) => point }),
}));

const { HighlightDropLayer } = await import("./HighlightDropLayer");

function seed() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const book = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  workspace.ensureAnnotationStyles();
  const annotation = workspace.addAnnotation({
    sourceCardId: book.id,
    styleId: "style-yellow",
    anchor: { kind: "quote", locator: "1", quote: "A sentence.", prefix: "", suffix: "" },
    excerpt: "A sentence.",
  });
  useCanvasStore.setState({ workspace });
  useUiStore.setState({ activeBoardId: board.id });
  return { workspace, board, annotation };
}

/** A pointer release aimed at whatever element the DOM has at that point. */
function release(point: { x: number; y: number }): void {
  window.dispatchEvent(
    Object.assign(
      new PointerEvent("pointerup", { clientX: point.x, clientY: point.y, bubbles: true }),
    ),
  );
}

beforeEach(() => {
  useHighlightDrag.getState().release();
  document.body.innerHTML = "";
});

describe("dropping a highlight", () => {
  it("should make a card where the release landed on the canvas", async () => {
    const { workspace, board, annotation } = seed();
    const canvas = document.createElement("div");
    canvas.setAttribute("data-testid", "canvas-board");
    document.body.append(canvas);

    useHighlightDrag.getState().carry(annotation.id);
    useHighlightDrag.getState().move({ x: 300, y: 200 });
    render(<HighlightDropLayer />);

    // The release has to be over the canvas for the drop to mean anything. happy-dom has no hit test, so the
    // answer is supplied rather than computed: what is under test is the rule, not the browser's geometry.
    document.elementFromPoint = () => canvas;
    release({ x: 300, y: 200 });

    await waitFor(() => expect(workspace.listCards().length).toBe(2));
    // The card is the one the record points at, not whichever the list happens to end with.
    const cardId = workspace.getAnnotation(annotation.id)?.cardId;
    expect(cardId).toBeDefined();
    expect(workspace.getCard(cardId ?? "")).toBeDefined();
    const placement = workspace.getPlacement(board.id, cardId ?? "");
    expect(placement).toBeDefined();
    // It lands where the pointer was, so the drop is where the reader aimed rather than at the board's centre.
    expect(placement?.x).toBeGreaterThan(0);
    expect(placement?.y).toBeGreaterThan(0);
  });

  it("should create nothing when the release is over the shell", async () => {
    const { workspace, annotation } = seed();
    document.body.append(document.createElement("div"));

    useHighlightDrag.getState().carry(annotation.id);
    useHighlightDrag.getState().move({ x: 10, y: 10 });
    render(<HighlightDropLayer />);

    document.elementFromPoint = () => null;
    release({ x: 10, y: 10 });

    await waitFor(() => expect(useHighlightDrag.getState().carried).toBeNull());
    // A changed mind leaves nothing behind: the highlight is still a highlight.
    expect(workspace.listCards().length).toBe(1);
    expect(workspace.getAnnotation(annotation.id)?.cardId).toBeUndefined();
  });
});
