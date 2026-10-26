import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { importVaultIntoWorkspace } from "./vaultImport";
import { WorkspaceLauncher } from "./WorkspaceLauncher";

vi.mock("../session/workspaceName", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/workspaceName")>();
  return { ...actual, renameCachedWorkspace: vi.fn(async () => true) };
});

// The drop reads and writes a real document; what this file is about is the row
// it lands on and what the person is told, so the import itself is replaced.
vi.mock("./vaultImport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vaultImport")>();
  return { ...actual, importVaultIntoWorkspace: vi.fn() };
});

const importVault = vi.mocked(importVaultIntoWorkspace);

vi.mock("../session/workspaceTransfer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/workspaceTransfer")>();
  return {
    ...actual,
    downloadWorkspaceById: vi.fn(async () => {}),
    navigateTo: vi.fn(),
  };
});

const exportWorkspace = vi.mocked(downloadWorkspaceById);
const navigate = vi.mocked(navigateTo);
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
    credential: "account",
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
    credential: "share",
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
  renameCached.mockClear();
  importVault.mockReset();
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("WorkspaceLauncher export", () => {
  it("starts a new workspace with no credential in the URL", () => {
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId("launcher-new"));

    expect(navigate).toHaveBeenCalledTimes(1);
    const url = new URL(String(navigate.mock.calls[0]?.[0] ?? ""));
    expect(url.searchParams.get("workspace")).toBeTruthy();
    // Nothing secret travels in a link any more: the session is the credential.
    expect(url.hash).toBe("");
    expect(url.searchParams.get("fresh")).toBe("1");
    expect(readRecentWorkspaces()).toHaveLength(1);
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

  it("has no recovery-key entry at all", () => {
    render(<WorkspaceLauncher />);
    expect(screen.queryByTestId("launcher-open-recovery")).not.toBeInTheDocument();
    expect(screen.queryByTestId("launcher-recovery-file")).not.toBeInTheDocument();
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

describe("WorkspaceLauncher identity", () => {
  it("offers sign-in and sign-up from the launcher itself", async () => {
    render(<WorkspaceLauncher />);

    // The surface loads on demand, so it arrives a tick after the launcher.
    const signUp = await screen.findByTestId("create-account-entry");
    expect(screen.getByTestId("sign-in-entry-standalone")).toBeInTheDocument();

    fireEvent.click(signUp);
    const dialog = await screen.findByTestId("sign-in-dialog");
    expect(dialog).toHaveAttribute("data-mode", "sign-up");
  });
});

describe("WorkspaceLauncher import", () => {
  it("opens an imported workspace and lists the cards whose images it lost", async () => {
    render(<WorkspaceLauncher />);

    // A file that is not a backup at all: the import refuses, and says why.
    await chooseFile("launcher-file", '{"kind":"other"}', "notes.suite");
    await waitFor(() =>
      expect(screen.getByTestId("launcher-error")).toHaveTextContent(
        "not a Suite workspace backup",
      ),
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it("creates a local workspace for a share session too, with no dialog", () => {
    configureSession(shareSession("editor"));
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId("launcher-new"));

    expect(navigate).toHaveBeenCalledTimes(1);
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

describe("WorkspaceLauncher templates", () => {
  it("starts blank unless a template is chosen", () => {
    render(<WorkspaceLauncher />);

    expect(screen.getByTestId("launcher-template")).toHaveValue("");
    fireEvent.click(screen.getByTestId("launcher-new"));

    const url = new URL(String(navigate.mock.calls[0]?.[0] ?? ""));
    // Blank means no template parameter at all: the editor applies nothing.
    expect(url.searchParams.get("template")).toBeNull();
  });

  it("carries the chosen template to the editor that writes the document", () => {
    render(<WorkspaceLauncher />);

    fireEvent.change(screen.getByTestId("launcher-template"), { target: { value: "research" } });
    fireEvent.click(screen.getByTestId("launcher-new"));

    const url = new URL(String(navigate.mock.calls[0]?.[0] ?? ""));
    expect(url.searchParams.get("template")).toBe("research");
    expect(url.searchParams.get("fresh")).toBe("1");
  });
});

describe("WorkspaceLauncher Obsidian drop", () => {
  function dropOnto(id: string): void {
    fireEvent.drop(screen.getByTestId(`launcher-recent-${id}`), {
      dataTransfer: { items: [{ webkitGetAsEntry: () => null }] },
    });
  }

  it("imports into the workspace whose row the vault was dropped on", async () => {
    seedRecent();
    importVault.mockResolvedValueOnce({ ok: true, message: "3 cards in 1 board" });
    render(<WorkspaceLauncher />);

    dropOnto(WORKSPACE);

    await waitFor(() => expect(importVault).toHaveBeenCalledTimes(1));
    expect(importVault.mock.calls[0]?.[0]).toMatchObject({ workspaceId: WORKSPACE });
    // The row's workspace is the target: the launcher never mints a new id.
    expect(navigate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId("toast-success")).toHaveTextContent("3 cards in 1 board"),
    );
  });

  it("shows what a partial import lost", async () => {
    seedRecent();
    importVault.mockResolvedValueOnce({
      ok: true,
      message: "3 cards in 1 board",
      detail: "2 link(s) point at notes the vault did not have: Nowhere, Later.",
    });
    render(<WorkspaceLauncher />);

    dropOnto(WORKSPACE);

    await waitFor(() =>
      expect(screen.getByTestId("toast-success")).toHaveTextContent("2 link(s) point at notes"),
    );
  });

  it("reports a refusal as a failure, with its reason", async () => {
    seedRecent();
    importVault.mockResolvedValueOnce({
      ok: false,
      message: "Nothing was imported: this workspace is not stored on this device yet.",
      detail: "Open it from the list once, then drop the vault onto its row again.",
    });
    render(<WorkspaceLauncher />);

    dropOnto(WORKSPACE);

    await waitFor(() =>
      expect(screen.getByTestId("toast-failure")).toHaveTextContent("not stored on this device"),
    );
    expect(screen.getByTestId("toast-failure")).toHaveTextContent("Open it from the list once");
  });
});

/**
 * The list of recent workspaces had no way to narrow or reorder itself, and an
 * import or export showed nothing at all until it finished.
 */
describe("WorkspaceLauncher recents", () => {
  it("narrows the list to a name", () => {
    seedRecents([
      { id: "ws-a", title: "Research" },
      { id: "ws-b", title: "Field notes" },
    ]);
    render(<WorkspaceLauncher />);

    fireEvent.change(screen.getByTestId("launcher-search"), { target: { value: "field" } });

    expect(screen.queryByTestId("launcher-recent-ws-a")).toBeNull();
    expect(screen.getByTestId("launcher-recent-ws-b")).toBeTruthy();
  });

  it("says so when the query hides everything", () => {
    seedRecent();
    render(<WorkspaceLauncher />);

    fireEvent.change(screen.getByTestId("launcher-search"), { target: { value: "zebra" } });

    expect(screen.getByTestId("launcher-search-empty")).toHaveTextContent("zebra");
  });

  it("reorders the list by name", () => {
    seedRecents([
      { id: "ws-a", title: "Alpha" },
      { id: "ws-b", title: "Zebra" },
    ]);
    render(<WorkspaceLauncher />);

    // Last opened puts the newest first, which is the second seed.
    const first = () => screen.getAllByTestId(/^launcher-recent-/)[0];
    expect(first()).toBe(screen.getByTestId("launcher-recent-ws-b"));

    fireEvent.change(screen.getByTestId("launcher-sort"), { target: { value: "name" } });

    expect(first()).toBe(screen.getByTestId("launcher-recent-ws-a"));
  });

  it("shows what an export is doing while it runs", async () => {
    seedRecent();
    let finish: (() => void) | undefined;
    exportWorkspace.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId(`launcher-export-${WORKSPACE}`));

    expect(await screen.findByTestId("launcher-progress")).toHaveTextContent("Exporting");

    finish?.();
    await waitFor(() => expect(screen.queryByTestId("launcher-progress")).toBeNull());
  });
});
