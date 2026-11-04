import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { createWorkspacePersistence } from "./workspacePersistence";

describe("createWorkspacePersistence", () => {
  it("answers null when the page has no workspace to persist", () => {
    expect(
      createWorkspacePersistence({
        host: "web",
        roomId: null,
        doc: new LoroDoc(),
        indexedDb: true,
      }),
    ).toBeNull();
  });

  it("answers null in an environment without IndexedDB", () => {
    expect(
      createWorkspacePersistence({
        host: "web",
        roomId: "room-1",
        doc: new LoroDoc(),
        indexedDb: false,
      }),
    ).toBeNull();
  });

  it("answers the IndexedDB adapter on the web", () => {
    const persistence = createWorkspacePersistence({
      host: "web",
      roomId: "room-1",
      doc: new LoroDoc(),
      indexedDb: true,
    });
    expect(persistence).not.toBeNull();
    expect(typeof persistence?.load).toBe("function");
    expect(typeof persistence?.flush).toBe("function");
    expect(typeof persistence?.destroy).toBe("function");
  });

  it("refuses to run a desktop build with no file store", () => {
    // Silently persisting nowhere is the failure this product cannot accept, so
    // an unwired desktop host throws rather than opening a memory-only session.
    expect(() =>
      createWorkspacePersistence({
        host: "desktop",
        roomId: "room-1",
        doc: new LoroDoc(),
        indexedDb: true,
      }),
    ).toThrow(/desktop persistence is not wired yet/u);
  });
});
