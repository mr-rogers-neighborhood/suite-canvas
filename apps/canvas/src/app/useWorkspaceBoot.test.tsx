import { WorkspaceDocument } from "@suite/graph";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { readWorkspace } from "../store/workspaceSnapshotStore";
import { useWorkspaceBoot } from "./useWorkspaceBoot";

/**
 * The template a launcher choice carries into the new document.
 *
 * The picker's value travels in the URL because the document does not exist
 * until the editor opens it. This is the effect that turns that parameter into
 * a board: once, on the seeding boot, and never again for the same workspace.
 */

const ORIGINAL_URL = window.location.href;

function bootIn(url: string, workspace: WorkspaceDocument): ReturnType<typeof renderHook> {
  window.history.replaceState(null, "", url);
  return renderHook(() =>
    useWorkspaceBoot({
      workspace,
      workspaceId: "ws-1",
      workspaceName: "",
      setWorkspaceName: () => {},
      snapshot: readWorkspace(workspace),
      share: null,
      readOnly: false,
      ready: true,
      synced: true,
      standalone: true,
      activeBoardId: null,
      newTab: false,
      setActiveBoardId: () => {},
      connect: () => {},
      provider: null,
      presence: null,
      bindPresence: () => {},
      setBoard: () => {},
      editingNodeId: null,
      editingField: "title",
      setFocus: () => {},
      openInspector: () => {},
    }),
  );
}

afterEach(() => {
  window.history.replaceState(null, "", ORIGINAL_URL);
  window.localStorage.clear();
});

describe("useWorkspaceBoot templates", () => {
  it("copies the chosen template into the document it just created", () => {
    const workspace = new WorkspaceDocument();
    bootIn("/?workspace=ws-1&fresh=1&template=notebook", workspace);

    const names = workspace.listBoards().map((board) => board.name);
    expect(names).toContain("Notebook");
    // The template's own cards arrived with it, not just the board name.
    expect(workspace.listCards().length).toBeGreaterThan(0);
    expect(workspace.hasSeeded()).toBe(true);
  });

  it("applies a template once, so a reload cannot double it", () => {
    const workspace = new WorkspaceDocument();
    const first = bootIn("/?workspace=ws-1&fresh=1&template=notebook", workspace);
    const boards = workspace.listBoards().length;
    const cards = workspace.listCards().length;

    first.unmount();
    bootIn("/?workspace=ws-1&fresh=1&template=notebook", workspace);

    expect(workspace.listBoards().length).toBe(boards);
    expect(workspace.listCards().length).toBe(cards);
  });

  it("starts blank when the picker kept its default", () => {
    const workspace = new WorkspaceDocument();
    bootIn("/?workspace=ws-1&fresh=1", workspace);

    expect(workspace.listBoards().map((board) => board.name)).not.toContain("Notebook");
    expect(workspace.listCards()).toHaveLength(0);
  });

  it("ignores a template id no template carries", () => {
    const workspace = new WorkspaceDocument();
    bootIn("/?workspace=ws-1&fresh=1&template=nope", workspace);

    expect(workspace.listCards()).toHaveLength(0);
    expect(workspace.hasSeeded()).toBe(true);
  });
});

describe("the types every workspace carries", () => {
  it("knows the sketch type before anything has made a sketch", () => {
    // Nothing in production can create a sketch today, but a document that does not know
    // the type renders an existing one as a plain note. The boot effect is where the type
    // is made structural, beside the note type.
    const workspace = new WorkspaceDocument();
    bootIn("/?workspace=ws-1&fresh=1", workspace);

    const sketch = workspace.getType("whiteboard");
    expect(sketch?.name).toBe("Sketch");
    expect(sketch?.pluralName).toBe("Sketches");
    // The display field the renderer reads, added once.
    expect(sketch?.fields.filter((field) => field.name === "Display")).toHaveLength(1);
  });

  it("leaves an existing sketch type alone on the next boot", () => {
    const workspace = new WorkspaceDocument();
    const first = bootIn("/?workspace=ws-1&fresh=1", workspace);
    const fields = workspace.getType("whiteboard")?.fields.length;
    first.unmount();
    bootIn("/?workspace=ws-1&fresh=1", workspace);

    expect(workspace.getType("whiteboard")?.fields.length).toBe(fields);
  });
});
