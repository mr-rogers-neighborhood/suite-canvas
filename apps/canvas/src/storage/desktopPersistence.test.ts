import { WorkspaceDocument } from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it, vi } from "vitest";
import type { BridgeSaveRequest, DesktopBridge } from "../host/bridge";
import { LoroDesktopPersistence } from "./desktopPersistence";

interface RecordingBridge {
  readonly bridge: DesktopBridge;
  readonly saved: BridgeSaveRequest[];
  flushes(): number;
}

function bridge(overrides: Partial<DesktopBridge> = {}): RecordingBridge {
  const saved: BridgeSaveRequest[] = [];
  let flushes = 0;
  const base: DesktopBridge = {
    host: "desktop",
    version: "0.1.0",
    platform: "linux",
    loadDocument: async () => null,
    saveDocument: async (request) => {
      saved.push(request);
    },
    flushDocument: async () => {
      flushes += 1;
      return { ok: true };
    },
    documentInfo: async () => null,
    appInfo: async () => ({ host: "desktop", version: "0.1.0", platform: "linux" }),
    openFileDialog: async () => {},
    openDocument: async () => {},
    recentFiles: async () => [],
    forgetRecent: async () => {},
  };
  // A plain object, not a getter: `Object.assign` would evaluate a getter once
  // and freeze the count at zero.
  return { bridge: { ...base, ...overrides }, saved, flushes: () => flushes };
}

function sourceWorkspace(): WorkspaceDocument {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  workspace.renameBoard(board.id, "Research");
  workspace.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
  return workspace;
}

describe("LoroDesktopPersistence", () => {
  it("imports the snapshot the shell opened, without saving it back", async () => {
    const source = sourceWorkspace();
    const shell = bridge({
      loadDocument: async () => ({
        info: {
          workspaceId: "ws-1",
          path: "/home/me/Documents/Suite/Canvas/Research.canvas",
          name: "Research.canvas",
          migratedFrom: null,
          recoveredFrom: null,
        },
        snapshot: new Uint8Array(source.exportSnapshot()),
      }),
    });

    const doc = new LoroDoc();
    const persistence = new LoroDesktopPersistence("ws-1", doc, shell.bridge);
    await persistence.load();

    const restored = new WorkspaceDocument(doc);
    expect(restored.listCards().map((card) => card.id)).toEqual(["c1"]);
    // Loading is not an edit: forwarding it would make every open a write.
    expect(shell.saved).toEqual([]);
    persistence.destroy();
  });

  it("forwards a local edit as a whole snapshot, counted for the manifest", async () => {
    const doc = new LoroDoc();
    const workspace = new WorkspaceDocument(doc);
    workspace.ensureDefaultTypes();
    const board = workspace.ensureBoard();
    const shell = bridge();

    const persistence = new LoroDesktopPersistence("ws-1", doc, shell.bridge);
    await persistence.load();
    workspace.createCard({ id: "c9", boardId: board.id, position: { x: 1, y: 1 } });

    // Wait for the edit's save rather than for any save: creating the document
    // writes once with no cards, and that one is not the subject of the test.
    await vi.waitFor(() => expect(shell.saved.at(-1)?.manifest.cards).toBe(1));
    const request = shell.saved.at(-1);
    expect(request?.workspaceId).toBe("ws-1");
    expect(request?.snapshot).toBeInstanceOf(Uint8Array);
    expect(request?.manifest.boards).toBe(1);
    persistence.destroy();
  });

  it("asks the shell to flush on flush", async () => {
    const doc = new LoroDoc();
    const shell = bridge();
    const persistence = new LoroDesktopPersistence("ws-1", doc, shell.bridge);
    await persistence.load();
    await persistence.flush();
    expect(shell.flushes()).toBe(1);
    persistence.destroy();
  });

  it("reports a refusal the main process made on flush", async () => {
    const onFailure = vi.fn();
    const shell = bridge({
      flushDocument: async () => ({
        ok: false,
        code: "changed-on-disk",
        message: "Research.canvas changed on disk since Suite saved it.",
      }),
    });
    const persistence = new LoroDesktopPersistence("ws-1", new LoroDoc(), shell.bridge, {
      onFailure,
    });
    await persistence.load();
    await persistence.flush();
    expect(onFailure).toHaveBeenCalledWith({
      code: "changed-on-disk",
      message: expect.stringContaining("changed on disk"),
    });
    persistence.destroy();
  });

  it("writes a document the shell has not opened yet, so a new workspace has a file", async () => {
    const doc = new LoroDoc();
    const workspace = new WorkspaceDocument(doc);
    workspace.ensureDefaultTypes();
    // No document open in the main process: the launcher just made this one.
    const shell = bridge({ loadDocument: async () => null });

    const persistence = new LoroDesktopPersistence("ws-1", doc, shell.bridge);
    await persistence.load();

    await vi.waitFor(() => expect(shell.saved.length).toBe(1));
    expect(shell.saved[0]?.workspaceId).toBe("ws-1");
    expect(shell.saved[0]?.snapshot.byteLength).toBeGreaterThan(0);
    persistence.destroy();
  });

  it("sends the workspace name, so the file is named after the work", async () => {
    const doc = new LoroDoc();
    const workspace = new WorkspaceDocument(doc);
    workspace.ensureDefaultTypes();
    workspace.ensureBoard();
    // The workspace's own name, not a board's: a board name is not the unit a
    // file is named after.
    workspace.renameWorkspace("Field notes");
    const shell = bridge({ loadDocument: async () => null });

    const persistence = new LoroDesktopPersistence("ws-1", doc, shell.bridge);
    await persistence.load();

    await vi.waitFor(() => expect(shell.saved.length).toBe(1));
    expect(shell.saved[0]?.title).toBe("Field notes");
    persistence.destroy();
  });

  it("stops forwarding once destroyed", async () => {
    const doc = new LoroDoc();
    const workspace = new WorkspaceDocument(doc);
    workspace.ensureDefaultTypes();
    const shell = bridge();
    const persistence = new LoroDesktopPersistence("ws-1", doc, shell.bridge);
    await persistence.load();
    await vi.waitFor(() => expect(shell.saved.length).toBeGreaterThan(0));
    const before = shell.saved.length;

    persistence.destroy();
    workspace.ensureBoard();
    await Promise.resolve();
    expect(shell.saved.length).toBe(before);
  });
});

describe("LoroDesktopPersistence attachments", () => {
  it("sends images only when the referenced set changes", async () => {
    const doc = new LoroDoc();
    const workspace = new WorkspaceDocument(doc);
    workspace.ensureDefaultTypes();
    const board = workspace.ensureBoard();
    const shell = bridge({ loadDocument: async () => null });

    const persistence = new LoroDesktopPersistence("ws-1", doc, shell.bridge);
    await persistence.load();
    await vi.waitFor(() => expect(shell.saved.length).toBeGreaterThan(0));

    // The first save states the set explicitly, empty though it is: that is how
    // the shell learns there are no images rather than having to assume it.
    expect(shell.saved.at(-1)?.attachments).toEqual([]);

    // An edit that leaves the referenced set alone omits the section, so a
    // routine autosave does not re-send megabytes it already sent.
    workspace.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
    await vi.waitFor(() => expect(shell.saved.at(-1)?.manifest.cards).toBe(1));
    expect(shell.saved.at(-1)?.attachments).toBeUndefined();

    persistence.destroy();
  });
});
