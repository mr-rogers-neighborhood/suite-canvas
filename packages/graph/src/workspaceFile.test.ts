import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import {
  createWorkspaceFile,
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
});
