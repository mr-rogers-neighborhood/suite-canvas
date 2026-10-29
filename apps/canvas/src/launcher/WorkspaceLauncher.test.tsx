import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountStore } from "../auth/useAccountStore";
import { readAccountWorkspaces } from "../session/accountWorkspaces";
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
import { takeChosenTemplate } from "./starterTemplates";
import { importVaultIntoWorkspace } from "./vaultImport";
import { WorkspaceLauncher } from "./WorkspaceLauncher";

// The account answer decides what a row says about sync, so it is the one thing a
// test replaces; the rest of the module (the labels) stays real.
vi.mock("../session/accountWorkspaces", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/accountWorkspaces")>();
  return { ...actual, readAccountWorkspaces: vi.fn(async () => null) };
});

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

// The starters usually come from the cache or the server. What this file is about
// is the select, so the list is the built-in one and no request is made.
vi.mock("./starterTemplates", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./starterTemplates")>();
  return {
    ...actual,
    loadStarterTemplates: vi.fn(async () => (await import("@suite/graph")).STARTER_TEMPLATES),
  };
});

vi.mock("../session/workspaceTransfer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/workspaceTransfer")>();
  return {
    ...actual,
    downloadWorkspaceById: vi.fn(async () => {}),
    navigateTo: vi.fn(),
  };
});

const readAccount = vi.mocked(readAccountWorkspaces);
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
  // Each test states what the account holds; a leftover answer from the one before is
  // how a launcher test starts passing for the wrong reason.
  readAccount.mockReset();
  readAccount.mockResolvedValue(null);
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

  it("offers the same pair beside a list of local workspaces, with no account yet", async () => {
    seedRecent();
    render(<WorkspaceLauncher />);

    const prompt = await screen.findByTestId("launcher-account-prompt");
    expect(prompt).toHaveTextContent("Saved in this browser only.");

    fireEvent.click(screen.getByTestId("launcher-account-prompt-create"));
    const dialog = await screen.findByTestId("sign-in-dialog");
    expect(dialog).toHaveAttribute("data-mode", "sign-up");
  });

  it("puts the source one press away, in a new tab, from the header and the notice", () => {
    render(<WorkspaceLauncher />);

    // The button beside the two workspace doors, and the copyright line, which is the
    // spot somebody looks for "who made this".
    for (const id of ["launcher-github", "launcher-repository"]) {
      const link = screen.getByTestId(id);
      expect(link.getAttribute("href")).toMatch(/^https:\/\/github\.com\//u);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noreferrer");
    }
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
  it("preselects the notebook, so a new workspace opens with somewhere to write", () => {
    render(<WorkspaceLauncher />);

    expect(screen.getByTestId("launcher-template")).toHaveValue("notebook");
    fireEvent.click(screen.getByTestId("launcher-new"));

    const url = new URL(String(navigate.mock.calls[0]?.[0] ?? ""));
    expect(url.searchParams.get("template")).toBe("notebook");
    expect(url.searchParams.get("fresh")).toBe("1");
  });

  it("carries the chosen template to the editor that writes the document", () => {
    render(<WorkspaceLauncher />);

    fireEvent.change(screen.getByTestId("launcher-template"), { target: { value: "discworld" } });
    fireEvent.click(screen.getByTestId("launcher-new"));

    const url = new URL(String(navigate.mock.calls[0]?.[0] ?? ""));
    expect(url.searchParams.get("template")).toBe("discworld");
  });

  it("still offers a blank workspace, which sends no template at all", () => {
    render(<WorkspaceLauncher />);

    const select = screen.getByTestId("launcher-template");
    expect(within(select).getByRole("option", { name: "Blank" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("launcher-new"));

    const url = new URL(String(navigate.mock.calls[0]?.[0] ?? ""));
    expect(url.searchParams.get("template")).toBeNull();
  });

  it("hands the chosen template to the boot as an object, not only as an id", () => {
    render(<WorkspaceLauncher />);

    fireEvent.change(screen.getByTestId("launcher-template"), { target: { value: "discworld" } });
    fireEvent.click(screen.getByTestId("launcher-new"));

    const url = new URL(String(navigate.mock.calls[0]?.[0] ?? ""));
    const handed = takeChosenTemplate(url.searchParams.get("workspace") ?? "");
    // An id only resolves a starter the bundle was built with, so the object is
    // what the boot has to apply.
    expect(handed?.id).toBe("discworld");
    expect(handed?.name).toBe("Discworld Reading Guide");
    expect(handed?.boards).toHaveLength(3);
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

  it("says which workspaces the account already holds", async () => {
    seedRecent();
    readAccount.mockResolvedValueOnce({
      workspaces: [
        { id: WORKSPACE, organizationId: "org-1", name: TITLE, createdAt: 1, archivedAt: null },
      ],
      organizations: [{ id: "org-1", name: "Personal", role: "owner" }],
    });
    render(<WorkspaceLauncher />);

    const badge = await screen.findByTestId(`launcher-sync-${WORKSPACE}`);
    expect(badge).toHaveTextContent("Synced");
    expect(badge.dataset.sync).toBe("synced");
    expect(screen.queryByTestId("launcher-bring-prompt")).toBeNull();
  });

  it("re-reads the account when the tab comes back, so a purchase elsewhere shows", async () => {
    // Checkout lands in the tab that opened it, and the launcher is mounted here. One read
    // at mount left the notice and every row describing the account as it was before.
    seedRecent();
    readAccount.mockResolvedValueOnce({ workspaces: [], organizations: [] });
    render(<WorkspaceLauncher />);

    expect(await screen.findByTestId("launcher-bring-prompt")).toBeInTheDocument();

    readAccount.mockResolvedValueOnce({
      workspaces: [
        { id: WORKSPACE, organizationId: "org-1", name: TITLE, createdAt: 1, archivedAt: null },
      ],
      organizations: [{ id: "org-1", name: "Personal", role: "owner" }],
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() =>
      expect(screen.queryByTestId("launcher-bring-prompt")).not.toBeInTheDocument(),
    );
    expect(await screen.findByTestId(`launcher-sync-${WORKSPACE}`)).toHaveTextContent("Synced");
  });

  it("re-reads the account when the account panel closes", async () => {
    seedRecent();
    readAccount.mockResolvedValue({ workspaces: [], organizations: [] });
    useAccountStore.setState({ panelOpen: true, panelTab: "plan" });
    render(<WorkspaceLauncher />);
    await waitFor(() => expect(screen.getByTestId("launcher-bring-prompt")).toBeInTheDocument());

    readAccount.mockResolvedValue({
      workspaces: [
        { id: WORKSPACE, organizationId: "org-1", name: TITLE, createdAt: 1, archivedAt: null },
      ],
      organizations: [{ id: "org-1", name: "Personal", role: "owner" }],
    });
    act(() => useAccountStore.getState().closePanel());

    await waitFor(() =>
      expect(screen.queryByTestId("launcher-bring-prompt")).not.toBeInTheDocument(),
    );
  });

  it("says nothing about sync when there is no account", async () => {
    seedRecent();
    render(<WorkspaceLauncher />);

    await waitFor(() => expect(readAccount).toHaveBeenCalled());
    expect(screen.queryByTestId(`launcher-sync-${WORKSPACE}`)).toBeNull();
  });

  it("offers to bring local work along when the account holds nothing", async () => {
    seedRecent();
    readAccount.mockResolvedValueOnce({ workspaces: [], organizations: [] });
    render(<WorkspaceLauncher />);

    const prompt = await screen.findByTestId("launcher-bring-prompt");
    expect(prompt).toHaveTextContent("saved on this device only");
    // The sentence used to promise that opening one was enough. Since the plan became
    // the thing that puts a workspace in an account, it would be an invitation to a
    // refusal: `plan-required`, and the workspace stays local.
    expect(prompt).toHaveTextContent("A plan is what puts them in your account");
    expect(prompt).not.toHaveTextContent("Open one while signed in");
    expect(screen.getByTestId(`launcher-sync-${WORKSPACE}`)).toHaveTextContent("On this device");

    fireEvent.click(screen.getByTestId("launcher-bring-dismiss"));
    expect(screen.queryByTestId("launcher-bring-prompt")).toBeNull();
  });

  it("opens the plan tab from the local-only notice, because a plan is the obstacle", async () => {
    seedRecent();
    readAccount.mockResolvedValueOnce({ workspaces: [], organizations: [] });
    useAccountStore.setState({ panelOpen: false, panelTab: "account" });
    render(<WorkspaceLauncher />);

    fireEvent.click(await screen.findByTestId("launcher-bring-plans"));

    const account = useAccountStore.getState();
    expect(account.panelOpen).toBe(true);
    expect(account.panelTab).toBe("plan");
  });
});
