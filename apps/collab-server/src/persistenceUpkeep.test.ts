import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { LoroDoc } from "loro-crdt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureSqlite, createDocumentStore, type DocumentStore } from "./persistence.js";

type Store = ReturnType<typeof createDocumentStore>;

let directory: string;
let path: string;
let store: Store;

beforeEach(() => {
  // Kept inside the package rather than the system temp directory, and
  // removed in `afterEach`.
  directory = mkdtempSync(join(import.meta.dirname, ".sqlite-test-"));
  path = join(directory, "documents.sqlite");
  store = createDocumentStore(path);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function save(name: string, value: string): void {
  const doc = new LoroDoc();
  doc.getMap("cards").set("card-1", value);
  doc.commit();
  store.save(name, doc.export({ mode: "snapshot" }));
}

describe("document store upkeep", () => {
  it("opens the database in WAL mode", () => {
    expect(store.journalMode().toLowerCase()).toBe("wal");
    expect(store.inventory().journalMode.toLowerCase()).toBe("wal");
  });

  it("reports a read-only inventory of the store", () => {
    save("workspace-one", "kept");
    save("workspace-two", "kept");

    const facts = store.inventory();
    expect(facts.path).toBe(path);
    expect(facts.documents).toBe(2);
    expect(facts.bytes).toBeGreaterThan(0);
    expect(facts.bytes).toBe(store.size());
  });

  it("keeps WAL for the connections the other stores open themselves", () => {
    // The share and workspace stores never set a journal mode: it is a
    // property of the file, so setting it once is enough.
    const second = new DatabaseSync(path);
    try {
      const row = second.prepare("PRAGMA journal_mode").get() as { journal_mode?: string };
      expect(row.journal_mode?.toLowerCase()).toBe("wal");
    } finally {
      second.close();
    }
    expect(configureSqlite(path).toLowerCase()).toBe("wal");
  });

  it("runs PRAGMA optimize without touching the data", () => {
    save("workspace-one", "kept");

    expect(() => store.optimize()).not.toThrow();
    const state = store.load("workspace-one");
    expect(state).not.toBeNull();
    const doc = new LoroDoc();
    doc.import(state as Uint8Array);
    expect(doc.getMap("cards").get("card-1")).toBe("kept");
  });

  it("schedules maintenance on an unref'd timer", () => {
    const timer = store.startMaintenance(60_000);
    expect(timer.hasRef()).toBe(false);
    // Starting twice returns the same timer instead of leaking a second one.
    expect(store.startMaintenance(60_000)).toBe(timer);
  });

  it("creates a missing database already in WAL mode", () => {
    const missing = join(directory, "fresh.sqlite");
    expect(configureSqlite(missing).toLowerCase()).toBe("wal");

    const fresh = new DatabaseSync(missing);
    try {
      const row = fresh.prepare("PRAGMA journal_mode").get() as { journal_mode?: string };
      expect(row.journal_mode?.toLowerCase()).toBe("wal");
    } finally {
      fresh.close();
    }
  });
});

describe("document store compatibility", () => {
  it("still satisfies the DocumentStore surface used by other modules", () => {
    const asStore: DocumentStore = store;
    save("workspace-one", "kept");
    expect(asStore.load("workspace-one")).not.toBeNull();
    asStore.delete("workspace-one");
    expect(asStore.load("workspace-one")).toBeNull();
  });
});
