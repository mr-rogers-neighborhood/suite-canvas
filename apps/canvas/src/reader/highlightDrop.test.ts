import { afterEach, describe, expect, it, vi } from "vitest";
import { beginHighlightDrag, useHighlightDrag } from "./highlightDrag";
import { dropHighlight, registerHighlightDropper } from "./highlightDrop";

/**
 * One release, one decision.
 *
 * Every surface that carries a highlight — the reader's own marks, the book's outline, the library's rows — ends its
 * gesture the same way: through `dropHighlight`, which the board answers. Before this the reader's `pointerup` and the
 * drop layer's `pointerup` both fired, and which one won decided whether the highlight became a card. On a fast release
 * the highlight simply vanished.
 */
afterEach(() => {
  useHighlightDrag.getState().release();
  registerHighlightDropper(() => {});
  delete document.documentElement.dataset.carryingHighlight;
});

describe("ending a carry", () => {
  it("should offer the highlight to the board at the point it was let go", () => {
    const drop = vi.fn();
    registerHighlightDropper(drop);

    beginHighlightDrag("a1", { x: 10, y: 10 }, null);
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 90, clientY: 70 }));
    expect(useHighlightDrag.getState().carried).toEqual({ annotationId: "a1" });
    // The attribute is what keeps the drag from being a text selection on every surface it crosses.
    expect(document.documentElement.dataset.carryingHighlight).toBe("true");

    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 90, clientY: 70 }));

    expect(drop).toHaveBeenCalledWith("a1", { x: 90, y: 70 });
    expect(useHighlightDrag.getState().carried).toBeNull();
    expect(document.documentElement.dataset.carryingHighlight).toBeUndefined();
  });

  it("should not place anything when the press never travelled", () => {
    const drop = vi.fn();
    registerHighlightDropper(drop);

    beginHighlightDrag("a1", { x: 10, y: 10 }, null);
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 10, clientY: 10 }));

    expect(drop).not.toHaveBeenCalled();
    expect(useHighlightDrag.getState().carried).toBeNull();
  });

  it("should end the carry when the gesture is cancelled, without placing it", () => {
    const drop = vi.fn();
    registerHighlightDropper(drop);

    beginHighlightDrag("a1", { x: 10, y: 10 }, null);
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 90, clientY: 70 }));
    window.dispatchEvent(new PointerEvent("pointercancel"));

    expect(drop).not.toHaveBeenCalled();
    expect(useHighlightDrag.getState().carried).toBeNull();
    expect(document.documentElement.dataset.carryingHighlight).toBeUndefined();
  });

  it("should prefer the caller's own drop when it has one", () => {
    const board = vi.fn();
    const caller = vi.fn();
    registerHighlightDropper(board);

    beginHighlightDrag("a1", { x: 10, y: 10 }, caller);
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 90, clientY: 70 }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 90, clientY: 70 }));

    expect(caller).toHaveBeenCalledWith("a1", { x: 90, y: 70 });
    expect(board).not.toHaveBeenCalled();
  });

  it("should do nothing when no board is listening, rather than throwing on a release", () => {
    registerHighlightDropper(() => {});
    expect(() => dropHighlight("a1", { x: 0, y: 0 })).not.toThrow();
  });
});
