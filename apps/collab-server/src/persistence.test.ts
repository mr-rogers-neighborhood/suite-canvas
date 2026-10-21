import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
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

describe("document store", () => {
  it("returns null for a document that was never saved", () => {
    expect(store.load("missing")).toBeNull();
  });

  it("round-trips a document's state", () => {
    const doc = new Y.Doc();
    doc.getMap("cards").set("card-1", { title: "Kept" });

    store.save("workspace", Y.encodeStateAsUpdate(doc));

    const restored = new Y.Doc();
    Y.applyUpdate(restored, store.load("workspace") as Uint8Array);
    expect(restored.getMap("cards").get("card-1")).toEqual({ title: "Kept" });
  });

  it("overwrites the same document on save", () => {
    const doc = new Y.Doc();
    doc.getMap("cards").set("card-1", "first");
    store.save("workspace", Y.encodeStateAsUpdate(doc));

    doc.getMap("cards").set("card-1", "second");
    store.save("workspace", Y.encodeStateAsUpdate(doc));

    const restored = new Y.Doc();
    Y.applyUpdate(restored, store.load("workspace") as Uint8Array);
    expect(restored.getMap("cards").get("card-1")).toBe("second");
  });

  it("keeps documents separate", () => {
    const one = new Y.Doc();
    one.getMap("meta").set("name", "one");
    const two = new Y.Doc();
    two.getMap("meta").set("name", "two");
    store.save("one", Y.encodeStateAsUpdate(one));
    store.save("two", Y.encodeStateAsUpdate(two));

    const restored = new Y.Doc();
    Y.applyUpdate(restored, store.load("two") as Uint8Array);
    expect(restored.getMap("meta").get("name")).toBe("two");
  });
});
