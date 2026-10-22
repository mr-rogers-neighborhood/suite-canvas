import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readOwnerKey, writeOwnerKey } from "../session/ownerKey";
import { createOwnerKit, downloadOwnerKit } from "../session/ownerKit";
import {
  downloadWorkspaceById,
  navigateTo,
  readRecentWorkspaces,
} from "../session/workspaceTransfer";
import { WorkspaceLauncher } from "./WorkspaceLauncher";

vi.mock("../session/workspaceTransfer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/workspaceTransfer")>();
  return {
    ...actual,
    downloadWorkspaceById: vi.fn(async () => {}),
    navigateTo: vi.fn(),
  };
});

vi.mock("../session/ownerKit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/ownerKit")>();
  return { ...actual, downloadOwnerKit: vi.fn(() => "research-recovery.suitekey") };
});

const exportWorkspace = vi.mocked(downloadWorkspaceById);
const navigate = vi.mocked(navigateTo);
const download = vi.mocked(downloadOwnerKit);

const WORKSPACE = "ws-recent";
const TITLE = "Research";

function seedRecent(): void {
  window.localStorage.setItem(
    "suite.recentWorkspaces.v1",
    JSON.stringify([{ id: WORKSPACE, title: TITLE, lastOpenedAt: 1 }]),
  );
}

async function chooseFile(testId: string, text: string, name: string): Promise<void> {
  fireEvent.change(screen.getByTestId(testId), {
    target: { files: [new File([text], name, { type: "application/json" })] },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  exportWorkspace.mockClear();
  navigate.mockClear();
  download.mockClear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("WorkspaceLauncher recovery flow", () => {
  it("offers a recovery key after exporting a recent workspace", async () => {
    seedRecent();
    writeOwnerKey(WORKSPACE, "owner-key");
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId(`launcher-export-${WORKSPACE}`));

    await waitFor(() => expect(screen.getByTestId("recovery-prompt")).toBeVisible());
    expect(screen.getByTestId("recovery-prompt")).toHaveTextContent(
      "Backup saved. Save a separate recovery key too?",
    );

    fireEvent.click(screen.getByTestId("recovery-prompt-save"));
    expect(download).toHaveBeenCalledWith(WORKSPACE, "owner-key", TITLE);
  });

  it("stays quiet when this browser already saved the key", async () => {
    seedRecent();
    writeOwnerKey(WORKSPACE, "owner-key");
    window.localStorage.setItem("suite.recoverySaved.ws-recent", JSON.stringify({ savedAt: 1 }));
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId(`launcher-export-${WORKSPACE}`));

    await waitFor(() => expect(exportWorkspace).toHaveBeenCalledWith(WORKSPACE, TITLE));
    expect(screen.queryByTestId("recovery-prompt")).not.toBeInTheDocument();
  });

  it("stays quiet when this browser holds no owner key", async () => {
    seedRecent();
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId(`launcher-export-${WORKSPACE}`));

    await waitFor(() => expect(exportWorkspace).toHaveBeenCalled());
    expect(screen.queryByTestId("recovery-prompt")).not.toBeInTheDocument();
  });

  it("opens the workspace a recovery key names, without adding a recent", async () => {
    render(<WorkspaceLauncher />);

    await chooseFile(
      "launcher-recovery-file",
      createOwnerKit("ws-restored", "key-restored"),
      "restored-recovery.suitekey",
    );

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    const url = new URL(String(navigate.mock.calls[0]?.[0] ?? ""));
    expect(url.searchParams.get("workspace")).toBe("ws-restored");
    expect(url.hash).toBe("#owner=key-restored");
    expect(readOwnerKey("ws-restored")).toBe("key-restored");
    expect(readRecentWorkspaces().map((entry) => entry.id)).toEqual([]);
    expect(screen.queryByTestId("launcher-error")).not.toBeInTheDocument();
  });

  it("shows one inline error for a file that is not a recovery key", async () => {
    render(<WorkspaceLauncher />);

    await chooseFile("launcher-recovery-file", '{"kind":"suite.workspace"}', "notes.suitekey");

    await waitFor(() =>
      expect(screen.getByTestId("launcher-error")).toHaveTextContent("workspace backup"),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(readOwnerKey("ws-restored")).toBeNull();
    expect(readRecentWorkspaces()).toEqual([]);
  });

  it("names the row control as a list removal, not a deletion", () => {
    seedRecent();
    render(<WorkspaceLauncher />);

    const row = screen.getByTestId(`launcher-recent-${WORKSPACE}`);
    const remove = row.querySelector('button[aria-label^="Remove"]');
    expect(remove).toHaveAttribute(
      "aria-label",
      "Remove from this list (does not delete the workspace)",
    );
    expect(remove).toHaveAttribute(
      "title",
      "Remove from this list (does not delete the workspace)",
    );
  });
});
