import { DEFAULT_WORKSPACE_NAME, WorkspaceDocument } from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";
import {
  forgetWorkspaceName,
  readWorkspaceNames,
  rememberWorkspaceName,
  resolveWorkspaceName,
} from "./workspaceName";

function reopened(workspace: WorkspaceDocument): WorkspaceDocument {
  const doc = new LoroDoc();
  doc.import(workspace.doc.export({ mode: "snapshot" }));
  return new WorkspaceDocument(doc);
}

afterEach(() => {
  window.localStorage.clear();
});

describe("workspace name in the document", () => {
  it("round-trips a rename and survives a reopen", () => {
    const workspace = new WorkspaceDocument(new LoroDoc());
    workspace.createBoard({ id: "board-1", name: "Board 1" });

    // Before the workspace is named it borrows its first board's name.
    expect(workspace.workspaceName()).toBe(DEFAULT_WORKSPACE_NAME);

    workspace.renameWorkspace("  Research 2026  ");
    expect(workspace.workspaceName()).toBe("Research 2026");
    expect(reopened(workspace).workspaceName()).toBe("Research 2026");
  });

  it("stays Untitled rather than borrowing a board's name", () => {
    const empty = new WorkspaceDocument(new LoroDoc());
    expect(empty.workspaceName()).toBe(DEFAULT_WORKSPACE_NAME);
    expect(DEFAULT_WORKSPACE_NAME).toBe("Untitled workspace");

    const workspace = new WorkspaceDocument(new LoroDoc());
    workspace.createBoard({ id: "board-a", name: "Planning" });
    workspace.createBoard({ id: "board-b", name: "Later" });
    // Borrowing the first board's name is what put "Notebook" in the workspace
    // switcher; a nameless workspace is Untitled until someone names it.
    expect(workspace.workspaceName()).toBe(DEFAULT_WORKSPACE_NAME);
  });

  it("refuses empty, whitespace, control characters and overlong names with a reason", () => {
    const workspace = new WorkspaceDocument(new LoroDoc());
    workspace.createBoard({ id: "board-1", name: "Board 1" });

    const cases = [
      ["", /A workspace name cannot be empty/],
      ["   ", /A workspace name cannot be empty/],
      ["Plan\nning", /A workspace name cannot contain control characters/],
      ["a".repeat(81), /A workspace name can be at most 80 characters/],
    ] as const;

    for (const [name, reason] of cases) {
      expect(() => workspace.renameWorkspace(name)).toThrow(reason);
      // A refused rename leaves the old name in place.
      expect(workspace.workspaceName()).toBe(DEFAULT_WORKSPACE_NAME);
    }

    // The boundary itself is allowed.
    workspace.renameWorkspace("a".repeat(80));
    expect(workspace.workspaceName()).toBe("a".repeat(80));
  });
});

describe("workspace name mirror for recents", () => {
  it("keeps a name per workspace and forgets it on deletion", () => {
    rememberWorkspaceName("ws-1", "Research");
    rememberWorkspaceName("ws-2", "Roadmap");
    expect(readWorkspaceNames()).toEqual({ "ws-1": "Research", "ws-2": "Roadmap" });

    forgetWorkspaceName("ws-1");
    expect(readWorkspaceNames()).toEqual({ "ws-2": "Roadmap" });
  });

  it("falls back from a stored name to the last board name", () => {
    expect(resolveWorkspaceName("Research", "Board 1")).toBe("Research");
    expect(resolveWorkspaceName(undefined, "Board 1")).toBe("Board 1");
    expect(resolveWorkspaceName("   ", "  ")).toBe("Untitled workspace");
    expect(resolveWorkspaceName(undefined, undefined)).toBe("Untitled workspace");
  });
});
