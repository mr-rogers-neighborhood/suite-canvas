import type { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { DEFAULT_TYPE_ID } from "../schema.js";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

function sync(a: LoroDoc, b: LoroDoc): void {
  const fromA = a.export({ mode: "update" });
  const fromB = b.export({ mode: "update" });
  b.import(fromA);
  a.import(fromB);
}

/** Counts commits, because one commit is the unit undo and history care about. */
function countCommits(workspace: WorkspaceDocument): () => number {
  let commits = 0;
  workspace.doc.subscribe(() => {
    commits += 1;
  });
  return () => commits;
}

function setup() {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureBoard();
  const first = workspace.createCard({ boardId: board.id, position: { x: 10, y: 10 } });
  const second = workspace.createCard({ boardId: board.id, position: { x: 200, y: 40 } });
  const third = workspace.createCard({ boardId: board.id, position: { x: 400, y: 300 } });
  return { workspace, board, first, second, third };
}

describe("movePlacements", () => {
  it("moves several placements in one commit and one undo step", () => {
    const { workspace, board, first, second, third } = setup();
    const commits = countCommits(workspace);

    workspace.movePlacements(board.id, [
      { cardId: first.id, x: 100, y: 120 },
      { cardId: second.id, x: 320, y: 240 },
    ]);

    expect(commits()).toBe(1);
    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 100, y: 120 });
    expect(workspace.getPlacement(board.id, second.id)).toMatchObject({ x: 320, y: 240 });
    expect(workspace.getPlacement(board.id, third.id)).toMatchObject({ x: 400, y: 300 });

    workspace.undo();

    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 10, y: 10 });
    expect(workspace.getPlacement(board.id, second.id)).toMatchObject({ x: 200, y: 40 });

    workspace.redo();

    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 100, y: 120 });
    expect(workspace.getPlacement(board.id, second.id)).toMatchObject({ x: 320, y: 240 });
  });

  it("does not depend on the order of the moves", () => {
    const { workspace, board, first, second } = setup();

    workspace.movePlacements(board.id, [
      { cardId: second.id, x: 5, y: 6 },
      { cardId: first.id, x: 1, y: 2 },
    ]);

    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 1, y: 2 });
    expect(workspace.getPlacement(board.id, second.id)).toMatchObject({ x: 5, y: 6 });
  });

  it("ignores unknown card ids, unplaced cards and no-op coordinates", () => {
    const { workspace, board, first, second } = setup();
    const otherBoard = workspace.createBoard({ name: "Other" });
    const commits = countCommits(workspace);

    workspace.movePlacements(board.id, [
      { cardId: "missing-card", x: 1, y: 2 },
      { cardId: first.id, x: 10, y: 10 },
      { cardId: second.id, x: 0, y: 0 },
    ]);

    expect(commits()).toBe(1);
    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 10, y: 10 });
    expect(workspace.getPlacement(board.id, second.id)).toMatchObject({ x: 0, y: 0 });

    // A card that is only placed on another board is unknown to this board.
    workspace.movePlacements(otherBoard.id, [{ cardId: first.id, x: 900, y: 900 }]);
    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 10, y: 10 });
  });

  it("does not commit when every move is a no-op", () => {
    const { workspace, board, first, second } = setup();
    const commits = countCommits(workspace);

    workspace.movePlacements(board.id, [
      { cardId: first.id, x: 10, y: 10 },
      { cardId: second.id, x: 200, y: 40 },
      { cardId: "missing-card", x: 30, y: 30 },
    ]);

    expect(commits()).toBe(0);

    workspace.movePlacements(board.id, []);
    expect(commits()).toBe(0);
    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 10, y: 10 });
  });

  it("is idempotent: replaying the same batch writes nothing", () => {
    const { workspace, board, first, second } = setup();
    const moves = [
      { cardId: first.id, x: 50, y: 60 },
      { cardId: second.id, x: 70, y: 80 },
    ];

    workspace.movePlacements(board.id, moves);
    const commits = countCommits(workspace);
    workspace.movePlacements(board.id, moves);

    expect(commits()).toBe(0);
    expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 50, y: 60 });
  });

  it("converges when one client moves a batch while the other edits a property", () => {
    const left = new WorkspaceDocument();
    const board = left.ensureBoard();
    left.ensureDefaultTypes();
    const field = left.addField(DEFAULT_TYPE_ID, { name: "Status", kind: "text" });
    const first = left.createCard({ boardId: board.id, position: { x: 10, y: 10 } });
    const second = left.createCard({ boardId: board.id, position: { x: 200, y: 40 } });

    const right = new WorkspaceDocument();
    sync(left.doc, right.doc);

    left.movePlacements(board.id, [
      { cardId: first.id, x: 140, y: 160 },
      { cardId: second.id, x: 340, y: 280 },
    ]);
    right.setProperty(first.id, field.id, "in progress");

    sync(left.doc, right.doc);

    for (const workspace of [left, right]) {
      expect(workspace.getPlacement(board.id, first.id)).toMatchObject({ x: 140, y: 160 });
      expect(workspace.getPlacement(board.id, second.id)).toMatchObject({ x: 340, y: 280 });
      expect(workspace.getCard(first.id)?.properties[field.id]).toBe("in progress");
    }
  });

  it("merges two clients moving the same batch without duplicating placements", () => {
    const left = new WorkspaceDocument();
    const board = left.ensureBoard();
    const first = left.createCard({ boardId: board.id, position: { x: 0, y: 0 } });

    const right = new WorkspaceDocument();
    sync(left.doc, right.doc);

    left.movePlacements(board.id, [{ cardId: first.id, x: 100, y: 100 }]);
    right.movePlacements(board.id, [{ cardId: first.id, x: 300, y: 50 }]);

    sync(left.doc, right.doc);

    const placements = left.listBoardPlacements(board.id);
    expect(placements).toHaveLength(1);
    expect(placements[0]?.x).toBe(right.getPlacement(board.id, first.id)?.x);
    expect(left.getPlacement(board.id, first.id)).toEqual(right.getPlacement(board.id, first.id));
  });
});
