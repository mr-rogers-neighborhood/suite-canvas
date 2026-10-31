import { LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import {
  createWorkspaceFile,
  damagedAttachmentWarning,
  parseWorkspaceFile,
  readWorkspaceFile,
  WORKSPACE_FILE_KIND,
  WORKSPACE_FILE_VERSION,
} from "./workspaceFile.js";

function workspace() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  workspace.renameBoard(board.id, "Research");
  workspace.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
  workspace.createTag({ name: "reading" });
  workspace.addField("note", { name: "Status", kind: "text" });
  return workspace;
}

describe("workspace file", () => {
  it("should round-trip a workspace snapshot and manifest", () => {
    const source = workspace();
    const { file, json } = createWorkspaceFile("ws-1", source, "2026-10-22T00:00:00.000Z");

    expect(file.kind).toBe(WORKSPACE_FILE_KIND);
    expect(file.version).toBe(WORKSPACE_FILE_VERSION);
    expect(file.manifest).toMatchObject({ boards: 1, cards: 1, tags: 1 });

    const { workspace: restored, file: parsed } = readWorkspaceFile(json);
    expect(parsed.workspaceId).toBe("ws-1");
    expect(restored.listBoards().map((board) => board.name)).toEqual(["Research"]);
    expect(restored.getCard("c1")?.id).toBe("c1");
    expect(restored.listTags().map((tag) => tag.name)).toEqual(["reading"]);
  });

  it("should support compact export omitting historical edit logs", () => {
    const source = workspace();
    const boardId = source.listBoards()[0]?.id ?? "";
    // Generate multiple historical commits
    for (let i = 0; i < 20; i++) {
      source.renameBoard(boardId, `Name ${i}`);
    }
    const full = createWorkspaceFile("ws-1", source);
    const compact = createWorkspaceFile("ws-1", source, undefined, {}, { compact: true });

    expect(compact.json.length).toBeLessThan(full.json.length);
    const { workspace: restored } = readWorkspaceFile(compact.json);
    expect(restored.listBoards()[0]?.name).toBe("Name 19");
    expect(restored.getCard("c1")?.id).toBe("c1");
  });

  it("should refuse a future file version by name", () => {
    const { file } = createWorkspaceFile("ws-1", workspace());
    expect(() => parseWorkspaceFile({ ...file, version: WORKSPACE_FILE_VERSION + 1 })).toThrow(
      /newer Suite/,
    );
  });

  it("should refuse a future schema version by name", () => {
    const { file } = createWorkspaceFile("ws-1", workspace());
    expect(() => parseWorkspaceFile({ ...file, schemaVersion: file.schemaVersion + 1 })).toThrow(
      /schema/,
    );
  });

  it("should refuse a file that is not a Suite backup", () => {
    expect(() => parseWorkspaceFile({ hello: "world" })).toThrow(/not a Suite workspace backup/);
  });

  it("should refuse a corrupt snapshot", () => {
    const { file } = createWorkspaceFile("ws-1", workspace());
    expect(() => parseWorkspaceFile({ ...file, document: "not base64" })).toThrow(/corrupt/);
  });

  it("should embed an attachment byte-for-byte, including bytes above 127", () => {
    const id = "0123456789abcdef0123456789abcdef";
    // A PNG signature plus the byte values that a string-based encoder mangles:
    // 0xff, 0x80 and 0x00 are not Latin-1 safe in every path a naive btoa takes.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x80, 0x00, 0xc3,
    ]);
    const { file, json } = createWorkspaceFile("ws-1", workspace(), "2026-10-22T00:00:00.000Z", {
      [id]: { mime: "image/png", name: "pixel.png", width: 1, height: 1, bytes: png },
    });

    expect(file.version).toBe(WORKSPACE_FILE_VERSION);
    expect(file.attachments[id]).toMatchObject({ mime: "image/png", name: "pixel.png" });

    // The envelope really is base64 of those bytes, not a lossy string copy.
    const encoded = atob(file.attachments[id]?.data ?? "");
    expect(Array.from(encoded, (character) => character.charCodeAt(0))).toEqual(Array.from(png));

    const { attachments } = readWorkspaceFile(json);
    expect(attachments).toHaveLength(1);
    expect(Array.from(attachments[0]?.bytes ?? [])).toEqual(Array.from(png));
    expect(attachments[0]?.id).toBe(id);
  });

  it("should import a v1 file that has no attachments key", () => {
    const { file } = createWorkspaceFile("ws-1", workspace());
    const { attachments: _omitted, ...older } = file;

    const parsed = parseWorkspaceFile({ ...older, version: 1 });
    expect(parsed.file.attachments).toEqual({});
    expect(parsed.attachments).toEqual([]);
    expect(parsed.workspace.listCards().map((card) => card.id)).toEqual(["c1"]);
  });

  it("should keep the document readable when one attachment entry is unreadable", () => {
    const { file } = createWorkspaceFile("ws-1", workspace(), "2026-10-22T00:00:00.000Z", {
      "0123456789abcdef0123456789abcdef": {
        mime: "image/png",
        name: "broken.png",
        width: null,
        height: null,
        bytes: new Uint8Array([1, 2, 3]),
      },
    });
    const parsed = parseWorkspaceFile({
      ...file,
      attachments: {
        ...file.attachments,
        bad: { ...file.attachments["0123456789abcdef0123456789abcdef"], data: "not base64" },
      },
    });
    expect(parsed.workspace.listCards()).toHaveLength(1);
    expect(parsed.attachments.map((entry) => entry.id)).toEqual([
      "0123456789abcdef0123456789abcdef",
    ]);
  });

  it("should restore intact images and name the damaged ones by card title", () => {
    // A workspace with three images: one intact, one whose base64 is damaged,
    // one whose entry was deleted from the envelope. The intact one restores,
    // the other two are reported against the cards that draw them.
    const intact = "aa".repeat(16);
    const corrupt = "bb".repeat(16);
    const absent = "cc".repeat(16);
    const source = new WorkspaceDocument();
    source.ensureDefaultTypes();
    const board = source.ensureBoard();
    const imagesCard = source.createCard({
      id: "c-images",
      boardId: board.id,
      position: { x: 0, y: 0 },
    }).id;
    writeTitledBody(source, imagesCard, "Field notes", [intact, corrupt]);
    const absentCard = source.createCard({
      id: "c-absent",
      boardId: board.id,
      position: { x: 0, y: 0 },
    }).id;
    writeTitledBody(source, absentCard, "Loose ends", [absent]);

    const bytesFor = (seed: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed]);
    const { file } = createWorkspaceFile("ws-1", source, "2026-10-22T00:00:00.000Z", {
      [intact]: { mime: "image/png", name: "intact.png", width: 1, height: 1, bytes: bytesFor(1) },
      [corrupt]: {
        mime: "image/png",
        name: "corrupt.png",
        width: 1,
        height: 1,
        bytes: bytesFor(2),
      },
      [absent]: { mime: "image/png", name: "absent.png", width: 1, height: 1, bytes: bytesFor(3) },
    });

    // Corrupt one entry, delete another: exactly what a half-written or
    // hand-edited backup looks like.
    const damagedFile = {
      ...file,
      attachments: {
        [intact]: file.attachments[intact],
        [corrupt]: { ...file.attachments[corrupt], data: "not base64" },
      },
    };

    const parsed = readWorkspaceFile(JSON.stringify(damagedFile));

    // The intact image came back byte for byte.
    expect(parsed.attachments.map((entry) => entry.id)).toEqual([intact]);
    expect(Array.from(parsed.attachments[0]?.bytes ?? [])).toEqual(Array.from(bytesFor(1)));

    // Nothing was dropped silently: both losses are named against a card title.
    expect(Object.fromEntries(parsed.damaged.map((entry) => [entry.id, entry.reason]))).toEqual({
      [corrupt]: "corrupt",
      [absent]: "absent",
    });
    const byId = new Map(parsed.damaged.map((entry) => [entry.id, entry.cards]));
    expect(byId.get(corrupt)).toEqual([{ id: "c-images", title: "Field notes" }]);
    expect(byId.get(absent)).toEqual([{ id: "c-absent", title: "Loose ends" }]);

    const warning = damagedAttachmentWarning(parsed.damaged);
    expect(warning).toContain("2 images could not be restored");
    expect(warning).toContain("“Field notes”");
    expect(warning).toContain("“Loose ends”");
    expect(warning).toContain("placeholder");

    // The document itself is whole: an image is not worth the text around it.
    expect(
      parsed.workspace
        .listCards()
        .map((card) => card.id)
        .sort(),
    ).toEqual(["c-absent", "c-images"]);
  });
});

/** One card body with a title and one attachment node per id. */
function writeTitledBody(
  workspace: WorkspaceDocument,
  cardId: string,
  title: string,
  attachmentIds: readonly string[],
): void {
  const titleRoot = workspace.getTitle(cardId);
  titleRoot.set("nodeName", "doc");
  const titleBlocks = titleRoot.ensureMergeableList("children");
  const titleParagraph = titleBlocks.insertContainer(0, new LoroMap());
  titleParagraph.set("nodeName", "paragraph");
  titleParagraph.ensureMergeableMap("attributes");
  titleParagraph
    .ensureMergeableList("children")
    .insertContainer(0, new LoroText())
    .insert(0, title);

  const body = workspace.getContent(cardId);
  body.set("nodeName", "doc");
  body.ensureMergeableMap("attributes");
  const blocks = body.ensureMergeableList("children");
  const paragraph = blocks.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  const inline = paragraph.ensureMergeableList("children");
  attachmentIds.forEach((id, index) => {
    const node = inline.insertContainer(index, new LoroMap());
    node.set("nodeName", "attachment");
    const attrs = node.ensureMergeableMap("attributes");
    attrs.set("id", id);
    attrs.set("mime", "image/png");
    attrs.set("name", `${id}.png`);
  });
}
