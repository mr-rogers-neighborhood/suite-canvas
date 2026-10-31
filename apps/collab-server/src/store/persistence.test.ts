import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LoroDoc } from "loro-crdt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDocumentStore, type DocumentStore } from "./persistence.js";

let directory: string;
let store: DocumentStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "suite-store-"));
  store = createDocumentStore(join(directory, "documents.sqlite"));
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function write(doc: LoroDoc, key: string, value: string): void {
  doc.getMap("cards").set(key, value);
  doc.commit();
}

function read(state: Uint8Array): LoroDoc {
  const doc = new LoroDoc();
  doc.import(state);
  return doc;
}

describe("document store", () => {
  it("returns null for a document that was never saved", () => {
    expect(store.load("missing")).toBeNull();
  });

  it("round-trips a document's state", () => {
    const doc = new LoroDoc();
    write(doc, "card-1", "Kept");

    store.save("workspace", doc.export({ mode: "snapshot" }));

    expect(
      read(store.load("workspace") as Uint8Array)
        .getMap("cards")
        .get("card-1"),
    ).toBe("Kept");
  });

  it("overwrites the same document on save", () => {
    const doc = new LoroDoc();
    write(doc, "card-1", "first");
    store.save("workspace", doc.export({ mode: "snapshot" }));

    write(doc, "card-1", "second");
    store.save("workspace", doc.export({ mode: "snapshot" }));

    expect(
      read(store.load("workspace") as Uint8Array)
        .getMap("cards")
        .get("card-1"),
    ).toBe("second");
  });

  it("keeps documents separate", () => {
    const one = new LoroDoc();
    write(one, "card-1", "one");
    const two = new LoroDoc();
    write(two, "card-1", "two");
    store.save("one", one.export({ mode: "snapshot" }));
    store.save("two", two.export({ mode: "snapshot" }));

    expect(
      read(store.load("two") as Uint8Array)
        .getMap("cards")
        .get("card-1"),
    ).toBe("two");
  });

  it("appends delta updates and merges them on load", () => {
    const doc = new LoroDoc();
    write(doc, "card-1", "initial");
    store.save("workspace", doc.export({ mode: "snapshot" }));

    const v1 = doc.version();
    write(doc, "card-2", "delta-one");
    const update1 = doc.export({ mode: "update", from: v1 });
    store.appendUpdate("workspace", update1);

    const v2 = doc.version();
    write(doc, "card-3", "delta-two");
    const update2 = doc.export({ mode: "update", from: v2 });
    store.appendUpdate("workspace", update2);

    // Reading immediately answers with all updates merged
    const loadedBytes = store.load("workspace");
    expect(loadedBytes).not.toBeNull();
    const loaded = read(loadedBytes as Uint8Array);
    expect(loaded.getMap("cards").get("card-1")).toBe("initial");
    expect(loaded.getMap("cards").get("card-2")).toBe("delta-one");
    expect(loaded.getMap("cards").get("card-3")).toBe("delta-two");
  });

  it("compacts delta updates on the next full snapshot save", () => {
    const doc = new LoroDoc();
    write(doc, "card-1", "base");
    store.save("workspace", doc.export({ mode: "snapshot" }));

    const v1 = doc.version();
    write(doc, "card-2", "delta");
    const update = doc.export({ mode: "update", from: v1 });
    store.appendUpdate("workspace", update);

    // Checkpoint save clears compacted delta rows
    store.save("workspace", doc.export({ mode: "snapshot" }));
    store.close();

    // Reopen store from disk to verify SQLite state directly
    const reopened = createDocumentStore(join(directory, "documents.sqlite"));
    try {
      const loaded = read(reopened.load("workspace") as Uint8Array);
      expect(loaded.getMap("cards").get("card-1")).toBe("base");
      expect(loaded.getMap("cards").get("card-2")).toBe("delta");
    } finally {
      reopened.close();
    }
    // Restore store reference for afterEach cleanup
    store = createDocumentStore(join(directory, "documents.sqlite"));
  });

  it("deleting a document removes both snapshots and delta updates", () => {
    const doc = new LoroDoc();
    write(doc, "card-1", "base");
    store.save("workspace", doc.export({ mode: "snapshot" }));

    const v1 = doc.version();
    write(doc, "card-2", "delta");
    store.appendUpdate("workspace", doc.export({ mode: "update", from: v1 }));

    store.delete("workspace");
    expect(store.load("workspace")).toBeNull();
  });
});
