import type { Board, Placement, Section } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { cardWhere } from "./cardWhere";

const board = (id: string, name: string): Board => ({
  id,
  name,
  rect: { x: 0, y: 0, width: 360, height: 260 },
  z: 0,
  createdAt: 0,
  updatedAt: 0,
});

const section = (id: string, x: number, y: number, width: number, height: number): Section => ({
  id,
  boardId: "board-1",
  title: id,
  x,
  y,
  width,
  height,
  z: 0,
  createdAt: 0,
  updatedAt: 0,
});

const placement = (
  cardId: string,
  boardId: string,
  x: number,
  y: number,
  createdAt = 0,
): Placement => ({
  cardId,
  boardId,
  x,
  y,
  z: 0,
  createdAt,
});

describe("cardWhere", () => {
  const outer = section("outer", 0, 0, 600, 400);
  const inner = section("inner", 100, 100, 200, 150);

  it("should order a nested section path outermost first", () => {
    const where = cardWhere(
      {
        boards: [board("board-1", "Research")],
        placements: [placement("card-a", "board-1", 120, 120)],
        sections: [inner, outer],
      },
      "card-a",
      "board-1",
    );

    expect(where.unplaced).toBe(false);
    expect(where.entries).toHaveLength(1);
    expect(where.entries[0]).toMatchObject({
      boardId: "board-1",
      boardName: "Research",
      isCurrent: true,
      isHome: true,
    });
    expect(where.entries[0]?.sectionPath.map((entry) => entry.id)).toEqual(["outer", "inner"]);
  });

  it("should leave the path empty when the card is outside every section", () => {
    const where = cardWhere(
      {
        boards: [board("board-1", "Research")],
        placements: [placement("card-a", "board-1", 900, 900)],
        sections: [outer, inner],
      },
      "card-a",
      "board-1",
    );

    expect(where.entries[0]?.sectionPath).toEqual([]);
  });

  it("should flag a card with no placements as unplaced", () => {
    const where = cardWhere(
      { boards: [board("board-1", "Research")], placements: [], sections: [outer] },
      "card-a",
      "board-1",
    );

    expect(where).toEqual({ unplaced: true, entries: [] });
  });

  it("should put the current board first and list the others", () => {
    const where = cardWhere(
      {
        boards: [board("board-1", "Research"), board("board-2", "Draft")],
        placements: [
          placement("card-a", "board-1", 10, 10, 1),
          placement("card-a", "board-2", 10, 10, 2),
        ],
        sections: [],
      },
      "card-a",
      "board-2",
    );

    expect(where.entries.map((entry) => entry.boardId)).toEqual(["board-1", "board-2"]);
    expect(where.entries.find((entry) => entry.isCurrent)?.boardId).toBe("board-2");
    expect(where.entries.find((entry) => entry.isHome)?.boardId).toBe("board-1");
  });
});
