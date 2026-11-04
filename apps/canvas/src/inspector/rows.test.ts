import { describe, expect, it } from "vitest";
import { type InspectorRow, rowsFor } from "./rows";

const rows: InspectorRow<string>[] = [
  { id: "identity", tab: "details", kinds: ["card", "section"], render: () => "identity" },
  { id: "properties", tab: "details", kinds: ["card"], render: () => "properties" },
  { id: "body", tab: "content", kinds: ["card"], render: () => "body" },
  { id: "style", tab: "style", kinds: ["card", "portal"], render: () => "style" },
];

describe("the inspector's rows", () => {
  it("gives a tab only the rows that serve the whole subject", () => {
    expect(rowsFor(rows, "details", ["card"]).map((row) => row.id)).toEqual([
      "identity",
      "properties",
    ]);
    // A section has no properties, so the shared row is all it gets.
    expect(rowsFor(rows, "details", ["section"]).map((row) => row.id)).toEqual(["identity"]);
  });

  it("intersects a mixed subject rather than unioning it", () => {
    expect(rowsFor(rows, "details", ["card", "section"]).map((row) => row.id)).toEqual([
      "identity",
    ]);
  });

  it("keeps tabs apart", () => {
    expect(rowsFor(rows, "content", ["card"]).map((row) => row.id)).toEqual(["body"]);
    expect(rowsFor(rows, "style", ["portal"]).map((row) => row.id)).toEqual(["style"]);
  });

  it("has nothing for a subject with no kinds", () => {
    expect(rowsFor(rows, "details", [])).toEqual([]);
  });

  /**
   * The container panel's table: one row per tab, each serving the kind it was built for. A section and a
   * portal share the table, which is why the kinds are per row rather than per panel.
   */
  it("gives a container one row per tab, for the kind it was built for", () => {
    const containerRows: InspectorRow<null>[] = [
      { id: "details", tab: "details", kinds: ["section"], render: () => null },
      { id: "contents", tab: "content", kinds: ["section"], render: () => null },
      { id: "style", tab: "style", kinds: ["section"], render: () => null },
    ];
    expect(rowsFor(containerRows, "details", ["section"]).map((row) => row.id)).toEqual([
      "details",
    ]);
    expect(rowsFor(containerRows, "content", ["section"]).map((row) => row.id)).toEqual([
      "contents",
    ]);
    expect(rowsFor(containerRows, "style", ["section"]).map((row) => row.id)).toEqual(["style"]);
    // A portal is not what this table was built for, so it gets nothing from it.
    expect(rowsFor(containerRows, "details", ["portal"])).toEqual([]);
  });
});
