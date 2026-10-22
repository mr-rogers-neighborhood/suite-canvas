import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readOwnerKey, writeOwnerKey } from "../session/ownerKey";
import { downloadOwnerKit } from "../session/ownerKit";
import { RecoveryKeyDialog } from "./RecoveryKeyDialog";

vi.mock("../session/ownerKit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/ownerKit")>();
  return { ...actual, downloadOwnerKit: vi.fn(() => "research-recovery.suitekey") };
});

const download = vi.mocked(downloadOwnerKit);

beforeEach(() => {
  window.localStorage.clear();
  download.mockClear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("RecoveryKeyDialog", () => {
  it("saves the key with the keep-it-separate copy", () => {
    render(
      <RecoveryKeyDialog
        workspaceId="ws-1"
        ownerKey="old-key"
        title="Research"
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId("recovery-dialog")).toHaveTextContent(
      "This file restores owner access if this browser is lost. Keep it separate from document backups.",
    );

    fireEvent.click(screen.getByTestId("recovery-save"));

    expect(download).toHaveBeenCalledWith("ws-1", "old-key", "Research");
    expect(screen.getByTestId("recovery-saved")).toHaveTextContent("Saved");
  });

  it("warns before replacing, then rotates and saves the new key", async () => {
    writeOwnerKey("ws-1", "old-key");
    const rotate = vi.fn(async (_workspaceId: string, _currentKey: string, _nextKey: string) => {});
    render(
      <RecoveryKeyDialog
        workspaceId="ws-1"
        ownerKey="old-key"
        title="Research"
        rotate={rotate}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("recovery-replace"));
    expect(screen.getByTestId("recovery-warning")).toHaveTextContent(
      "Existing editor links and old recovery files will stop working. Shared viewer/editor links keep working.",
    );
    expect(rotate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("recovery-confirm"));

    await waitFor(() => expect(screen.getByTestId("recovery-reload")).toBeInTheDocument());
    expect(rotate).toHaveBeenCalledTimes(1);
    const [workspaceId, current, next] = rotate.mock.calls[0] ?? [];
    expect(workspaceId).toBe("ws-1");
    expect(current).toBe("old-key");
    expect(next).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(next).not.toBe("old-key");

    // The new key is stored before the dialog offers a reload.
    expect(readOwnerKey("ws-1")).toBe(next);
    expect(download).toHaveBeenCalledWith("ws-1", next, "Research");
    expect(screen.getByTestId("recovery-saved")).toHaveTextContent("New recovery key saved.");
    expect(screen.getByTestId("recovery-rotate-download")).toBeInTheDocument();
  });

  it("keeps the old key and shows the error when rotation fails", async () => {
    writeOwnerKey("ws-1", "old-key");
    const rotate = vi.fn(async () => {
      throw new Error("The current owner key does not match this workspace.");
    });
    render(
      <RecoveryKeyDialog
        workspaceId="ws-1"
        ownerKey="old-key"
        rotate={rotate}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("recovery-replace"));
    fireEvent.click(screen.getByTestId("recovery-confirm"));

    await waitFor(() =>
      expect(screen.getByTestId("recovery-error")).toHaveTextContent(
        "The current owner key does not match this workspace.",
      ),
    );
    expect(readOwnerKey("ws-1")).toBe("old-key");
    expect(download).not.toHaveBeenCalled();
    expect(screen.getByTestId("recovery-replace")).toBeEnabled();
  });

  it("offers the post-backup prompt with Save and Not now", () => {
    const onClose = vi.fn();
    render(
      <RecoveryKeyDialog
        mode="backup-prompt"
        workspaceId="ws-1"
        ownerKey="old-key"
        title="Research"
        onClose={onClose}
      />,
    );

    expect(screen.getByTestId("recovery-prompt")).toHaveTextContent(
      "Backup saved. Save a separate recovery key too?",
    );

    fireEvent.click(screen.getByTestId("recovery-prompt-save"));
    expect(download).toHaveBeenCalledWith("ws-1", "old-key", "Research");
    expect(screen.getByTestId("recovery-saved")).toHaveTextContent("Saved");

    fireEvent.click(screen.getByTestId("recovery-prompt-dismiss"));
    expect(onClose).toHaveBeenCalled();
  });
});
