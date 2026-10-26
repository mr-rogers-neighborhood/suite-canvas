import { WorkspaceDocument } from "@suite/graph";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoroList, LoroMap, LoroText } from "loro-crdt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestPersistence, useDurabilityStore } from "./durability";
import { StorageWarningBanner, storageWarningState } from "./StorageWarningBanner";

/**
 * A3: the refusal is visible where the reader already is.
 *
 * The storage panel is behind a press, so a denied `persist()` used to be
 * visible only to someone who opened it. The banner is the same state outside
 * the popover, and the point of the test is that the *document* is untouched by
 * any of it: persistence is a side channel, never the source of truth.
 */

function titledWorkspace(): { workspace: WorkspaceDocument; cardId: string } {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureBoard();
  const card = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const title = workspace.getTitle(card.id);
  title.set("nodeName", "doc");
  const blocks = title.getOrCreateContainer("children", new LoroList());
  const paragraph = blocks.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.getOrCreateContainer("attributes", new LoroMap());
  const inline = paragraph.getOrCreateContainer("children", new LoroList());
  inline.insertContainer(0, new LoroText()).insert(0, "Kept while storage says no");
  workspace.doc.commit({ origin: "test:title" });
  return { workspace, cardId: card.id };
}

describe("storage warning outside the popover", () => {
  beforeEach(() => {
    useDurabilityStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("warns and offers an export when persist() resolves false", async () => {
    const persist = vi.fn(async () => false);
    await requestPersistence({ persist, persisted: async () => false });
    expect(persist).toHaveBeenCalledTimes(1);

    const onExport = vi.fn();
    render(<StorageWarningBanner workspaceId="ws-1" onExport={onExport} />);

    const warning = screen.getByTestId("storage-shell-warning");
    expect(warning).toHaveTextContent("has not promised to keep this workspace");
    expect(warning).toHaveAttribute("role", "status");

    fireEvent.click(screen.getByTestId("storage-shell-export"));
    expect(onExport).toHaveBeenCalledWith("ws-1");
    await waitFor(() =>
      expect(screen.getByTestId("storage-shell-export")).toHaveTextContent("Exported"),
    );
  });

  it("keeps the in-memory document through a denial and a refused write", async () => {
    const { workspace, cardId } = titledWorkspace();
    const before = workspace.displayTitle(cardId);
    expect(before).toBe("Kept while storage says no");

    // The browser says no, then a write is refused for quota: the two states
    // that used to be invisible. Neither touches the document.
    await requestPersistence({ persist: async () => false, persisted: async () => false });
    useDurabilityStore
      .getState()
      .noteQuotaExceeded(
        "This browser is out of storage, so the latest change could not be saved.",
      );

    render(<StorageWarningBanner workspaceId="ws-1" onExport={vi.fn()} />);

    // The quota sentence is present tense and wins over the general warning.
    await waitFor(() =>
      expect(screen.getByTestId("storage-shell-warning")).toHaveTextContent("out of storage"),
    );

    // Still one card, still its text: a denial is a storage fact, not an edit.
    expect(workspace.listCards().map((card) => card.id)).toEqual([cardId]);
    expect(workspace.displayTitle(cardId)).toBe(before);
  });

  it("renders nothing while the browser has promised to keep the copy", async () => {
    await requestPersistence({ persist: async () => true, persisted: async () => true });
    render(<StorageWarningBanner workspaceId="ws-1" />);
    expect(screen.queryByTestId("storage-shell-warning")).not.toBeInTheDocument();
  });

  it("treats every 'no promise' answer as the same warning", () => {
    const quota = { message: "out of storage", at: 1 };
    expect(storageWarningState({ persist: "denied", quota: null }).visible).toBe(true);
    expect(storageWarningState({ persist: "unsupported", quota: null }).visible).toBe(true);
    expect(storageWarningState({ persist: "persisted", quota: null }).visible).toBe(false);
    expect(storageWarningState({ persist: "unknown", quota: null }).visible).toBe(false);
    expect(storageWarningState({ persist: "persisted", quota }).message).toBe(quota.message);
    // The ladder's quiet rungs stay quiet here too: an account or a peer in the
    // room means this browser's copy is not the only one.
    expect(storageWarningState({ persist: "denied", quota: null, signedIn: true }).visible).toBe(
      false,
    );
    expect(storageWarningState({ persist: "denied", quota: null, synced: true }).visible).toBe(
      false,
    );
  });
});
