import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveOwnerKey, readOwnerKey, writeOwnerKey } from "../session/ownerKey";
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
      "This file restores owner access if this browser is lost. Keep it separate from document backups.",
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
      "Existing editor links and old recovery files will stop working.",
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
      "The owner key and cached copy will be removed from this browser. The workspace stays on the server and can be reopened with your recovery key or owner link.",
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
const PASSPHRASE = "velvet otter lantern meadow";

describe("RecoveryKeyDialog recovery words", () => {
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
      "Recovery words survive a lost browser and a lost file",
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
      "research-recovery-words.txt",
      expect.stringContaining("Workspace: ws-1"),
      "text/plain",
    );
  });
});

describe("RecoveryKeyDialog passphrase", () => {
  it("says why a weak passphrase cannot be set instead of only disabling the button", () => {
    render(<RecoveryKeyDialog workspaceId="ws-1" ownerKey="old-key" onClose={() => {}} />);

    fireEvent.click(screen.getByTestId("recovery-passphrase-open"));
    expect(screen.getByTestId("recovery-passphrase-copy")).toHaveTextContent(
      "A passphrase survives a lost browser, a lost file and a new device",
    );

    fireEvent.change(screen.getByTestId("recovery-passphrase-input"), {
      target: { value: "cat dog" },
    });
    expect(screen.getByTestId("recovery-passphrase-problem")).toHaveTextContent(
      "at least 4 words and 16 characters",
    );
    expect(screen.getByTestId("recovery-passphrase-continue")).toBeDisabled();

    fireEvent.change(screen.getByTestId("recovery-passphrase-input"), {
      target: { value: PASSPHRASE },
    });
    expect(screen.getByTestId("recovery-passphrase-problem")).toHaveTextContent(
      "Suite never stores the passphrase.",
    );
    expect(screen.getByTestId("recovery-passphrase-continue")).toBeEnabled();
  });

  it("replaces the stored key with the derived key through the rotation path", async () => {
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

    fireEvent.click(screen.getByTestId("recovery-passphrase-open"));
    fireEvent.change(screen.getByTestId("recovery-passphrase-input"), {
      target: { value: PASSPHRASE },
    });
    fireEvent.click(screen.getByTestId("recovery-passphrase-continue"));
    expect(screen.getByTestId("recovery-passphrase-warning")).toHaveTextContent(
      "Existing editor links and old .suitekey recovery files will stop working",
    );
    expect(rotate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("recovery-passphrase-confirm"));

    await waitFor(() => expect(screen.getByTestId("recovery-reload")).toBeInTheDocument(), {
      timeout: 10_000,
    });
    const [, current, next] = rotate.mock.calls[0] ?? [];
    expect(current).toBe("old-key");
    expect(next).toBe(await deriveOwnerKey(PASSPHRASE, "ws-1"));

    // The stored key is the derived one; the old key (and its file) is useless.
    expect(readOwnerKey("ws-1")).toBe(next);
    expect(readOwnerKey("ws-1")).not.toBe("old-key");
    expect(revokeShares).toHaveBeenCalledWith("ws-1", next);

    expect(screen.getByTestId("recovery-saved")).toHaveTextContent("Passphrase set.");
    expect(screen.getByTestId("recovery-passphrase-stale")).toHaveTextContent(
      "Old editor links and old .suitekey files no longer open this workspace.",
    );
    // The passphrase is the backup, so no replacement .suitekey is offered.
    expect(screen.queryByTestId("recovery-rotate-download")).toBeNull();
    expect(download).not.toHaveBeenCalled();
  });

  it("keeps the old key when the passphrase rotation is refused", async () => {
    writeOwnerKey("ws-1", "old-key");
    const rotate = vi.fn(async () => {
      throw new Error("This browser no longer holds the current owner key.");
    });
    render(
      <RecoveryKeyDialog
        workspaceId="ws-1"
        ownerKey="old-key"
        rotate={rotate}
        revokeShares={vi.fn(async () => [])}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("recovery-passphrase-open"));
    fireEvent.change(screen.getByTestId("recovery-passphrase-input"), {
      target: { value: PASSPHRASE },
    });
    fireEvent.click(screen.getByTestId("recovery-passphrase-continue"));
    fireEvent.click(screen.getByTestId("recovery-passphrase-confirm"));

    await waitFor(
      () =>
        expect(screen.getByTestId("recovery-error")).toHaveTextContent(
          "This browser no longer holds the current owner key.",
        ),
      { timeout: 10_000 },
    );
    expect(readOwnerKey("ws-1")).toBe("old-key");
    expect(screen.getByTestId("recovery-passphrase-confirm")).toBeInTheDocument();
  });
});

describe("RecoveryKeyDialog creation choice", () => {
  it("offers one decision and says what each answer survives", () => {
    render(
      <RecoveryKeyDialog
        mode="creation-prompt"
        workspaceId="ws-new"
        ownerKey="generated-key"
        onClose={() => {}}
      />,
    );

    const dialog = screen.getByTestId("recovery-creation");
    expect(dialog).toHaveTextContent("Set a passphrase?");
    expect(dialog).toHaveTextContent(
      "A passphrase survives a lost device and opens this workspace on any device with the URL",
    );
    expect(dialog).toHaveTextContent("a recovery file survives a lost browser");
    expect(dialog).toHaveTextContent(
      "if the browser and the device are both lost, the workspace is gone",
    );
    expect(dialog).toHaveTextContent("You can set a passphrase later from File");
    expect(screen.getByTestId("recovery-creation-set")).toHaveTextContent("Set passphrase");
    expect(screen.getByTestId("recovery-creation-skip")).toHaveTextContent("Skip for now");
  });

  it("hands over the derived key without rotating or marking anything saved", async () => {
    writeOwnerKey("ws-new", "generated-key");
    const rotate = vi.fn(async () => {});
    const choose = vi.fn();
    render(
      <RecoveryKeyDialog
        mode="creation-prompt"
        workspaceId="ws-new"
        ownerKey="generated-key"
        rotate={rotate}
        onSetPassphrase={choose}
        onClose={() => {}}
      />,
    );

    fireEvent.change(screen.getByTestId("recovery-passphrase-input"), {
      target: { value: PASSPHRASE },
    });
    expect(screen.getByTestId("recovery-passphrase-problem")).toHaveTextContent(
      "Suite never stores the passphrase.",
    );
    fireEvent.click(screen.getByTestId("recovery-creation-set"));

    await waitFor(() => expect(choose).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(choose).toHaveBeenCalledWith(await deriveOwnerKey(PASSPHRASE, "ws-new"));

    // Creation has nothing to rotate: no key has claimed the workspace yet.
    expect(rotate).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
    expect(readOwnerKey("ws-new")).toBe("generated-key");
    expect(window.localStorage.getItem("suite.recoverySaved.ws-new")).toBeNull();
  });

  it("leaves the generated key and the saved state alone on skip", () => {
    writeOwnerKey("ws-new", "generated-key");
    const rotate = vi.fn(async () => {});
    const skip = vi.fn();
    render(
      <RecoveryKeyDialog
        mode="creation-prompt"
        workspaceId="ws-new"
        ownerKey="generated-key"
        rotate={rotate}
        onSkip={skip}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId("recovery-creation-skip"));

    expect(skip).toHaveBeenCalledTimes(1);
    expect(rotate).not.toHaveBeenCalled();
    expect(readOwnerKey("ws-new")).toBe("generated-key");
    expect(window.localStorage.getItem("suite.recoverySaved.ws-new")).toBeNull();
  });

  it("refuses a weak passphrase with the reason and keeps the button usable", async () => {
    const choose = vi.fn();
    render(
      <RecoveryKeyDialog
        mode="creation-prompt"
        workspaceId="ws-new"
        ownerKey="generated-key"
        onSetPassphrase={choose}
        onClose={() => {}}
      />,
    );

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
    expect(choose).not.toHaveBeenCalled();
    expect(screen.queryByTestId("recovery-saved")).not.toBeInTheDocument();
  });

  it("closes on Escape and on the backdrop without changing anything", () => {
    writeOwnerKey("ws-new", "generated-key");
    const onClose = vi.fn();
    render(
      <RecoveryKeyDialog
        mode="creation-prompt"
        workspaceId="ws-new"
        ownerKey="generated-key"
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    fireEvent.click(screen.getAllByLabelText("Close passphrase choice")[0] as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);

    expect(readOwnerKey("ws-new")).toBe("generated-key");
    expect(window.localStorage.getItem("suite.recoverySaved.ws-new")).toBeNull();
    expect(download).not.toHaveBeenCalled();
  });
});
