import { type RefObject, useEffect } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableIn(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.getAttribute("aria-hidden") !== "true",
  );
}

/**
 * Keep Tab inside a modal panel, and hand focus back when it closes.
 *
 * A panel marked `aria-modal="true"` tells assistive technology that the page
 * behind is inert. Without this hook that promise was false: the last Tab in a
 * dialog walked into the canvas behind the scrim, and closing the dialog left
 * focus on `<body>`, so the next keystroke went nowhere.
 *
 * Call it before any effect that focuses a specific control inside the panel, so
 * that control wins the initial focus.
 */
export function useFocusTrap(panel: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return;
    const node = panel.current;
    if (!node) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (!node.contains(document.activeElement)) {
      const [first] = focusableIn(node);
      if (first) first.focus();
      else node.focus();
    }

    const containTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusableIn(node);
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      const outside = current === null || !node.contains(current);
      if (event.shiftKey) {
        if (outside || current === first) {
          event.preventDefault();
          last?.focus();
        }
        return;
      }
      if (outside || current === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    node.addEventListener("keydown", containTab);
    return () => {
      node.removeEventListener("keydown", containTab);
      if (opener?.isConnected) opener.focus();
    };
  }, [active, panel]);
}
