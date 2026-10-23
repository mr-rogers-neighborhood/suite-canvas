import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimWorkspace,
  deriveOwnerKey,
  generateOwnerKey,
  readOwnerKey,
  writeOwnerKey,
} from "../session/ownerKey";
import { createOwnerKit, downloadOwnerKit } from "../session/ownerKit";
import { configureSession, type SessionConfig } from "../session/session";
import {
  downloadWorkspaceById,
  navigateTo,
  openNewWorkspace,
  readRecentWorkspaces,
} from "../session/workspaceTransfer";
import { WorkspaceLauncher } from "./WorkspaceLauncher";

vi.mock("../session/workspaceTransfer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/workspaceTransfer")>();
  return {
    ...actual,
    downloadWorkspaceById: vi.fn(async () => {}),
    navigateTo: vi.fn(),
    openNewWorkspace: vi.fn(),
  };
});

vi.mock("../session/ownerKit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/ownerKit")>();
  return { ...actual, downloadOwnerKit: vi.fn(() => "research-recovery.suitekey") };
});

const exportWorkspace = vi.mocked(downloadWorkspaceById);
const navigate = vi.mocked(navigateTo);
const download = vi.mocked(downloadOwnerKit);
const startNewWorkspace = vi.mocked(openNewWorkspace);

const WORKSPACE = "ws-recent";
const TITLE = "Research";
const PASSPHRASE = "velvet otter lantern meadow";

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

function ownerKeys(): string[] {
  return Object.keys(window.localStorage).filter((key) => key.startsWith("suite.owner."));
}

function reply(status: number): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => ({}) } as Response;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A relay that records the first key to claim a workspace, like the real one. */
function stubRelay() {
  const owners = new Map<string, string>();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { ownerKey?: string };
    const workspaceId = new URL(url).pathname.split("/").at(-2) ?? "";
    const presented = await sha256(body.ownerKey ?? "");
    const owner = owners.get(workspaceId);
    if (owner === undefined) {
      owners.set(workspaceId, presented);
      return reply(200);
    }
    return reply(owner === presented ? 200 : 409);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

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
  configureSession(ownerSession());
  exportWorkspace.mockClear();
  navigate.mockClear();
  download.mockClear();
  startNewWorkspace.mockClear();
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

describe("WorkspaceLauncher passphrase choice at creation", () => {
  it("asks before making the workspace and writes nothing until answered", () => {
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId("launcher-new"));

    expect(screen.getByTestId("recovery-creation")).toHaveTextContent("Set a passphrase?");
    expect(screen.getByTestId("recovery-creation-copy")).toHaveTextContent(
      "A passphrase survives a lost device and opens this workspace on any device with the URL",
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(readRecentWorkspaces()).toEqual([]);
    expect(ownerKeys()).toEqual([]);
  });

  it("makes the derived key the workspace's only key, so URL plus passphrase owns it", async () => {
    stubRelay();
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId("launcher-new"));
    fireEvent.change(screen.getByTestId("recovery-passphrase-input"), {
      target: { value: PASSPHRASE },
    });
    fireEvent.click(screen.getByTestId("recovery-creation-set"));

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    const url = new URL(String(navigate.mock.calls[0]?.[0] ?? ""));
    const workspaceId = url.searchParams.get("workspace") ?? "";
    const derived = await deriveOwnerKey(PASSPHRASE, workspaceId);

    // The stored key is the derived one, and the link opens with it.
    expect(readOwnerKey(workspaceId)).toBe(derived);
    expect(url.hash).toBe(`#owner=${derived}`);
    expect(url.searchParams.get("fresh")).toBe("1");
    expect(window.localStorage.getItem(`suite.recoverySaved.${workspaceId}`)).toBeNull();

    // A fresh browser has the URL and the passphrase: the same words derive the
    // key that claims this workspace, and any other key is refused.
    window.localStorage.clear();
    expect(await claimWorkspace(workspaceId, await deriveOwnerKey(PASSPHRASE, workspaceId))).toBe(
      "claimed",
    );
    expect(await claimWorkspace(workspaceId, generateOwnerKey())).toBe("conflict");
  });

  it("skips with the generated key and still offers the recovery file after a backup", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const first = render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId("launcher-new"));
    fireEvent.click(screen.getByTestId("recovery-creation-skip"));

    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    const url = new URL(String(navigate.mock.calls[0]?.[0] ?? ""));
    const workspaceId = url.searchParams.get("workspace") ?? "";
    const generated = readOwnerKey(workspaceId);

    // Skip keeps the key this browser generated, untouched.
    expect(generated).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.hash).toBe(`#owner=${generated}`);
    expect(readRecentWorkspaces().map((entry) => entry.id)).toEqual([workspaceId]);
    // Nothing else is written and no key is rotated.
    expect(window.localStorage.getItem(`suite.recoverySaved.${workspaceId}`)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    // The backup prompt is intact: this key has never been saved, so an export
    // still offers the recovery file for it.
    first.unmount();
    render(<WorkspaceLauncher />);
    fireEvent.click(screen.getByTestId(`launcher-export-${workspaceId}`));

    await waitFor(() => expect(screen.getByTestId("recovery-prompt")).toBeVisible());
    fireEvent.click(screen.getByTestId("recovery-prompt-save"));
    expect(download).toHaveBeenCalledWith(workspaceId, generated, "Untitled workspace");
  });

  it("refuses a weak passphrase with the reason instead of only disabling the button", async () => {
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId("launcher-new"));
    fireEvent.change(screen.getByTestId("recovery-passphrase-input"), {
      target: { value: "cat dog" },
    });

    expect(screen.getByTestId("recovery-passphrase-problem")).toHaveTextContent(
      "at least 4 words and 16 characters",
    );
    const set = screen.getByTestId("recovery-creation-set");
    expect(set).toBeEnabled();

    fireEvent.click(set);

    expect(await screen.findByTestId("recovery-error")).toHaveTextContent(
      "at least 4 words and 16 characters",
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(readRecentWorkspaces()).toEqual([]);
    expect(ownerKeys()).toEqual([]);
  });

  it("closes on Escape and on the backdrop without changing anything", () => {
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId("launcher-new"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("recovery-creation")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("launcher-new"));
    fireEvent.click(screen.getAllByLabelText("Close passphrase choice")[0] as HTMLElement);
    expect(screen.queryByTestId("recovery-creation")).not.toBeInTheDocument();

    expect(navigate).not.toHaveBeenCalled();
    expect(readRecentWorkspaces()).toEqual([]);
    expect(ownerKeys()).toEqual([]);
  });

  it.each([
    ["a share session", "editor"],
    ["a viewer", "viewer"],
  ] as const)("never offers the choice to %s", (_label, role) => {
    configureSession(shareSession(role));
    render(<WorkspaceLauncher />);

    fireEvent.click(screen.getByTestId("launcher-new"));

    expect(screen.queryByTestId("recovery-creation")).not.toBeInTheDocument();
    expect(startNewWorkspace).toHaveBeenCalledTimes(1);
  });
});
