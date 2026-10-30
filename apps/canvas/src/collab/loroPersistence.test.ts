import { WorkspaceDocument } from "@suite/graph";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { LoroDoc, LoroList, LoroMap, LoroText, VersionVector } from "loro-crdt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LoroIndexeddbPersistence, PERSIST_CHANNEL_PREFIX, versionCovers } from "./loroPersistence";

/**
 * A2: two tabs over one IndexedDB. A compacts while B holds unmerged text; B
 * reloads; B's text survives. The old `compact()` deleted every row in the
 * workspace index after writing *its own* snapshot, so a leader with a stale
 * document destroyed a peer's only durable copy.
 */

/** The minimum of the Web Locks API the persistence layer uses. */
class TestLockManager {
  private readonly held = new Set<string>();

  async request(
    name: string,
    _options: { mode?: string; ifAvailable?: boolean },
    callback: (lock: { name: string } | null) => Promise<unknown>,
  ): Promise<unknown> {
    if (this.held.has(name)) return callback(null);
    this.held.add(name);
    try {
      return await callback({ name });
    } finally {
      this.held.delete(name);
    }
  }

  heldNames(): string[] {
    return [...this.held];
  }
}

class TestBroadcastChannel {
  /** Simulates two tabs that cannot see each other (offline, or a frozen tab). */
  static drop = false;
  static readonly hubs = new Map<string, Set<TestBroadcastChannel>>();
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(readonly name: string) {
    const hub = TestBroadcastChannel.hubs.get(name) ?? new Set<TestBroadcastChannel>();
    hub.add(this);
    TestBroadcastChannel.hubs.set(name, hub);
  }

  postMessage(data: unknown): void {
    if (TestBroadcastChannel.drop) return;
    for (const peer of TestBroadcastChannel.hubs.get(this.name) ?? []) {
      if (peer === this) continue;
      queueMicrotask(() => peer.onmessage?.({ data } as MessageEvent));
    }
  }

  close(): void {
    TestBroadcastChannel.hubs.get(this.name)?.delete(this);
  }
}

let locks: TestLockManager;

beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", {
    value: new IDBFactory(),
    configurable: true,
  });
  locks = new TestLockManager();
  Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
  Object.defineProperty(globalThis, "BroadcastChannel", {
    value: TestBroadcastChannel,
    configurable: true,
  });
  TestBroadcastChannel.drop = true;
});

afterEach(() => {
  TestBroadcastChannel.hubs.clear();
  TestBroadcastChannel.drop = false;
});

const WORKSPACE = "workspace-1";

function workspaceOf(doc: LoroDoc): WorkspaceDocument {
  return new WorkspaceDocument(doc);
}

/** A card title is a document tree; the editor writes a paragraph into it. */
function writeTitle(workspace: WorkspaceDocument, cardId: string, text: string): void {
  const title = workspace.getTitle(cardId);
  title.set("nodeName", "doc");
  const blocks = title.getOrCreateContainer("children", new LoroList());
  const paragraph = blocks.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.getOrCreateContainer("attributes", new LoroMap());
  const inline = paragraph.getOrCreateContainer("children", new LoroList());
  inline.insertContainer(0, new LoroText()).insert(0, text);
  // One commit per gesture is the editor's contract: `subscribeLocalUpdates`
  // fires per commit, and a persistence layer cannot save what was never
  // committed.
  workspace.doc.commit({ origin: "test:title" });
}

async function rows(): Promise<{ tabId?: string; version?: Uint8Array }[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("suite-loro");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = db
        .transaction("updates")
        .objectStore("updates")
        .index("workspaceId")
        .getAll(IDBKeyRange.only(WORKSPACE));
      request.onsuccess = () => resolve(request.result as { tabId?: string }[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function storedSnapshot(): Promise<{ updatedAt: number; version?: Uint8Array } | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("suite-loro");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("snapshots").objectStore("snapshots").get(WORKSPACE);
      request.onsuccess = () => resolve(request.result as { updatedAt: number } | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

describe("version vectors", () => {
  it("reports containment only when every peer counter is covered", () => {
    const peers = (entries: [string, number][]): Map<`${number}`, number> =>
      new Map(entries as [`${number}`, number][]);
    const covers = VersionVector.parseJSON(
      peers([
        ["1", 4],
        ["2", 2],
      ]),
    );
    const inside = VersionVector.parseJSON(peers([["1", 4]]));
    const outside = VersionVector.parseJSON(
      peers([
        ["1", 5],
        ["2", 1],
      ]),
    );
    const concurrent = VersionVector.parseJSON(peers([["3", 1]]));
    expect(versionCovers(covers, inside)).toBe(true);
    expect(versionCovers(covers, outside)).toBe(false);
    expect(versionCovers(covers, concurrent)).toBe(false);
  });
});

describe("two tabs on one workspace", () => {
  it("keeps a peer's unmerged text when the leader compacts", async () => {
    // Tab A opens first and wins the compaction lock.
    const docA = new LoroDoc();
    docA.setPeerId(1n);
    const workspaceA = workspaceOf(docA);
    const board = workspaceA.createBoard({ id: "board-1", name: "Board" });
    const persistenceA = new LoroIndexeddbPersistence(WORKSPACE, docA, { tabId: "tab-a" });
    await persistenceA.open();
    expect(await persistenceA.compact()).toBe("compacted");
    expect(locks.heldNames()).toContain(`suite-compact:${WORKSPACE}`);

    // Tab B loads the same workspace and edits while it cannot reach A.
    const docB = new LoroDoc();
    docB.setPeerId(2n);
    const persistenceB = new LoroIndexeddbPersistence(WORKSPACE, docB, { tabId: "tab-b" });
    await persistenceB.load();
    const workspaceB = workspaceOf(docB);
    const offline = ["Offline one", "Offline two", "Offline three"].map((title) => {
      const card = workspaceB.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
      writeTitle(workspaceB, card.id, title);
      return card.id;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const before = await rows();
    // One row per commit: a card creation and its title write each append once.
    expect(before.filter((row) => row.tabId === "tab-b").length).toBeGreaterThanOrEqual(3);
    expect(before.every((row) => row.version !== undefined)).toBe(true);

    // A compacts its stale document. It cannot prove B's rows are in its
    // snapshot, so they must survive — this is the regression the old
    // `getAllKeys` loop failed.
    expect(await persistenceA.compact()).toBe("compacted");
    const after = await rows();
    expect(after).toHaveLength(before.length);
    expect(after.filter((row) => row.tabId === "tab-b")).toHaveLength(
      before.filter((row) => row.tabId === "tab-b").length,
    );

    // B reloads into a fresh document, as a browser restart would.
    persistenceB.destroy();
    const reloaded = new LoroDoc();
    const persistenceB2 = new LoroIndexeddbPersistence(WORKSPACE, reloaded, { tabId: "tab-b" });
    await persistenceB2.load();
    const workspaceReloaded = workspaceOf(reloaded);
    expect(workspaceReloaded.listBoards().map((entry) => entry.name)).toEqual(["Board"]);
    const titles = workspaceReloaded
      .listCards()
      .map((card) => workspaceReloaded.displayTitle(card.id));
    expect(titles).toEqual(expect.arrayContaining(["Offline one", "Offline two", "Offline three"]));
    expect(
      offline.every((id) => workspaceReloaded.listCards().some((card) => card.id === id)),
    ).toBe(true);

    persistenceA.destroy();
    persistenceB2.destroy();
  });

  it("takes over compaction when the leader tab closes", async () => {
    // Tab A leads and has a snapshot on disk.
    const docA = new LoroDoc();
    docA.setPeerId(1n);
    workspaceOf(docA).createBoard({ id: "board-1", name: "Board" });
    const persistenceA = new LoroIndexeddbPersistence(WORKSPACE, docA, { tabId: "tab-a" });
    await persistenceA.load();
    expect(await persistenceA.compact()).toBe("compacted");

    // B follows: while A holds the lock, compaction is a no-op.
    const docB = new LoroDoc();
    docB.setPeerId(2n);
    const persistenceB = new LoroIndexeddbPersistence(WORKSPACE, docB, {
      tabId: "tab-b",
      leadershipRetryMs: 0,
    });
    await persistenceB.load();
    expect(await persistenceB.compact()).toBe("follower");
    const cardB = workspaceOf(docB).createCard({
      boardId: "board-1",
      position: { x: 0, y: 0 },
    });
    writeTitle(workspaceOf(docB), cardB.id, "B keeps this");

    // C follows too, and its edit is in neither A's nor B's document.
    const docC = new LoroDoc();
    docC.setPeerId(3n);
    const persistenceC = new LoroIndexeddbPersistence(WORKSPACE, docC, {
      tabId: "tab-c",
      leadershipRetryMs: 0,
    });
    await persistenceC.load();
    const cardC = workspaceOf(docC).createCard({
      boardId: "board-1",
      position: { x: 5, y: 5 },
    });
    writeTitle(workspaceOf(docC), cardC.id, "C keeps this");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const cRows = (await rows()).filter((row) => row.tabId === "tab-c");
    expect(cRows.length).toBeGreaterThan(0);

    // A closes. Its lock is released, and B must notice on its next compaction
    // — without a reload, which is what the previous election could not do.
    persistenceA.destroy();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await persistenceB.compact()).toBe("compacted");
    // B prunes only what its snapshot covers; C's rows are untouched.
    expect((await rows()).filter((row) => row.tabId === "tab-c")).toHaveLength(cRows.length);
    expect((await rows()).filter((row) => row.tabId === "tab-b")).toHaveLength(0);

    persistenceB.destroy();
    persistenceC.destroy();
    const reloaded = new LoroDoc();
    const persistenceReloaded = new LoroIndexeddbPersistence(WORKSPACE, reloaded, {
      tabId: "tab-b",
    });
    await persistenceReloaded.load();
    const restored = workspaceOf(reloaded);
    expect(restored.listCards().map((card) => restored.displayTitle(card.id))).toEqual(
      expect.arrayContaining(["B keeps this", "C keeps this"]),
    );
    persistenceReloaded.destroy();
  });

  it("makes compaction from a non-leader a no-op", async () => {
    const docA = new LoroDoc();
    const persistenceA = new LoroIndexeddbPersistence(WORKSPACE, docA, { tabId: "tab-a" });
    await persistenceA.open();
    await persistenceA.compact();
    const first = await storedSnapshot();

    const docB = new LoroDoc();
    docB.import(docA.export({ mode: "snapshot" }));
    const persistenceB = new LoroIndexeddbPersistence(WORKSPACE, docB, { tabId: "tab-b" });
    await persistenceB.load();
    expect(await persistenceB.compact()).toBe("follower");
    expect(await persistenceB.flush()).toBeUndefined();
    const second = await storedSnapshot();
    expect(second?.updatedAt).toBe(first?.updatedAt);
    expect(second?.version).toEqual(first?.version);

    persistenceA.destroy();
    persistenceB.destroy();
  });

  it("deletes rows a snapshot provably covers, so the log does not grow forever", async () => {
    const docA = new LoroDoc();
    const persistenceA = new LoroIndexeddbPersistence(WORKSPACE, docA, { tabId: "tab-a" });
    await persistenceA.load();
    workspaceOf(docA).createBoard({ id: "board-1", name: "Board" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await rows()).length).toBeGreaterThan(0);

    expect(await persistenceA.compact()).toBe("compacted");
    expect(await rows()).toHaveLength(0);
    persistenceA.destroy();
  });

  it("never deletes an update row that carries no version", async () => {
    const docA = new LoroDoc();
    const persistenceA = new LoroIndexeddbPersistence(WORKSPACE, docA, { tabId: "tab-a" });
    await persistenceA.open();
    await persistenceA.compact();

    // A row from before A2, or from a build that did not record a version:
    // nothing can prove the snapshot contains it.
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("suite-loro");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("updates", "readwrite");
      transaction.objectStore("updates").add({
        workspaceId: WORKSPACE,
        bytes: new Uint8Array([1, 2, 3]),
        createdAt: Date.now(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
    db.close();

    await persistenceA.compact();
    const remaining = await rows();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.version).toBeUndefined();
    persistenceA.destroy();
  });
});

describe("without the Web Locks API", () => {
  it("keeps every tab's own log and still deletes only what is covered", async () => {
    Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });

    const docA = new LoroDoc();
    docA.setPeerId(1n);
    const workspaceA = workspaceOf(docA);
    const persistenceA = new LoroIndexeddbPersistence(WORKSPACE, docA, { tabId: "tab-a" });
    await persistenceA.load();
    workspaceA.createBoard({ id: "board-1", name: "Board" });
    expect(await persistenceA.compact()).toBe("compacted");

    const docB = new LoroDoc();
    docB.setPeerId(2n);
    const persistenceB = new LoroIndexeddbPersistence(WORKSPACE, docB, { tabId: "tab-b" });
    await persistenceB.load();
    const workspaceB = workspaceOf(docB);
    const card = workspaceB.createCard({ boardId: "board-1", position: { x: 1, y: 1 } });
    writeTitle(workspaceB, card.id, "Written without a lock");
    await new Promise((resolve) => setTimeout(resolve, 20));

    // B's document contains A's snapshot plus B's own work, so B may write a
    // snapshot — and deletes only the rows it appended itself.
    const beforeB = await rows();
    expect(beforeB.filter((row) => row.tabId === "tab-b").length).toBeGreaterThan(0);
    expect(await persistenceB.compact()).toBe("compacted");
    expect((await rows()).filter((row) => row.tabId === "tab-b")).toHaveLength(0);

    // A cannot replace that snapshot: A has not seen B's card, so writing would
    // strand it. The guard, not luck, is what keeps the edit.
    expect(await persistenceA.compact()).toBe("skipped");

    persistenceB.destroy();
    const reloaded = new LoroDoc();
    const persistenceB2 = new LoroIndexeddbPersistence(WORKSPACE, reloaded, { tabId: "tab-b" });
    await persistenceB2.load();
    const restored = workspaceOf(reloaded);
    expect(restored.listBoards().map((entry) => entry.name)).toEqual(["Board"]);
    expect(restored.listCards().map((entry) => restored.displayTitle(entry.id))).toContain(
      "Written without a lock",
    );

    persistenceA.destroy();
    persistenceB2.destroy();
  });

  it("refuses to replace a snapshot its document has not caught up with", async () => {
    Object.defineProperty(navigator, "locks", { value: undefined, configurable: true });

    const docA = new LoroDoc();
    docA.setPeerId(1n);
    workspaceOf(docA).createBoard({ id: "board-1", name: "Board" });
    const persistenceA = new LoroIndexeddbPersistence(WORKSPACE, docA, { tabId: "tab-a" });
    await persistenceA.load();
    expect(await persistenceA.compact()).toBe("compacted");

    // A tab that never loaded this workspace holds different work. Writing its
    // snapshot would drop everything the stored one has, so it must not write.
    const docC = new LoroDoc();
    docC.setPeerId(3n);
    workspaceOf(docC).createBoard({ id: "board-c", name: "Elsewhere" });
    const persistenceC = new LoroIndexeddbPersistence(WORKSPACE, docC, { tabId: "tab-c" });
    await persistenceC.open();
    expect(await persistenceC.compact()).toBe("skipped");
    expect((await rows()).filter((row) => row.tabId === "tab-c")).toHaveLength(0);

    persistenceA.destroy();
    persistenceC.destroy();
  });
});

describe("the channel name", () => {
  it("is scoped per workspace, so two workspaces never share updates", () => {
    expect(`${PERSIST_CHANNEL_PREFIX}${WORKSPACE}`).toBe("suite-persist:workspace-1");
  });
});

describe("batch loading and fallback", () => {
  it("batch-imports offline updates on load", async () => {
    const docA = new LoroDoc();
    docA.setPeerId(1n);
    const wsA = workspaceOf(docA);
    const board = wsA.createBoard({ id: "board-1", name: "Board" });
    const pA = new LoroIndexeddbPersistence(WORKSPACE, docA, { tabId: "tab-a" });
    await pA.open();
    await pA.compact();

    const docB = new LoroDoc();
    docB.setPeerId(2n);
    const pB = new LoroIndexeddbPersistence(WORKSPACE, docB, { tabId: "tab-b" });
    await pB.load();
    const wsB = workspaceOf(docB);
    wsB.createCard({ boardId: board.id, position: { x: 10, y: 10 } });
    wsB.createCard({ boardId: board.id, position: { x: 20, y: 20 } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    pA.destroy();
    pB.destroy();

    const docC = new LoroDoc();
    const pC = new LoroIndexeddbPersistence(WORKSPACE, docC, { tabId: "tab-c" });
    await pC.load();
    const wsC = workspaceOf(docC);
    expect(wsC.listBoardCards(board.id)).toHaveLength(2);
    pC.destroy();
  });

  it("falls back to sequential import when an update in the store is corrupt", async () => {
    const docA = new LoroDoc();
    docA.setPeerId(1n);
    const wsA = workspaceOf(docA);
    const board = wsA.createBoard({ id: "board-1", name: "Board" });
    const pA = new LoroIndexeddbPersistence(WORKSPACE, docA, { tabId: "tab-a" });
    await pA.open();
    await pA.compact();

    const docB = new LoroDoc();
    docB.setPeerId(2n);
    const pB = new LoroIndexeddbPersistence(WORKSPACE, docB, { tabId: "tab-b" });
    await pB.load();
    const wsB = workspaceOf(docB);
    wsB.createCard({ boardId: board.id, position: { x: 10, y: 10 } });
    await new Promise((resolve) => setTimeout(resolve, 50));

    pA.destroy();
    pB.destroy();

    // Inject a corrupt update record directly into IndexedDB
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open("suite-loro");
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("updates", "readwrite");
      tx.objectStore("updates").add({
        workspaceId: WORKSPACE,
        tabId: "tab-corrupt",
        bytes: new Uint8Array([99, 99, 99]),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();

    const docC = new LoroDoc();
    const pC = new LoroIndexeddbPersistence(WORKSPACE, docC, { tabId: "tab-c" });
    await pC.load();
    const wsC = workspaceOf(docC);
    expect(wsC.listBoardCards(board.id)).toHaveLength(1);
    pC.destroy();
  });
});
