import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useNoTextSelection } from "./useNoTextSelection";

/**
 * The shift+drag sweep, as an event test.
 *
 * Shift is the marquee key, and a browser reads the same shift as "extend the selection
 * from the last anchor". The first fix cancelled `selectstart`, which fires only when a
 * selection *begins* — an extension never fires it — so the sweep returned as soon as
 * anything had been selected beforehand. The press is the event that can stop it: the
 * ranges are dropped so there is no anchor left, and the root is flagged so the drag
 * cannot start a new one.
 */

function mount(target: HTMLElement): void {
  document.body.append(target);
}

function pressOn(target: EventTarget): void {
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
}

function release(): void {
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
}

/** True when the browser would still be allowed to start a selection there. */
function selectStartAllowed(target: EventTarget): boolean {
  const event = new Event("selectstart", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return !event.defaultPrevented;
}

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("data-canvas-drag");
});

describe("a press on the canvas", () => {
  it("should drop the selection that a shift+drag would otherwise extend", () => {
    const board = document.createElement("div");
    mount(board);
    const text = document.createElement("span");
    text.textContent = "selected a minute ago";
    board.append(text);
    document.getSelection()?.selectAllChildren(text);
    expect(window.getSelection()?.rangeCount).toBe(1);
    renderHook(() => useNoTextSelection());

    pressOn(board);

    expect(window.getSelection()?.rangeCount).toBe(0);
  });

  it("should refuse to start a selection until the pointer is released", () => {
    const board = document.createElement("div");
    mount(board);
    renderHook(() => useNoTextSelection());

    pressOn(board);
    expect(document.documentElement.dataset.canvasDrag).toBe("true");
    expect(selectStartAllowed(board)).toBe(false);

    release();
    expect(document.documentElement.dataset.canvasDrag).toBeUndefined();
  });

  it("should leave a card's editor alone, where a drag means text", () => {
    const board = document.createElement("div");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    board.append(editor);
    mount(board);
    renderHook(() => useNoTextSelection());

    pressOn(editor);

    expect(document.documentElement.dataset.canvasDrag).toBeUndefined();
    expect(selectStartAllowed(editor)).toBe(true);
  });

  it("should leave a dialog alone, because reading it is the point", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    const text = document.createElement("p");
    text.textContent = "A share link you want to copy";
    dialog.append(text);
    mount(dialog);
    renderHook(() => useNoTextSelection());

    pressOn(text);

    expect(document.documentElement.dataset.canvasDrag).toBeUndefined();
  });

  it("should let go when the window loses focus mid-drag", () => {
    const board = document.createElement("div");
    mount(board);
    renderHook(() => useNoTextSelection());
    pressOn(board);

    window.dispatchEvent(new Event("blur"));

    expect(document.documentElement.dataset.canvasDrag).toBeUndefined();
  });
});
