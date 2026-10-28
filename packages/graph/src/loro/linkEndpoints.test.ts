import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

/**
 * A link can exist before its dots are known — a template, an import, a paste all
 * write one. When a run later links the same two cards knowing which dots the line
 * leaves and arrives on, the existing record takes them. Drawing a pinned line
 * beside an unpinned one puts two lines between the same pair on screen, which is
 * the duplicate a reader reports and cannot undo one at a time.
 */
function fixture() {
  const workspace = new WorkspaceDocument();
  const board = workspace.createBoard({ name: "Home" });
  const other = workspace.createBoard({ name: "Elsewhere" });
  const a = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  const b = workspace.createCard({ boardId: board.id, position: { x: 400, y: 0 } });
  const c = workspace.createCard({ boardId: board.id, position: { x: 0, y: 400 } });
  const dots = (cardId: string) => workspace.getCard(cardId)?.connectors.map((dot) => dot.id) ?? [];
  const [aLeft, aRight] = dots(a.id);
  const [bLeft, bRight] = dots(b.id);
  return { workspace, board, other, a, b, c, aLeft, aRight, bLeft, bRight };
}

describe("linking endpoints", () => {
  it("puts the planned dots on the link the cards already had", () => {
    const { workspace, board, a, b, aRight, bLeft } = fixture();
    const existing = workspace.addEdge({ boardId: board.id, source: a.id, target: b.id });

    const written = workspace.linkEndpoints({
      boardId: board.id,
      source: a.id,
      target: b.id,
      sourceConnector: aRight,
      targetConnector: bLeft,
    });

    expect(written?.id).toBe(existing?.id);
    expect(workspace.listEdges()).toHaveLength(1);
    const [edge] = workspace.listEdges();
    expect(edge?.sourceConnector).toBe(aRight);
    expect(edge?.targetConnector).toBe(bLeft);
  });

  it("keeps the direction a link was drawn in", () => {
    const { workspace, board, a, b, aRight, bLeft } = fixture();
    // Drawn the other way round: the run's `source` is this link's target.
    workspace.addEdge({ boardId: board.id, source: b.id, target: a.id });

    workspace.linkEndpoints({
      boardId: board.id,
      source: a.id,
      target: b.id,
      sourceConnector: aRight,
      targetConnector: bLeft,
    });

    const [edge] = workspace.listEdges();
    expect(edge?.source).toBe(b.id);
    // The dots belong to the ends the caller named, not to the ends they landed on.
    expect(edge?.targetConnector).toBe(aRight);
    expect(edge?.sourceConnector).toBe(bLeft);
  });

  it("draws a second line when the existing one already names its dots", () => {
    const { workspace, board, a, b, aLeft, aRight, bLeft, bRight } = fixture();
    workspace.addEdge({
      boardId: board.id,
      source: a.id,
      target: b.id,
      sourceConnector: aLeft,
      targetConnector: bRight,
    });

    workspace.linkEndpoints({
      boardId: board.id,
      source: a.id,
      target: b.id,
      sourceConnector: aRight,
      targetConnector: bLeft,
    });

    // Two dots on each end is two connections, which is a thing a reader can mean.
    expect(workspace.listEdges()).toHaveLength(2);
  });

  it("leaves a link on another board alone", () => {
    const { workspace, board, other, a, b, aRight, bLeft } = fixture();
    workspace.addEdge({ boardId: other.id, source: a.id, target: b.id });

    workspace.linkEndpoints({
      boardId: board.id,
      source: a.id,
      target: b.id,
      sourceConnector: aRight,
      targetConnector: bLeft,
    });

    const boards = workspace
      .listEdges()
      .map((edge) => edge.boardId)
      .sort();
    expect(boards).toEqual([board.id, other.id].sort());
  });

  it("does not borrow a link to a third card", () => {
    const { workspace, board, a, b, c, aRight, bLeft } = fixture();
    workspace.addEdge({ boardId: board.id, source: a.id, target: c.id });

    workspace.linkEndpoints({
      boardId: board.id,
      source: a.id,
      target: b.id,
      sourceConnector: aRight,
      targetConnector: bLeft,
    });

    expect(workspace.listEdges()).toHaveLength(2);
  });

  it("adds a plain link when the caller names no dots", () => {
    const { workspace, board, a, b } = fixture();
    workspace.addEdge({ boardId: board.id, source: a.id, target: b.id });

    workspace.linkEndpoints({ boardId: board.id, source: a.id, target: b.id });

    // Nothing to refine: an unpinned link twice is the same connection.
    expect(workspace.listEdges()).toHaveLength(1);
    expect(workspace.listEdges()[0]?.sourceConnector).toBeUndefined();
  });
});
