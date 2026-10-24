import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

describe("Loro workspace smoke", () => {
  it("creates, updates and converges a board", () => {
    const left = new WorkspaceDocument(new LoroDoc());
    const board = left.ensureView();
    const card = left.createCard({ boardId: board.id, position: { x: 10, y: 20 } });

    expect(left.listBoardCards(board.id)).toHaveLength(1);
    expect(left.getPlacement(board.id, card.id)?.x).toBe(10);

    left.updatePlacementPosition(board.id, card.id, { x: 40, y: 50 });
    expect(left.getPlacement(board.id, card.id)?.x).toBe(40);

    const right = new WorkspaceDocument(new LoroDoc());
    right.importUpdate(left.exportUpdate());
    expect(right.listViews()).toHaveLength(1);
    expect(right.listBoardCards(board.id)).toHaveLength(1);
    expect(right.getPlacement(board.id, card.id)?.x).toBe(40);
  });

  it("merges concurrent field edits", () => {
    const left = new WorkspaceDocument(new LoroDoc());
    const right = new WorkspaceDocument(new LoroDoc());
    const board = left.ensureView();
    const card = left.createCard({ boardId: board.id, position: { x: 0, y: 0 } });

    right.importUpdate(left.exportUpdate());

    left.updatePlacementPosition(board.id, card.id, { x: 100, y: 0 });
    right.updatePlacementSize(board.id, card.id, { width: 320, height: 180 });

    const leftUpdate = left.exportUpdate();
    const rightUpdate = right.exportUpdate();
    left.importUpdate(rightUpdate);
    right.importUpdate(leftUpdate);

    expect(left.getPlacement(board.id, card.id)).toMatchObject({
      x: 100,
      width: 320,
      height: 180,
    });
    expect(right.getPlacement(board.id, card.id)).toMatchObject({
      x: 100,
      width: 320,
      height: 180,
    });
  });

  it("creates connectors and links", () => {
    const workspace = new WorkspaceDocument(new LoroDoc());
    const board = workspace.ensureView();
    const first = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    const second = workspace.createCard({ boardId: board.id, position: { x: 400, y: 0 } });
    const connector = workspace.addConnector(first.id);
    expect(connector).not.toBeNull();
    if (!connector) return;

    const edge = workspace.addEdge({
      boardId: board.id,
      source: first.id,
      target: second.id,
      sourceConnector: connector.id,
      targetConnector: second.connectors[0]?.id,
    });
    expect(edge).not.toBeNull();
    expect(workspace.listBoardEdges(board.id)).toHaveLength(1);
  });
});
