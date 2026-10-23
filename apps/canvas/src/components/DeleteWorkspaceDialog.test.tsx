import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DeleteWorkspaceDialog } from "./DeleteWorkspaceDialog";

function setup(overrides: Partial<Parameters<typeof DeleteWorkspaceDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onDeleted = vi.fn();
  const remove = vi.fn(async () => undefined);
  render(
    <DeleteWorkspaceDialog
      workspaceId="ws-1"
      title="Research"
      mode="relay"
      ownerKey="owner-key-1"
      onClose={onClose}
      onDeleted={onDeleted}
      remove={remove as never}
      {...overrides}
    />,
  );
  return { onClose, onDeleted, remove };
}

const confirmInput = () => screen.getByTestId("delete-workspace-confirm-input");
const confirmButton = () => screen.getByTestId("delete-workspace-confirm-button");

describe("DeleteWorkspaceDialog", () => {
  it("cannot delete on a single click", async () => {
    const { remove } = setup();
    expect(confirmButton()).toBeDisabled();
    fireEvent.click(confirmButton());
    expect(remove).not.toHaveBeenCalled();
  });

  it("enables only for the exact name or id", async () => {
    const { remove } = setup();
    fireEvent.change(confirmInput(), { target: { value: "Research" } });
    expect(confirmButton()).toBeEnabled();
    fireEvent.change(confirmInput(), { target: { value: "ws-1" } });
    expect(confirmButton()).toBeEnabled();
    fireEvent.change(confirmInput(), { target: { value: "research" } });
    expect(confirmButton()).toBeDisabled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes, purges and reports the outcome", async () => {
    const { remove, onDeleted } = setup();
    fireEvent.change(confirmInput(), { target: { value: "Research" } });
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        profile: "relay",
        ownerKey: "owner-key-1",
      }),
    );
  });

  it("shows a failure inline and keeps the dialog open", async () => {
    const remove = vi.fn(async () => {
      throw new Error("The server did not answer, so nothing was deleted.");
    });
    const { onDeleted } = setup({ remove: remove as never });
    fireEvent.change(confirmInput(), { target: { value: "Research" } });
    fireEvent.click(confirmButton());
    expect(await screen.findByTestId("delete-workspace-error")).toHaveTextContent(
      "nothing was deleted",
    );
    expect(onDeleted).not.toHaveBeenCalled();
    expect(confirmButton()).toBeEnabled();
  });

  /** The two profiles delete different halves, so they must not share copy. */
  it("says what a local-only delete does", () => {
    setup({ mode: "standalone", ownerKey: null });
    const copy = screen.getByTestId("delete-workspace-copy");
    expect(copy).toHaveTextContent("this browser is the only place");
    expect(copy).not.toHaveTextContent("share links");
  });

  it("warns that other devices keep an offline copy", () => {
    setup();
    expect(screen.getByTestId("delete-workspace-dialog")).toHaveTextContent(
      "keep their offline copy until they next open it",
    );
  });
});
