import { renderHook } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useNoTextSelection } from "./useNoTextSelection";

/**
 * The shift+drag report, as an event test.
 *
 * Shift is the marquee key, and the browser also reads it as "extend the selection from
 * the last anchor". A drag across the board therefore swept every word between a card's
 * text and the pointer. The cancel has to land on `selectstart`: nothing about
 * `pointerdown` stops a text selection, which is why the sweep survived the gesture
 * handlers already standing there.
 */

function mountBoard(): {
  board: HTMLDivElement;
  ref: ReturnType<typeof createRef<HTMLDivElement>>;
} {
  const board = document.createElement("div");
  document.body.append(board);
  const ref = createRef<HTMLDivElement>();
  ref.current = board;
  return { board, ref };
}

/** True when the browser would still be allowed to start a selection there. */
function selectStartAllowed(target: EventTarget): boolean {
  const event = new Event("selectstart", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return !event.defaultPrevented;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("a canvas", () => {
  it("should refuse to start a text selection on its own surface", () => {
    const { board, ref } = mountBoard();
    renderHook(() => useNoTextSelection(ref));

    expect(selectStartAllowed(board)).toBe(false);
  });

  it("should leave a card's editor alone", () => {
    const { board, ref } = mountBoard();
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    const text = document.createElement("span");
    editor.append(text);
    board.append(editor);
    renderHook(() => useNoTextSelection(ref));

    // The editor's own text is the one place a drag may still select, or a word could
    // not be picked out of a card being written.
    expect(selectStartAllowed(text)).toBe(true);
  });

  it("should refuse a card's read-only text, which is a picture of text", () => {
    const { board, ref } = mountBoard();
    const card = document.createElement("div");
    const text = document.createElement("span");
    text.textContent = "A card's body";
    card.append(text);
    board.append(card);
    renderHook(() => useNoTextSelection(ref));

    expect(selectStartAllowed(text)).toBe(false);
  });

  it("should stop listening when the board goes away", () => {
    const { board, ref } = mountBoard();
    const { unmount } = renderHook(() => useNoTextSelection(ref));
    unmount();

    expect(selectStartAllowed(board)).toBe(true);
  });
});
