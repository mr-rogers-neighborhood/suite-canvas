import { WorkspaceDocument } from "@suite/graph";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceSnapshotStore, workspaceSnapshotStore } from "./workspaceSnapshotStore";

function setup() {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureBoard();
  workspace.createCard({ id: "a", boardId: board.id });
  return { workspace, board };
}

describe("WorkspaceSnapshotStore", () => {
  it("should share one store per workspace", () => {
    const { workspace } = setup();
    expect(workspaceSnapshotStore(workspace)).toBe(workspaceSnapshotStore(workspace));
  });

  it("should replace only the section that changed", () => {
    const { workspace, board } = setup();
    const store = new WorkspaceSnapshotStore(workspace);
    const before = store.getSnapshot();
    const listener = vi.fn();
    store.subscribe(listener);

    workspace.createCard({ id: "b", boardId: board.id });

    expect(listener).toHaveBeenCalled();
    const after = store.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.boards).toBe(before.boards);
    expect(after.edges).toBe(before.edges);
    expect(after.cards).not.toBe(before.cards);
    expect(after.placements).not.toBe(before.placements);
  });

  it("should keep record identity for cards that did not change", () => {
    const { workspace, board } = setup();
    const store = new WorkspaceSnapshotStore(workspace);
    const card = store.card("a");

    workspace.createCard({ id: "b", boardId: board.id });

    expect(store.card("a")).toBe(card);
    expect(store.card("b")?.id).toBe("b");
  });

  it("should reuse every collection when a refresh finds no changes", () => {
    const { workspace } = setup();
    const store = new WorkspaceSnapshotStore(workspace);
    const before = store.getSnapshot();

    store.refresh();

    const after = store.getSnapshot();
    expect(after.cards).toBe(before.cards);
    expect(after.boards).toBe(before.boards);
    expect(after.placements).toBe(before.placements);
    expect(after.edges).toBe(before.edges);
  });

  it("should publish container changes without touching the card snapshot", () => {
    const { workspace } = setup();
    const store = new WorkspaceSnapshotStore(workspace);
    const before = store.getSnapshot();
    const containers = workspace.cardContainers("a");
    const listener = vi.fn();
    const unsubscribe = workspace.observeContainers("a", listener);

    workspace.doc.getMap("content").delete("a");
    workspace.doc.commit({ origin: "test" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe(before);
    expect(workspace.cardContainers("a").contentId).toBeNull();
    expect(workspace.cardContainers("a")).not.toBe(containers);

    const recreated = workspace.getContent("a");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(workspace.cardContainers("a").contentId).toBe(recreated.id);

    unsubscribe();
    workspace.doc.getMap("content").delete("a");
    workspace.doc.commit({ origin: "test" });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
