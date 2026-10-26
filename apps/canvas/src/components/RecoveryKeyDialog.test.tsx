import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readOwnerKey, writeOwnerKey } from "../session/ownerKey";
import { downloadOwnerKit, forgetBrowserWorkspace } from "../session/ownerKit";
import { decodeWords } from "../session/recoveryWords";
import { downloadText } from "../session/workspaceTransfer";
import { RecoveryKeyDialog } from "./RecoveryKeyDialog";

const { forgetLocal } = vi.hoisted(() => ({ forgetLocal: vi.fn() }));

vi.mock("../store/useCanvasStore", () => ({
  useCanvasStore: { getState: () => ({ forgetLocal }) },
}));

vi.mock("../session/workspaceTransfer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/workspaceTransfer")>();
  return { ...actual, downloadText: vi.fn() };
});

vi.mock("../session/ownerKit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session/ownerKit")>();
  return {
    ...actual,
    downloadOwnerKit: vi.fn(() => "research-recovery.suitekey"),
    forgetBrowserWorkspace: vi.fn(async () => {}),
  };
});

const download = vi.mocked(downloadOwnerKit);
const saveText = vi.mocked(downloadText);
const forgetBrowser = vi.mocked(forgetBrowserWorkspace);

beforeEach(() => {
  window.localStorage.clear();
  download.mockClear();
  saveText.mockClear();
  forgetBrowser.mockClear();
  forgetLocal.mockClear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
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
      "This owner file restores owner access if this browser is lost. Keep it separate from document backups.",
    );

    fireEvent.click(screen.getByTestId("recovery-save"));

    expect(download).toHaveBeenCalledWith("ws-1", "old-key", "Research");
    expect(screen.getByTestId("recovery-saved")).toHaveTextContent("Saved");
  });

  it("warns before replacing, then rotates and saves the new key", async () => {
    writeOwnerKey("ws-1", "old-key");
    const rotate = vi.fn(async (_workspaceId: string, _currentKey: string, _nextKey: string) => {});
    const revokeShares = vi.fn(async () => []);
    render(
      <RecoveryKeyDialog
        workspaceId="ws-1"
        ownerKey="old-key"
        title="Research"
        rotate={rotate}
        revokeShares={revokeShares}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("recovery-replace"));
    expect(screen.getByTestId("recovery-warning")).toHaveTextContent(
      "Existing editor links and old owner files will stop working.",
    );
    expect(screen.getByTestId("recovery-revoke-links")).toBeChecked();
    expect(rotate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("recovery-confirm"));

    await waitFor(() => expect(screen.getByTestId("recovery-reload")).toBeInTheDocument());
    expect(rotate).toHaveBeenCalledTimes(1);
    expect(revokeShares).toHaveBeenCalledWith("ws-1", expect.any(String));
    const [workspaceId, current, next] = rotate.mock.calls[0] ?? [];
    expect(workspaceId).toBe("ws-1");
    expect(current).toBe("old-key");
    expect(next).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(next).not.toBe("old-key");

    // The new key is stored before the dialog offers a reload.
    expect(readOwnerKey("ws-1")).toBe(next);
    expect(download).toHaveBeenCalledWith("ws-1", next, "Research");
    expect(screen.getByTestId("recovery-saved")).toHaveTextContent("New owner file saved.");
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
      "Backup saved. Save a separate owner file too?",
    );

    fireEvent.click(screen.getByTestId("recovery-prompt-save"));
    expect(download).toHaveBeenCalledWith("ws-1", "old-key", "Research");
    expect(screen.getByTestId("recovery-saved")).toHaveTextContent("Saved");

    fireEvent.click(screen.getByTestId("recovery-prompt-dismiss"));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("owner link and forgetting", () => {
  const ownerLink = async (boardId: string | null = null) => {
    const writeText = vi.fn(async (_text: string) => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(
      <RecoveryKeyDialog
        workspaceId="ws-1"
        ownerKey="owner-key"
        boardId={boardId}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("recovery-copy-owner-link"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    return String(writeText.mock.calls[0]?.[0] ?? "");
  };

  it("copies the owner link as a fragment with a full-ownership warning", async () => {
    const copied = await ownerLink("board-1");
    const url = new URL(copied);
    expect(url.searchParams.get("workspace")).toBe("ws-1");
    expect(url.searchParams.get("board")).toBe("board-1");
    expect(url.hash).toBe("#owner=owner-key");
    expect(url.searchParams.get("owner")).toBeNull();
    expect(screen.getByTestId("recovery-owner-link-warning")).toHaveTextContent(
      "Owner link copied. This is owner access. Anyone with it can manage links and rotate the key.",
    );
    expect(screen.getByTestId("recovery-dialog")).toHaveTextContent(
      "This is owner access. Anyone with it can manage links and rotate the key.",
    );
  });

  it("forgets only after the confirmation, then leaves the workspace", async () => {
    const onClose = vi.fn();
    const leave = vi.fn();
    render(
      <RecoveryKeyDialog workspaceId="ws-1" ownerKey="owner-key" onClose={onClose} leave={leave} />,
    );

    fireEvent.click(screen.getByTestId("recovery-forget"));
    expect(screen.getByTestId("recovery-forget-confirm")).toHaveTextContent(
      "The owner key and cached copy will be removed from this browser. The workspace stays on the server and can be reopened with your owner file or owner link.",
    );
    expect(forgetBrowser).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("recovery-forget-cancel"));
    expect(screen.queryByTestId("recovery-forget-confirm")).toBeNull();
    expect(forgetBrowser).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("recovery-forget"));
    fireEvent.click(screen.getByTestId("recovery-forget-confirm-button"));

    await waitFor(() => expect(forgetBrowser).toHaveBeenCalledWith("ws-1"));
    // The editor stops writing before the cached document is deleted.
    expect(forgetLocal).toHaveBeenCalledTimes(1);
    expect(forgetLocal.mock.invocationCallOrder[0]).toBeLessThan(
      forgetBrowser.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(onClose).toHaveBeenCalled();
    expect(leave).toHaveBeenCalled();
  });

  it("shows a saved state on this device rather than a claim about the file", () => {
    window.localStorage.setItem("suite.recoverySaved.ws-1", JSON.stringify({ savedAt: 1 }));
    render(
      <RecoveryKeyDialog
        workspaceId="ws-1"
        ownerKey="owner-key"
        title="Research"
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId("recovery-saved")).toHaveTextContent("Saved on this device");
  });
});

describe("RecoveryKeyDialog rotation links", () => {
  it("does not revoke links when the checkbox is cleared", async () => {
    writeOwnerKey("ws-1", "old-key");
    const rotate = vi.fn(async () => {});
    const revokeShares = vi.fn(async () => []);
    render(
      <RecoveryKeyDialog
        workspaceId="ws-1"
        ownerKey="old-key"
        rotate={rotate}
        revokeShares={revokeShares}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("recovery-replace"));
    fireEvent.click(screen.getByTestId("recovery-revoke-links"));
    fireEvent.click(screen.getByTestId("recovery-confirm"));

    await waitFor(() => expect(screen.getByTestId("recovery-reload")).toBeInTheDocument());
    expect(rotate).toHaveBeenCalledTimes(1);
    expect(revokeShares).not.toHaveBeenCalled();
  });
});

/** Bytes 0..31 as base64url, the same key the word tests use. */
const OWNER_KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

describe("RecoveryKeyDialog words", () => {
  it("reveals the 24 words, copies them and downloads them as text", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(
      <RecoveryKeyDialog
        workspaceId="ws-1"
        ownerKey={OWNER_KEY}
        title="Research"
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("recovery-words-open"));
    expect(screen.getByTestId("recovery-words-copy")).toHaveTextContent(
      "These 24 words are this owner key written out",
    );

    fireEvent.click(screen.getByTestId("recovery-words-reveal"));
    const list = await screen.findByTestId("recovery-words");
    expect(list.querySelectorAll("li")).toHaveLength(24);

    fireEvent.click(screen.getByTestId("recovery-words-copy-button"));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const phrase = String(writeText.mock.calls[0]?.[0] ?? "");
    expect(phrase.split(" ")).toHaveLength(24);
    await expect(decodeWords(phrase)).resolves.toEqual({ ok: true, key: OWNER_KEY });

    fireEvent.click(screen.getByTestId("recovery-words-download"));
    expect(saveText).toHaveBeenCalledWith(
      "research-owner-words.txt",
      expect.stringContaining("Workspace: ws-1"),
      "text/plain",
    );
  });
});
