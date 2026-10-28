import { describe, expect, it } from "vitest";
import { nextBoardName } from "./boards";
import { WorkspaceDocument } from "./WorkspaceDocument";

describe("nextBoardName", () => {
  it("should not count a board the reader renamed", () => {
    // The seeded board is called "Notebook"; the first board anyone makes is
    // Board 1, not Board 2 — a count is not a number the reader has seen.
    expect(nextBoardName([{ name: "Notebook" }])).toBe("Board 1");
  });

  it("should fill the gap a deleted board leaves", () => {
    expect(nextBoardName([{ name: "Board 1" }, { name: "Board 3" }])).toBe("Board 2");
  });

  it("should climb past the boards that exist", () => {
    expect(nextBoardName([{ name: "Board 1" }, { name: "Board 2" }])).toBe("Board 3");
  });

  it("should agree with the boards a workspace actually makes", () => {
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const seeded = workspace.ensureBoard();
    workspace.renameBoard(seeded.id, "Notebook");

    expect(workspace.createBoard().name).toBe("Board 1");
    expect(workspace.createBoard().name).toBe("Board 2");
    const second = workspace.listBoards().find((board) => board.name === "Board 2");
    if (!second) throw new Error("no Board 2");
    workspace.deleteBoard(second.id, { cards: "keep" });

    // The number Board 2 had is free again, so the next board takes it back.
    expect(workspace.createBoard().name).toBe("Board 2");
  });
});
