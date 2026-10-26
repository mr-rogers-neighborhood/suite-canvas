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
});
