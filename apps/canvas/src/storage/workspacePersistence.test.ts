import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import type { DesktopBridge } from "../host/bridge";
import { LoroDesktopPersistence } from "./desktopPersistence";
import { createWorkspacePersistence } from "./workspacePersistence";

function fakeBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    host: "desktop",
    version: "0.1.0",
    platform: "linux",
    loadDocument: async () => null,
    saveDocument: async () => {},
    flushDocument: async () => ({ ok: true }),
    documentInfo: async () => null,
    appInfo: async () => ({ host: "desktop", version: "0.1.0", platform: "linux" }),
    ...overrides,
  };
}

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

  it("refuses a desktop build with no bridge rather than persisting nowhere", () => {
    // Silently persisting nowhere is the failure this product cannot accept, so
    // a desktop host with no shell throws instead of opening a memory-only session.
    expect(() =>
      createWorkspacePersistence({
        host: "desktop",
        roomId: "room-1",
        doc: new LoroDoc(),
        indexedDb: true,
        bridge: null,
      }),
    ).toThrow(/no shell bridge is present/u);
  });

  it("answers the file adapter when a shell is hosting the page", () => {
    const persistence = createWorkspacePersistence({
      host: "desktop",
      roomId: "room-1",
      doc: new LoroDoc(),
      indexedDb: true,
      bridge: fakeBridge(),
    });
    expect(persistence).toBeInstanceOf(LoroDesktopPersistence);
  });
});
