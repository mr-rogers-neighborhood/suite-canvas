import { WorkspaceDocument } from "@suite/graph";
// The editor's byte store is IndexedDB, and this project has none of its own.
import "fake-indexeddb/auto";
import { LoroDoc, LoroList, LoroMap } from "loro-crdt";
import { beforeEach, describe, expect, it } from "vitest";
import { storeLocalAttachment } from "../editor/attachmentNode";
import type { BridgeSaveRequest, DesktopBridge } from "../host/bridge";
import { LoroDesktopPersistence } from "./desktopPersistence";

/**
 * The gap this covers: the desktop shell writes the file, but the editor puts
 * pasted bytes in IndexedDB. Without this, an image lives in a browser cache and
 * never reaches the file the user owns.
 *
 * The document is written through the real graph API, with the node shape
 * `documentAttachments` looks for, so the test cannot pass on a shape the app
 * never produces.
 */

const IMAGE_ID = "0123456789abcdef0123456789abcdef";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x80, 0x00]);

interface Recording {
  readonly bridge: DesktopBridge;
  readonly saved: BridgeSaveRequest[];
}

function bridge(): Recording {
  const saved: BridgeSaveRequest[] = [];
  return {
    saved,
    bridge: {
      host: "desktop",
      version: "0.1.0",
      platform: "linux",
      loadDocument: async () => null,
      saveDocument: async (request) => {
        saved.push(request);
      },
      flushDocument: async () => ({ ok: true }),
      documentInfo: async () => null,
      appInfo: async () => ({ host: "desktop", version: "0.1.0", platform: "linux" }),
      openFileDialog: async () => {},
      openDocument: async () => {},
      recentFiles: async () => [],
      forgetRecent: async () => {},
    },
  };
}

/**
 * Insert an image block into a card body, written the way `loro-prosemirror`
 * writes one: a `doc` whose `children` are nodes, with the image's fields under
 * `attributes` (which the tree-to-JSON conversion presents as `attrs`).
 */
function attachImage(workspace: WorkspaceDocument, cardId: string, id: string): void {
  const content = workspace.getContent(cardId);
  content.set("nodeName", "doc");
  const blocks = content.getOrCreateContainer("children", new LoroList());
  const node = blocks.insertContainer(blocks.length, new LoroMap());
  node.set("nodeName", "attachment");
  const attributes = node.getOrCreateContainer("attributes", new LoroMap());
  attributes.set("id", id);
  attributes.set("name", "pixel.png");
  attributes.set("mime", "image/png");
  attributes.set("width", 1);
  attributes.set("height", 1);
  workspace.doc.commit({ origin: "test:image" });
}

function workspaceWithCard(): { doc: LoroDoc; workspace: WorkspaceDocument; boardId: string } {
  const doc = new LoroDoc();
  const workspace = new WorkspaceDocument(doc);
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  workspace.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
  return { doc, workspace, boardId: board.id };
}

beforeEach(async () => {
  await storeLocalAttachment(IMAGE_ID, PNG, "image/png");
});

describe("images pasted in the desktop app reach the file", () => {
  it("sends the bytes once the document references them", async () => {
    const { doc, workspace } = workspaceWithCard();
    const shell = bridge();
    const persistence = new LoroDesktopPersistence("ws-1", doc, shell.bridge);
    await persistence.load();

    // Before the image exists: the shell was told the set is empty.
    await expect.poll(() => shell.saved.length).toBeGreaterThan(0);
    expect(shell.saved.at(-1)?.attachments).toEqual([]);

    attachImage(workspace, "c1", IMAGE_ID);

    await expect
      .poll(() => shell.saved.at(-1)?.attachments?.map((entry) => entry.id))
      .toEqual([IMAGE_ID]);

    const sent = shell.saved.at(-1)?.attachments?.[0];
    expect(sent?.mime).toBe("image/png");
    expect(sent?.name).toBe("pixel.png");
    expect(Array.from(sent?.bytes ?? [])).toEqual(Array.from(PNG));

    persistence.destroy();
  });

  it("keeps sending the same set once it is established", async () => {
    const { doc, workspace } = workspaceWithCard();
    const shell = bridge();
    const persistence = new LoroDesktopPersistence("ws-1", doc, shell.bridge);
    await persistence.load();

    attachImage(workspace, "c1", IMAGE_ID);
    await expect.poll(() => shell.saved.at(-1)?.attachments?.length).toBe(1);

    // A later edit that does not touch the image omits the section, so the shell
    // keeps what it already has instead of receiving it again.
    workspace.renameBoard(workspace.listBoards()[0]?.id ?? "b", "Renamed");
    await expect.poll(() => shell.saved.at(-1)?.manifest.boards).toBe(1);
    expect(shell.saved.at(-1)?.attachments).toBeUndefined();

    persistence.destroy();
  });
});
