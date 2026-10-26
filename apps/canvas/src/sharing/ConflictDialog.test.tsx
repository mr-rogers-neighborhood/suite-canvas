import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConflictDialog } from "./SharePublishButton";

const conflict = {
  conflicts: [{ key: "card:c1:body", kind: "body" as const, message: "Body changed." }],
  unsupported: [],
  reason: null,
  code: null,
};

/**
 * The conflict dialog declared `aria-modal="true"` with no trap, so Tab escaped
 * to the chrome behind the scrim while the draft was unresolved.
 */
describe("the publish conflict dialog", () => {
  it("takes focus and keeps Tab inside itself", () => {
    render(
      <ConflictDialog
        conflict={conflict}
        publishing={false}
        reloading={false}
        onPublishSelected={() => {}}
        onReload={() => {}}
        onClose={() => {}}
      />,
    );

    const dialog = screen.getByTestId("publish-conflict");
    expect(dialog.contains(document.activeElement)).toBe(true);

    const focusable = dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled])",
    );
    const tail = focusable[focusable.length - 1];
    tail?.focus();

    fireEvent.keyDown(tail as HTMLElement, { key: "Tab" });

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(tail);
  });
});

/**
 * Reloading discards a draft, and it asked in `window.confirm`, the last
 * platform question in the interface. It now asks inside the dialog it belongs
 * to, where the draft it will discard is on screen.
 */
describe("reloading a draft", () => {
  it("asks first, and reloads nothing until the reader agrees", () => {
    const onReload = vi.fn();
    render(
      <ConflictDialog
        conflict={conflict}
        publishing={false}
        reloading={false}
        onPublishSelected={() => {}}
        onReload={onReload}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("publish-reload"));
    expect(onReload).not.toHaveBeenCalled();
    expect(screen.getByTestId("publish-reload-confirm")).toHaveTextContent("discarded");

    fireEvent.click(screen.getByTestId("publish-reload-yes"));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("closes the question without reloading when the reader cancels", () => {
    const onReload = vi.fn();
    render(
      <ConflictDialog
        conflict={conflict}
        publishing={false}
        reloading={false}
        onPublishSelected={() => {}}
        onReload={onReload}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("publish-reload"));
    fireEvent.click(screen.getByTestId("publish-reload-no"));

    expect(onReload).not.toHaveBeenCalled();
    expect(screen.queryByTestId("publish-reload-confirm")).toBeNull();
    expect(screen.getByTestId("publish-reload")).toBeInTheDocument();
  });

  it("never falls back to the platform confirm", () => {
    const confirm = vi.spyOn(window, "confirm");
    render(
      <ConflictDialog
        conflict={conflict}
        publishing={false}
        reloading={false}
        onPublishSelected={() => {}}
        onReload={() => {}}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("publish-reload"));

    expect(confirm).not.toHaveBeenCalled();
  });
});
