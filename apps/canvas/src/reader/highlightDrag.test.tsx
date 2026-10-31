import { WorkspaceDocument } from "@suite/graph";
import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useHighlightDrag } from "./highlightDrag";

/**
 * Is a press on a mark a press or a drag?
 *
 * The rule is the one every hold-to-place gesture in the app uses: travel past a threshold makes it a drag, and a
 * press that never travelled stays a press. A promotion must not happen because a reader clicked a highlight they
 * had already promoted.
 */
describe("carrying a highlight", () => {
  beforeEach(() => {
    useHighlightDrag.getState().release();
    const doc = new WorkspaceDocument();
    doc.ensureDefaultTypes();
    doc.ensureBoard();
    useCanvasStore.setState({ workspace: doc });
  });

  it("should start with nothing in hand", () => {
    expect(useHighlightDrag.getState().carried).toBeNull();
    expect(useHighlightDrag.getState().screen).toBeNull();
  });

  it("should remember what is carried and where the pointer is", () => {
    useHighlightDrag.getState().carry("annotation-1");
    useHighlightDrag.getState().move({ x: 40, y: 60 });

    expect(useHighlightDrag.getState().carried).toEqual({ annotationId: "annotation-1" });
    expect(useHighlightDrag.getState().screen).toEqual({ x: 40, y: 60 });
  });

  it("should forget both on release, so a cancelled drag leaves nothing behind", () => {
    useHighlightDrag.getState().carry("annotation-1");
    useHighlightDrag.getState().move({ x: 40, y: 60 });
    useHighlightDrag.getState().release();

    expect(useHighlightDrag.getState().carried).toBeNull();
    expect(useHighlightDrag.getState().screen).toBeNull();
  });

  it("should be the only state a drag adds, so a press that never travels creates nothing", () => {
    // Nothing is created on the press: the promotion happens in the drop layer, on a release over the canvas. This
    // asserts the state the two sides agree through, which is why a cancelled drag cannot leave a card behind.
    const before = useCanvasStore.getState().workspace?.listCards().length ?? 0;
    useHighlightDrag.getState().carry("annotation-1");
    expect(useCanvasStore.getState().workspace?.listCards().length).toBe(before);
  });
});
