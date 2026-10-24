import type { Section } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { boardRows } from "./boardRows";

function section(id: string, x: number, y: number, width: number, height: number): Section {
  return {
    id,
    boardId: "b1",
    title: id,
    x,
    y,
    width,
    height,
    z: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("boardRows", () => {
  it("orders rows by y, then x, then id", () => {
    const rows = boardRows(
      [section("c", 0, 0, 10, 10), section("a", 0, 0, 10, 10), section("b", 0, 5, 10, 10)],
      new Map(),
    );

    expect(rows.map((row) => row.section.id)).toEqual(["a", "c", "b"]);
  });

  it("nests a section under the smallest section that fully contains it", () => {
    const outer = section("outer", 0, 0, 600, 400);
    const inner = section("inner", 50, 50, 200, 150);
    const leaf = section("leaf", 60, 60, 80, 60);
    const sibling = section("sibling", 700, 0, 100, 100);

    const rows = boardRows([outer, leaf, inner, sibling], new Map());
    const depthOf = (id: string) => rows.find((row) => row.section.id === id)?.depth;

    expect(depthOf("outer")).toBe(0);
    expect(depthOf("inner")).toBe(1);
    expect(depthOf("leaf")).toBe(2);
    expect(depthOf("sibling")).toBe(0);
  });

  it("does not nest sections that merely overlap", () => {
    const rows = boardRows(
      [section("a", 0, 0, 200, 200), section("b", 100, 100, 200, 200)],
      new Map(),
    );

    expect(rows.map((row) => row.depth)).toEqual([0, 0]);
  });

  it("caps indentation at the maximum depth", () => {
    const chain = Array.from({ length: 7 }, (_, index) =>
      section(`s${index}`, index, index, 500 - index * 20, 500 - index * 20),
    );

    const rows = boardRows(chain, new Map());

    expect(rows.at(-1)?.depth).toBe(4);
    expect(Math.max(...rows.map((row) => row.depth))).toBe(4);
  });

  it("counts cards whose section is exactly that section", () => {
    const outer = section("outer", 0, 0, 600, 400);
    const inner = section("inner", 50, 50, 200, 150);
    const membership = new Map([
      ["card-1", "inner"],
      ["card-2", "inner"],
      ["card-3", "outer"],
    ]);

    const rows = boardRows([outer, inner], membership);

    expect(rows.map((row) => row.count)).toEqual([1, 2]);
  });

  it("returns no rows for a board without sections", () => {
    expect(boardRows([], new Map([["card-1", "missing"]]))).toEqual([]);
  });
});
