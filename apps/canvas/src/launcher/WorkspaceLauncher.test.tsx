import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readOwnerKey, writeOwnerKey } from "../session/ownerKey";
import { createOwnerKit, downloadOwnerKit } from "../session/ownerKit";
import { configureSession, type SessionConfig } from "../session/session";
import {
  readWorkspaceNames,
  rememberWorkspaceName,
  renameCachedWorkspace,
} from "../session/workspaceName";
import {
  downloadWorkspaceById,
  navigateTo,
  readRecentWorkspaces,
} from "../session/workspaceTransfer";
import { WorkspaceLauncher } from "./WorkspaceLauncher";

vi.mock("../session/workspaceName", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/workspaceName")>();
  return { ...actual, renameCachedWorkspace: vi.fn(async () => true) };
});

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
const renameCached = vi.mocked(renameCachedWorkspace);

const WORKSPACE = "ws-recent";
const TITLE = "Research";

function ownerSession(): SessionConfig {
  return {
    workspaceId: null,
    roomId: null,
    share: null,
    role: "editor",
    readOnly: false,
    ownerKey: null,
  };
}

function shareSession(role: "editor" | "viewer"): SessionConfig {
  return {
    workspaceId: WORKSPACE,
    roomId: WORKSPACE,
    share: {
      token: "share-token",
      scope: "workspace",
      role,
      workspaceId: WORKSPACE,
      boardId: null,
      cardId: null,
      roomId: WORKSPACE,
    },
    role,
    readOnly: role === "viewer",
    ownerKey: null,
  };
}

function seedRecent(): void {
  window.localStorage.setItem(
    "suite.recentWorkspaces.v1",
    JSON.stringify([{ id: WORKSPACE, title: TITLE, lastOpenedAt: 1 }]),
  );
}

function seedRecents(
  entries: ReadonlyArray<{ id: string; title: string; boardId?: string }>,
): void {
  window.localStorage.setItem(
    "suite.recentWorkspaces.v1",
    JSON.stringify(
      entries.map((entry, index) => ({
        id: entry.id,
        title: entry.title,
        lastOpenedAt: 1_000 + index,
        ...(entry.boardId ? { boardId: entry.boardId } : {}),
      })),
    ),
  );
}

async function chooseFile(testId: string, text: string, name: string): Promise<void> {
  fireEvent.change(screen.getByTestId(testId), {
    target: { files: [new File([text], name, { type: "application/json" })] },
  });
}

beforeEach(() => {
  window.localStorage.clear();
  configureSession(ownerSession());
  exportWorkspace.mockClear();
  navigate.mockClear();
  download.mockClear();
  renameCached.mockClear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("WorkspaceLauncher recovery flow", () => {
  it("offers a recovery key after exporting a recent workspace", async () => {
    seedRecent();
    writeOwnerKey(WORKSPACE, "owner-key");
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId(`launcher-export-${WORKSPACE}`));

    await waitFor(() => expect(screen.getByTestId("recovery-prompt")).toBeVisible());
    expect(screen.getByTestId("recovery-prompt")).toHaveTextContent(
      "Backup saved. Save a separate owner file too?",
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

    await waitFor(() =>
      expect(exportWorkspace).toHaveBeenCalledWith(WORKSPACE, TITLE, expect.any(Function)),
    );
    expect(screen.queryByTestId("recovery-prompt")).not.toBeInTheDocument();
  });

  it("shows the export's own warnings, so a partial backup is never silent", async () => {
    seedRecent();
    exportWorkspace.mockImplementationOnce(async (_id, _title, onWarning) => {
      onWarning?.("1 image is missing from this backup (card “Trip plan”).");
    });
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId(`launcher-export-${WORKSPACE}`));

    await waitFor(() =>
      expect(screen.getByTestId("launcher-notice")).toHaveTextContent(
        "1 image is missing from this backup",
      ),
    );
    // A warning is not a failure: the file was written, so no error is shown.
    expect(screen.queryByTestId("launcher-error")).not.toBeInTheDocument();
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

describe("WorkspaceLauncher new workspace", () => {
  it("opens a new workspace straight away, with one key and a fresh flag", () => {
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId("launcher-new"));

    expect(navigate).toHaveBeenCalledTimes(1);
    const url = new URL(String(navigate.mock.calls[0]?.[0] ?? ""));
    const workspaceId = url.searchParams.get("workspace") ?? "";
    const generated = readOwnerKey(workspaceId);

    expect(generated).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.hash).toBe(`#owner=${generated}`);
    expect(url.searchParams.get("fresh")).toBe("1");
    expect(readRecentWorkspaces().map((entry) => entry.id)).toEqual([workspaceId]);
    expect(window.localStorage.getItem(`suite.recoverySaved.${workspaceId}`)).toBeNull();
    // No dialog stands between the button and the board.
    expect(screen.queryByTestId("recovery-prompt")).not.toBeInTheDocument();
  });

  it.each([
    ["a share session", "editor"],
    ["a viewer", "viewer"],
  ] as const)("creates a local workspace for %s too, with no dialog", (_label, role) => {
    configureSession(shareSession(role));
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId("launcher-new"));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("recovery-prompt")).not.toBeInTheDocument();
  });

  it("offers the owner file after a launcher export of a key never saved", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const first = render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId("launcher-new"));
    const url = new URL(String(navigate.mock.calls[0]?.[0] ?? ""));
    const workspaceId = url.searchParams.get("workspace") ?? "";
    const generated = readOwnerKey(workspaceId);
    expect(fetchMock).not.toHaveBeenCalled();

    // The backup prompt is intact: this key has never been saved, so an export
    // still offers the owner file for it.
    first.unmount();
    render(<WorkspaceLauncher />);
    fireEvent.click(screen.getByTestId(`launcher-export-${workspaceId}`));

    await waitFor(() => expect(screen.getByTestId("recovery-prompt")).toBeVisible());
    fireEvent.click(screen.getByTestId("recovery-prompt-save"));
    expect(download).toHaveBeenCalledWith(
      workspaceId,
      generated,
      expect.stringMatching(/^[A-Z][a-z]+ [A-Z][a-z]+$/),
    );
  });
});

describe("WorkspaceLauncher workspace names", () => {
  it("shows the workspace name as the primary label and the board as detail", () => {
    seedRecents([{ id: WORKSPACE, title: TITLE, boardId: "board-1" }]);
    rememberWorkspaceName(WORKSPACE, "Research 2026");
    render(<WorkspaceLauncher />);

    const row = screen.getByTestId(`launcher-recent-${WORKSPACE}`);
    // The first line of the row is the workspace name, not the board name.
    const name = within(row).getByTestId(`launcher-name-${WORKSPACE}`);
    expect(name).toHaveTextContent(/^Research 2026$/);

    // The board name and id stay, as muted detail under the name.
    expect(within(row).getByTestId(`launcher-detail-${WORKSPACE}`)).toHaveTextContent(
      `${TITLE} · board-1`,
    );
  });

  it("renames from the launcher without a reload and writes through to the openable document", async () => {
    seedRecents([{ id: WORKSPACE, title: TITLE, boardId: "board-1" }]);
    rememberWorkspaceName(WORKSPACE, TITLE);
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId(`launcher-rename-${WORKSPACE}`));
    const input = screen.getByTestId(`launcher-rename-input-${WORKSPACE}`);
    expect(input).toHaveValue(TITLE);

    fireEvent.change(input, { target: { value: "  Research 2026  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    // The same mounted launcher shows the new name; nothing reloads.
    await waitFor(() =>
      expect(screen.getByTestId(`launcher-name-${WORKSPACE}`)).toHaveTextContent("Research 2026"),
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(readWorkspaceNames()[WORKSPACE]).toBe("Research 2026");
    // The recents list itself keeps its existing entries and board detail.
    expect(readRecentWorkspaces()).toMatchObject([{ id: WORKSPACE, title: TITLE }]);
    await waitFor(() => expect(renameCached).toHaveBeenCalledWith(WORKSPACE, "Research 2026"));
  });

  it("states why a rename was refused and leaves the row as it was", async () => {
    seedRecents([{ id: WORKSPACE, title: TITLE, boardId: "board-1" }]);
    rememberWorkspaceName(WORKSPACE, TITLE);
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId(`launcher-rename-${WORKSPACE}`));
    const input = screen.getByTestId(`launcher-rename-input-${WORKSPACE}`);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("A workspace name cannot be empty.")).toBeVisible();
    expect(screen.getByTestId(`launcher-rename-hint-${WORKSPACE}`)).toHaveAttribute(
      "role",
      "alert",
    );
    expect(readWorkspaceNames()[WORKSPACE]).toBe(TITLE);
    expect(renameCached).not.toHaveBeenCalled();
  });

  it("makes two workspaces with the same default board name distinguishable", async () => {
    // The reported regression: every workspace's first board is "Board 1", so
    // the old rows were all identical. Naming one now separates them.
    seedRecents([
      { id: "ws-a", title: "Board 1", boardId: "board-1" },
      { id: "ws-b", title: "Board 1", boardId: "board-1" },
    ]);
    render(<WorkspaceLauncher />);

    expect(screen.getByTestId("launcher-name-ws-a")).toHaveTextContent("Board 1");
    expect(screen.getByTestId("launcher-name-ws-b")).toHaveTextContent("Board 1");

    fireEvent.click(screen.getByTestId("launcher-rename-ws-a"));
    const input = screen.getByTestId("launcher-rename-input-ws-a");
    fireEvent.change(input, { target: { value: "Roadmap" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByTestId("launcher-name-ws-a")).toHaveTextContent("Roadmap"),
    );
    expect(screen.getByTestId("launcher-name-ws-b")).toHaveTextContent("Board 1");
    expect(screen.getByTestId("launcher-name-ws-a").textContent).not.toBe(
      screen.getByTestId("launcher-name-ws-b").textContent,
    );
    // Both rows still carry their (identical) board as secondary detail.
    expect(screen.getByTestId("launcher-detail-ws-a")).toHaveTextContent("board-1");
    expect(screen.getByTestId("launcher-detail-ws-b")).toHaveTextContent("board-1");
  });
});
