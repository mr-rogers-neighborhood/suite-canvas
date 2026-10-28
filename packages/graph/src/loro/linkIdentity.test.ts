import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

/**
 * A link is one relationship per pair, per board.
 *
 * It used to be one per pair *of dots*, and since unplacing a card keeps its edges,
 * every place/unplace/re-place that left the card on a different side wrote another
 * line between the same two things. Reading that back looks exactly like a broken
 * gesture: a fan that grows an extra spoke, a thread that grows an extra hop.
 */
function fixture() {
  const workspace = new WorkspaceDocument();
  const board = workspace.createBoard({ name: "Home" });
  const other = workspace.createBoard({ name: "Other" });
  const a = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const b = workspace.createCard({ boardId: board.id, position: { x: 400, y: 0 } });
  const dots = (id: string) => workspace.getCard(id)?.connectors.map((dot) => dot.id) ?? [];
  return { workspace, board, other, a, b, dots };
}

describe("link identity", () => {
  it("keeps one link when the same pair is drawn on different dots", () => {
    const { workspace, board, a, b, dots } = fixture();
    const [aLeft, aRight] = dots(a.id);
    const [bLeft, bRight] = dots(b.id);

    const first = workspace.addEdge({
      boardId: board.id,
      source: a.id,
      target: b.id,
      sourceConnector: aRight,
      targetConnector: bLeft,
    });
    const second = workspace.addEdge({
      boardId: board.id,
      source: a.id,
      target: b.id,
      sourceConnector: aLeft,
      targetConnector: bRight,
    });

    expect(second?.id).toBe(first?.id);
    expect(workspace.listEdges()).toHaveLength(1);
    // The line takes the dots of the call that just happened.
    expect(workspace.getEdge(first?.id ?? "")?.sourceConnector).toBe(aLeft);
  });

  it("survives a place, unplace and re-place cycle without growing a second link", () => {
    const { workspace, board, a, b, dots } = fixture();
    const [aLeft, aRight] = dots(a.id);
    const [bLeft, bRight] = dots(b.id);
    workspace.addEdge({
      boardId: board.id,
      source: a.id,
      target: b.id,
      sourceConnector: aRight,
      targetConnector: bLeft,
    });

    workspace.unplaceCard(board.id, a.id);
    workspace.unplaceCard(board.id, b.id);
    workspace.placeCard(board.id, b.id, { x: 0, y: 0 });
    workspace.placeCard(board.id, a.id, { x: 400, y: 0 });
    workspace.addEdge({
      boardId: board.id,
      source: a.id,
      target: b.id,
      sourceConnector: aLeft,
      targetConnector: bRight,
    });

    expect(workspace.listEdges()).toHaveLength(1);
    expect(workspace.listBoardEdges(board.id)).toHaveLength(1);
  });

  it("treats the same pair on two boards as two relationships", () => {
    const { workspace, board, other, a, b } = fixture();
    workspace.placeCard(other.id, a.id, { x: 0, y: 0 });
    workspace.placeCard(other.id, b.id, { x: 400, y: 0 });

    workspace.addEdge({ boardId: board.id, source: a.id, target: b.id });
    workspace.addEdge({ boardId: other.id, source: a.id, target: b.id });

    expect(workspace.listEdges()).toHaveLength(2);
  });

  it("keeps one loop per card, not one per pair of dots", () => {
    const { workspace, board, a, dots } = fixture();
    const [first, second, third] = dots(a.id);
    if (!first || !second || !third) throw new Error("expected three dots");
    workspace.addEdge({
      boardId: board.id,
      source: a.id,
      sourceConnector: first,
      target: a.id,
      targetConnector: second,
    });
    workspace.addEdge({
      boardId: board.id,
      source: a.id,
      sourceConnector: second,
      target: a.id,
      targetConnector: third,
    });

    expect(workspace.listEdges()).toHaveLength(1);
  });
});

describe("pruning what older documents accumulated", () => {
  it("keeps the newest link over each pair and drops the rest", () => {
    const { workspace, board, a, b, dots } = fixture();
    const [aLeft, aRight] = dots(a.id);
    const [bLeft, bRight] = dots(b.id);
    workspace.addEdge({
      boardId: board.id,
      source: a.id,
      target: b.id,
      sourceConnector: aRight,
      targetConnector: bLeft,
    });
    // A second record over the same pair, as the old key allowed.
    const stale = workspace.listEdges()[0];
    if (!stale) throw new Error("expected a link");
    workspace.setEdge({ ...stale, id: "stale-copy", sourceConnector: aLeft, updatedAt: 1 });
    workspace.setEdge({ ...stale, targetConnector: bRight, updatedAt: 99 });

    const removed = workspace.pruneDuplicateLinks();

    expect(removed).toBe(1);
    expect(workspace.listEdges()).toHaveLength(1);
    // The one written last survives: that is the line the reader drew most recently.
    expect(workspace.listEdges()[0]?.id).toBe(stale.id);
    expect(workspace.listEdges()[0]?.targetConnector).toBe(bRight);
  });

  it("is a no-op when every pair already has one link", () => {
    const { workspace, board, a, b } = fixture();
    workspace.addEdge({ boardId: board.id, source: a.id, target: b.id });
    expect(workspace.pruneDuplicateLinks()).toBe(0);
    expect(workspace.listEdges()).toHaveLength(1);
  });
});
