import { WorkspaceDocument } from "@suite/graph";
import { renderHook } from "@testing-library/react";
import { LoroList, LoroMap, LoroText } from "loro-crdt";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestPersistence, useDurabilityStore } from "./durability";
import { storageWarningState, useStorageWarning } from "./storageWarning";

/** The live answer, read the way the sync panel reads it. */
function currentWarning() {
  return renderHook(() => useStorageWarning()).result.current;
}

/**
 * Whether this device's copy is at risk.
 *
 * Persistence is a side channel, never the source of truth: none of these states
 * may touch the document, which is what the second case pins down.
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

describe("the storage warning", () => {
  beforeEach(() => {
    useDurabilityStore.getState().reset();
  });

  it("warns when persist() resolves false, and says what to do about it", async () => {
    const persist = vi.fn(async () => false);
    await requestPersistence({ persist, persisted: async () => false });
    expect(persist).toHaveBeenCalledTimes(1);

    const warning = currentWarning();
    expect(warning.visible).toBe(true);
    expect(warning.message).toContain("has not promised to keep this workspace");
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

    // The quota sentence is present tense and wins over the general warning.
    expect(currentWarning().message).toContain("out of storage");

    // Still one card, still its text: a denial is a storage fact, not an edit.
    expect(workspace.listCards().map((card) => card.id)).toEqual([cardId]);
    expect(workspace.displayTitle(cardId)).toBe(before);
  });

  it("says nothing while the browser has promised to keep the copy", async () => {
    await requestPersistence({ persist: async () => true, persisted: async () => true });
    expect(currentWarning().visible).toBe(false);
  });

  it("treats every 'no promise' answer as the same warning", () => {
    const quota = { message: "out of storage", at: 1 };
    expect(storageWarningState({ persist: "denied", quota: null }).visible).toBe(true);
    expect(storageWarningState({ persist: "unsupported", quota: null }).visible).toBe(true);
    expect(storageWarningState({ persist: "persisted", quota: null }).visible).toBe(false);
    expect(storageWarningState({ persist: "unknown", quota: null }).visible).toBe(false);
    expect(storageWarningState({ persist: "persisted", quota }).message).toBe(quota.message);
    // The ladder's quiet rungs stay quiet here too — but only once there really is
    // another copy. An account with no synced workspace has not made one.
    expect(
      storageWarningState({ persist: "denied", quota: null, signedIn: true, synced: true }).visible,
    ).toBe(false);
    expect(storageWarningState({ persist: "denied", quota: null, signedIn: true }).visible).toBe(
      true,
    );
    expect(storageWarningState({ persist: "denied", quota: null, synced: true }).visible).toBe(
      false,
    );
  });
});
