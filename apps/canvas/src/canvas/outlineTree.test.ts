import type { Section } from "@suite/graph";
import { describe, expect, it } from "vitest";
import type { PeerPresence } from "../collab/presence";
import { OUTLINE_MAX_DEPTH, outlineParent, outlinePeerIds, outlineRows } from "./outlineTree";

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

function peer(
  clientId: string,
  overrides: {
    sectionId?: string;
    dragSectionId?: string;
    resizeSectionId?: string;
  } = {},
): PeerPresence {
  return {
    clientId,
    board: "b1",
    user: { name: clientId, color: "#3b82f6" },
    pointer: null,
    focus: null,
    dragging: null,
    sectionDrag: overrides.dragSectionId
      ? { sectionId: overrides.dragSectionId, position: { x: 0, y: 0 } }
      : null,
    selection: {
      nodeIds: [],
      ...(overrides.sectionId ? { sectionId: overrides.sectionId } : {}),
    },
    connector: null,
    resizing: null,
    sectionResize: overrides.resizeSectionId
      ? {
          sectionId: overrides.resizeSectionId,
          position: { x: 0, y: 0 },
          width: 100,
          height: 100,
        }
      : null,
    reconnect: null,
    connect: null,
    labelDrag: null,
    selectionBox: null,
  };
}

describe("outlineRows", () => {
  it("orders rows by y, then x, then id", () => {
    const rows = outlineRows(
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

    const rows = outlineRows([outer, leaf, inner, sibling], new Map());
    const depthOf = (id: string) => rows.find((row) => row.section.id === id)?.depth;

    expect(depthOf("outer")).toBe(0);
    expect(depthOf("inner")).toBe(1);
    expect(depthOf("leaf")).toBe(2);
    expect(depthOf("sibling")).toBe(0);
  });

  it("does not nest sections that merely overlap", () => {
    const rows = outlineRows(
      [section("a", 0, 0, 200, 200), section("b", 100, 100, 200, 200)],
      new Map(),
    );

    expect(rows.map((row) => row.depth)).toEqual([0, 0]);
  });

  it("caps indentation at the maximum depth", () => {
    const chain = Array.from({ length: OUTLINE_MAX_DEPTH + 3 }, (_, index) =>
      section(`s${index}`, index, index, 500 - index * 20, 500 - index * 20),
    );

    const rows = outlineRows(chain, new Map());
    const deepest = rows.at(-1);

    expect(deepest?.depth).toBe(OUTLINE_MAX_DEPTH);
    expect(Math.max(...rows.map((row) => row.depth))).toBe(OUTLINE_MAX_DEPTH);
  });

  it("counts cards whose section is exactly that section", () => {
    const outer = section("outer", 0, 0, 600, 400);
    const inner = section("inner", 50, 50, 200, 150);
    const membership = new Map([
      ["card-1", "inner"],
      ["card-2", "inner"],
      ["card-3", "outer"],
    ]);

    const rows = outlineRows([outer, inner], membership);

    expect(rows.map((row) => row.count)).toEqual([1, 2]);
  });

  it("returns no rows for a board without sections", () => {
    expect(outlineRows([], new Map([["card-1", "missing"]]))).toEqual([]);
  });
});

describe("outlineParent", () => {
  it("returns undefined when no other section contains the section", () => {
    const target = section("target", 0, 0, 50, 50);

    expect(outlineParent(target, [target, section("other", 100, 100, 50, 50)])).toBeUndefined();
  });

  it("prefers the smallest containing section", () => {
    const target = section("target", 100, 100, 50, 50);
    const large = section("large", 0, 0, 900, 900);
    const small = section("small", 50, 50, 200, 200);

    expect(outlineParent(target, [large, small, target])?.id).toBe("small");
  });
});

describe("outlinePeerIds", () => {
  it("collects the section each peer selects, drags or resizes", () => {
    const bySection = outlinePeerIds([
      peer("selecting", { sectionId: "s1" }),
      peer("dragging", { dragSectionId: "s2" }),
      peer("resizing", { resizeSectionId: "s3" }),
      peer("idle"),
    ]);

    expect(bySection.get("s1")?.map((entry) => entry.clientId)).toEqual(["selecting"]);
    expect(bySection.get("s2")?.map((entry) => entry.clientId)).toEqual(["dragging"]);
    expect(bySection.get("s3")?.map((entry) => entry.clientId)).toEqual(["resizing"]);
    expect(bySection.size).toBe(3);
  });

  it("lists a peer once when it selects and drags the same section", () => {
    const bySection = outlinePeerIds([peer("both", { sectionId: "s1", dragSectionId: "s1" })]);

    expect(bySection.get("s1")).toHaveLength(1);
  });
});
