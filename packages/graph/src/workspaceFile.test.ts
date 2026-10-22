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
});
