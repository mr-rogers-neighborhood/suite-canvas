import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

function seeded(): { workspace: WorkspaceDocument; boardId: string } {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  workspace.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
  workspace.setTitleText("c1", "First note");
  return { workspace, boardId: board.id };
}

describe("listHistoryPoints", () => {
  it("lists the newest change first and marks it current", () => {
    const { workspace } = seeded();
    const points = workspace.listHistoryPoints();
    expect(points.length).toBeGreaterThan(0);
    expect(points[0]?.current).toBe(true);
    expect(points.slice(1).every((point) => !point.current)).toBe(true);
  });

  it("labels each point from the origin the write committed under", () => {
    const { workspace } = seeded();
    const labels = workspace.listHistoryPoints().map((point) => point.label);
    expect(labels).toContain("Wrote card text");
    expect(labels).toContain("Added card");
  });

  it("honours the limit", () => {
    const { workspace } = seeded();
    expect(workspace.listHistoryPoints(2)).toHaveLength(2);
  });

  it("reads one point by id, and null for an id the oplog never held", () => {
    const { workspace } = seeded();
    const [newest] = workspace.listHistoryPoints();
    expect(newest).toBeDefined();
    expect(workspace.getHistoryPoint(newest?.id ?? "")?.id).toBe(newest?.id);
    expect(workspace.getHistoryPoint("999@42")).toBeNull();
    expect(workspace.getHistoryPoint("not-an-id")).toBeNull();
  });
});

describe("previewRestore", () => {
  it("says how many cards come back without writing anything", () => {
    const { workspace, boardId } = seeded();
    const before = workspace.listHistoryPoints()[0];
    expect(before).toBeDefined();

    workspace.createCard({ id: "c2", boardId, position: { x: 320, y: 0 } });
    workspace.setTitleText("c2", "Second note");

    const preview = workspace.previewRestore(before?.id ?? "");
    expect(preview).not.toBeNull();
    expect(preview?.removed.cards).toBe(1);
    expect(preview?.removedTitles).toEqual(["Second note"]);
    expect(preview?.summary).toContain("removes 1 card");
    // The preview is a read: the card it would remove is still there.
    expect(workspace.getCard("c2")).toBeDefined();
  });

  it("reports nothing to do for the current point", () => {
    const { workspace } = seeded();
    const [newest] = workspace.listHistoryPoints();
    const preview = workspace.previewRestore(newest?.id ?? "");
    expect(preview?.empty).toBe(true);
  });

  it("returns null for a point that is not in the oplog", () => {
    const { workspace } = seeded();
    expect(workspace.previewRestore("999@42")).toBeNull();
  });
});

describe("restoreToPoint", () => {
  it("reverts the changes after the point and reports what it did", () => {
    const { workspace, boardId } = seeded();
    const before = workspace.listHistoryPoints()[0];
    workspace.createCard({ id: "c2", boardId, position: { x: 320, y: 0 } });
    workspace.setTitleText("c2", "Second note");

    const report = workspace.restoreToPoint(before?.id ?? "");
    expect(report?.removed.cards).toBe(1);
    expect(workspace.getCard("c2")).toBeUndefined();
    expect(workspace.getCard("c1")).toBeDefined();
    expect(workspace.displayTitle("c1")).toBe("First note");
  });

  it("rewrites a card's text back to the point's version", () => {
    const { workspace } = seeded();
    const before = workspace.listHistoryPoints()[0];
    workspace.setTitleText("c1", "Renamed");

    workspace.restoreToPoint(before?.id ?? "");
    expect(workspace.displayTitle("c1")).toBe("First note");
  });

  it("lands as one undoable change, so undo brings the work back", () => {
    const { workspace, boardId } = seeded();
    const before = workspace.listHistoryPoints()[0];
    workspace.createCard({ id: "c2", boardId, position: { x: 320, y: 0 } });

    workspace.restoreToPoint(before?.id ?? "");
    expect(workspace.canUndo()).toBe(true);
    workspace.undo();
    expect(workspace.getCard("c2")).toBeDefined();
  });

  it("names the restore in the list it just added to", () => {
    const { workspace, boardId } = seeded();
    const before = workspace.listHistoryPoints()[0];
    workspace.createCard({ id: "c2", boardId, position: { x: 320, y: 0 } });

    workspace.restoreToPoint(before?.id ?? "");
    const [newest] = workspace.listHistoryPoints();
    expect(newest?.label).toBe("Restored an earlier point");
    expect(newest?.current).toBe(true);
  });

  it("does nothing for a point that is not in the oplog", () => {
    const { workspace } = seeded();
    expect(workspace.restoreToPoint("999@42")).toBeNull();
    expect(workspace.getCard("c1")).toBeDefined();
  });
});
