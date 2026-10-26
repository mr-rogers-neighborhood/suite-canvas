import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type ShareClient, ShareDialog } from "./ShareDialog";

const client: ShareClient = {
  createShare: async () => {
    throw new Error("not used");
  },
  listShares: async () => [],
  revokeShare: async () => {
    throw new Error("not used");
  },
  revokeAllShares: async () => [],
  defaults: async () => ({ hosted: true, defaultExpiryDays: 30 }),
};

/**
 * The dialog is `aria-modal="true"`, so the page behind it is inert by
 * declaration; before the trap, the last Tab in it walked onto the canvas.
 */
describe("the share dialog", () => {
  it("takes focus and keeps Tab inside itself", async () => {
    render(<ShareDialog workspaceId="ws-1" boardId={null} onClose={() => {}} client={client} />);

    const dialog = await screen.findByTestId("share-dialog");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    const focusable = dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href]",
    );
    const tail = focusable[focusable.length - 1];
    expect(tail).toBeDefined();
    tail?.focus();

    fireEvent.keyDown(tail as HTMLElement, { key: "Tab" });

    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(tail);
  });
});
