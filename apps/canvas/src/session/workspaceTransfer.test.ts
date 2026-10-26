import { readWorkspaceFile, WorkspaceDocument } from "@suite/graph";
import { LoroMap, LoroText } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import {
  type AttachmentSource,
  relayAttachmentSource,
  resolveAttachmentBytes,
} from "./attachmentBytes";
import {
  BACKUP_SIZE_WARNING_BYTES,
  backupSizeWarning,
  documentAttachments,
  importWorkspaceFile,
  missingAttachmentWarning,
  prepareWorkspaceBackup,
  workspaceUrl,
} from "./workspaceTransfer";

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

describe("workspaceUrl", () => {
  it("builds a plain editor URL with ids only", () => {
    const url = new URL(workspaceUrl("ws-1", "board-1"));
    expect(url.searchParams.get("workspace")).toBe("ws-1");
    expect(url.searchParams.get("board")).toBe("board-1");
    expect(url.hash).toBe("");
  });

  it("carries no credential: the fragment is always empty", () => {
    window.history.replaceState({}, "", "/?workspace=old#owner=old-key");

    const plain = new URL(workspaceUrl("ws-2"));
    expect(plain.hash).toBe("");

    const withBoard = new URL(workspaceUrl("ws-2", "board-1"));
    expect(withBoard.hash).toBe("");
    expect(withBoard.searchParams.get("board")).toBe("board-1");
  });
});

/* ------------------------------------------------------- .suite with images */

const ATTACHMENT_ID = "0123456789abcdef0123456789abcdef";
/** A PNG signature plus bytes > 127 and 0x00: the values a lossy encoder mangles. */
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x80, 0x00, 0xc3,
]);

function writeTitle(workspace: WorkspaceDocument, cardId: string, text: string): void {
  const title = workspace.getTitle(cardId);
  title.set("nodeName", "doc");
  title.ensureMergeableMap("attributes");
  const blocks = title.ensureMergeableList("children");
  blocks.clear();
  const paragraph = blocks.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  const inline = paragraph.ensureMergeableList("children");
  inline.insertContainer(0, new LoroText()).insert(0, text);
}

function writeBodyImage(
  workspace: WorkspaceDocument,
  cardId: string,
  attributes: {
    id: string;
    mime: string;
    width: number;
    height: number;
    name: string;
    bytes: number;
  },
): void {
  const root = workspace.getContent(cardId);
  root.set("nodeName", "doc");
  root.ensureMergeableMap("attributes");
  const blocks = root.ensureMergeableList("children");
  blocks.clear();
  const paragraph = blocks.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  const inline = paragraph.ensureMergeableList("children");
  const node = inline.insertContainer(0, new LoroMap());
  node.set("nodeName", "attachment");
  const attrs = node.ensureMergeableMap("attributes");
  for (const [key, value] of Object.entries(attributes)) attrs.set(key, value);
}

/** One board, one card called "Trip plan" holding one image. */
function workspaceWithImage() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  workspace.renameBoard(board.id, "Research");
  workspace.createCard({ id: "card-1", boardId: board.id, position: { x: 0, y: 0 } });
  writeTitle(workspace, "card-1", "Trip plan");
  writeBodyImage(workspace, "card-1", {
    id: ATTACHMENT_ID,
    mime: "image/png",
    width: 1,
    height: 1,
    name: "pixel.png",
    bytes: PNG.byteLength,
  });
  workspace.doc.commit({ origin: "test" });
  return workspace;
}

function localSource(bytes: Uint8Array | null): AttachmentSource {
  return {
    name: "local",
    read: async (id) =>
      id === ATTACHMENT_ID && bytes !== null ? { bytes, mime: "image/png" } : null,
  };
}

function emptySource(name: string): AttachmentSource {
  return { name, read: async () => null };
}

describe("workspace backup attachments", () => {
  it("round-trips a pasted image byte-for-byte and restores it under the node's id", async () => {
    const workspace = workspaceWithImage();
    const prepared = await prepareWorkspaceBackup("ws-1", workspace, {
      sources: [localSource(PNG)],
    });

    expect(prepared.missing).toEqual([]);
    expect(prepared.warnings).toEqual([]);
    expect(prepared.json).toContain(ATTACHMENT_ID);

    const restored: Array<{ id: string; bytes: Uint8Array; mime: string }> = [];
    const imported = await importWorkspaceFile(
      new File([prepared.json], "research.suite", { type: "application/json" }),
      {
        storeAttachment: async (id, bytes, mime) => {
          restored.push({ id, bytes, mime });
        },
        persist: async () => {},
      },
    );

    expect(imported.title).toBe("Research");
    expect(restored).toHaveLength(1);
    expect(restored[0]?.id).toBe(ATTACHMENT_ID);
    expect(Array.from(restored[0]?.bytes ?? [])).toEqual(Array.from(PNG));
    expect(restored[0]?.mime).toBe("image/png");

    // The restored document still carries the same node id, which is the key the
    // local store was just written under, so AttachmentView resolves it.
    const parsed = readWorkspaceFile(prepared.json);
    expect(documentAttachments(parsed.workspace).map((entry) => entry.id)).toEqual([ATTACHMENT_ID]);
    expect(parsed.attachments.map((entry) => entry.id)).toEqual([ATTACHMENT_ID]);
  });

  it("fetches an image that exists only on the relay", async () => {
    const workspace = workspaceWithImage();
    const requests: string[] = [];
    const relay = relayAttachmentSource({
      request: async (url) => {
        requests.push(url);
        return new Response(PNG as unknown as BodyInit, {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      },
      url: (id) => `http://relay.test/api/attachments/${id}`,
    });
    expect(relay).not.toBeNull();

    const prepared = await prepareWorkspaceBackup("ws-1", workspace, {
      sources: [localSource(null), relay as AttachmentSource],
    });

    expect(requests).toEqual([`http://relay.test/api/attachments/${ATTACHMENT_ID}`]);
    expect(prepared.missing).toEqual([]);
    const parsed = readWorkspaceFile(prepared.json);
    expect(Array.from(parsed.attachments[0]?.bytes ?? [])).toEqual(Array.from(PNG));
  });

  it("reports an image missing everywhere by card title, and still exports", async () => {
    const workspace = workspaceWithImage();
    const prepared = await prepareWorkspaceBackup("ws-1", workspace, {
      sources: [emptySource("local"), emptySource("relay")],
    });

    expect(prepared.missing).toHaveLength(1);
    expect(prepared.missing[0]?.cards).toEqual([{ id: "card-1", title: "Trip plan" }]);
    expect(prepared.warnings).toEqual([missingAttachmentWarning(prepared.missing)]);
    expect(missingAttachmentWarning(prepared.missing)).toBe(
      "1 image is missing from this backup (card “Trip plan”). Everything else exported; that image will show a placeholder.",
    );

    // The export still completed, and the document in it is intact.
    const parsed = readWorkspaceFile(prepared.json);
    expect(parsed.workspace.listCards()).toHaveLength(1);
    expect(parsed.workspace.displayTitle("card-1")).toBe("Trip plan");
    expect(parsed.attachments).toEqual([]);
  });

  it("imports a v1 file that has no attachments section", async () => {
    const workspace = workspaceWithImage();
    const prepared = await prepareWorkspaceBackup("ws-1", workspace, {
      sources: [emptySource("local")],
    });
    const envelope = JSON.parse(prepared.json) as Record<string, unknown>;
    delete envelope.attachments;
    envelope.version = 1;

    const restored: string[] = [];
    const imported = await importWorkspaceFile(
      new File([JSON.stringify(envelope)], "older.suite", { type: "application/json" }),
      {
        storeAttachment: async (id) => {
          restored.push(id);
        },
        persist: async () => {},
      },
    );

    expect(imported.title).toBe("Research");
    expect(restored).toEqual([]);
  });

  it("lists an image the backup could not carry, by card title, on the way in", async () => {
    // The envelope has no entry for the image the document draws: the shape a
    // hand-edited or truncated backup has, and the one that used to import a
    // silent hole.
    const workspace = workspaceWithImage();
    const prepared = await prepareWorkspaceBackup("ws-1", workspace, {
      sources: [emptySource("local")],
    });
    const envelope = JSON.parse(prepared.json) as Record<string, unknown>;
    envelope.attachments = {};

    const imported = await importWorkspaceFile(
      new File([JSON.stringify(envelope)], "partial.suite", { type: "application/json" }),
      { storeAttachment: async () => {}, persist: async () => {} },
    );

    expect(imported.warnings).toHaveLength(1);
    // The card, not the id: a person knows "Trip plan", not a hex string.
    expect(imported.warnings[0]).toContain("Trip plan");
    expect(imported.warnings[0]).toContain("missing or unreadable in this backup");
    expect(imported.warnings[0]).not.toContain(ATTACHMENT_ID);
  });

  it("has nothing to warn about when every image came back", async () => {
    const workspace = workspaceWithImage();
    const prepared = await prepareWorkspaceBackup("ws-1", workspace, {
      sources: [localSource(PNG)],
    });

    const imported = await importWorkspaceFile(
      new File([prepared.json], "complete.suite", { type: "application/json" }),
      { storeAttachment: async () => {}, persist: async () => {} },
    );

    expect(imported.warnings).toEqual([]);
  });

  it("warns with the real size above the threshold and stays quiet below it", () => {
    expect(BACKUP_SIZE_WARNING_BYTES).toBe(25 * 1024 * 1024);
    expect(backupSizeWarning(BACKUP_SIZE_WARNING_BYTES - 1)).toBeNull();
    expect(backupSizeWarning(BACKUP_SIZE_WARNING_BYTES)).toContain("25.0 MB");

    const warning = backupSizeWarning(30 * 1024 * 1024);
    expect(warning).toContain("30.0 MB");
    expect(warning).toContain("every image is included");
  });

  it("counts every missing image and names each affected card once", () => {
    const warning = missingAttachmentWarning([
      { id: "a", name: null, cards: [{ id: "card-1", title: "Trip plan" }] },
      {
        id: "b",
        name: null,
        cards: [
          { id: "card-2", title: "Packing list" },
          { id: "card-3", title: "Trip plan" },
        ],
      },
    ]);

    expect(warning).toContain("2 images are missing");
    expect(warning).toContain("“Trip plan”, “Packing list”");
  });

  it("puts the size warning in front of the file when the threshold is crossed", async () => {
    const prepared = await prepareWorkspaceBackup("ws-1", workspaceWithImage(), {
      sources: [localSource(PNG)],
      sizeWarningBytes: 1,
    });

    expect(prepared.warnings).toHaveLength(1);
    expect(prepared.warnings[0]).toContain("MB");
    expect(prepared.warnings[0]).toContain("every image is included");
  });

  it("resolves the local copy before asking the relay", async () => {
    const localBytes = new Uint8Array([0xff, 0x00, 0x80]);
    let relayAsked = false;
    const resolved = await resolveAttachmentBytes(ATTACHMENT_ID, [
      { name: "local", read: async () => ({ bytes: localBytes, mime: "image/png" }) },
      {
        name: "relay",
        read: async () => {
          relayAsked = true;
          return null;
        },
      },
    ]);

    expect(resolved?.bytes).toEqual(localBytes);
    expect(relayAsked).toBe(false);
  });
});
