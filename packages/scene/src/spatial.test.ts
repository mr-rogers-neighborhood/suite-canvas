import { describe, expect, it } from "vitest";
import { rectContainsRect } from "./geometry.js";
import { SpatialIndex, spatialIndexFrom } from "./spatial.js";

const box = (x: number, y: number, width = 10, height = 10) => ({ x, y, width, height });

describe("SpatialIndex", () => {
  it("should find entries that overlap a query rect", () => {
    const index = new SpatialIndex<string>();
    index.upsert("a", box(0, 0), "a");
    index.upsert("b", box(100, 100), "b");
    index.upsert("c", box(105, 105), "c");
    expect(index.size).toBe(3);
    expect(index.search(box(95, 95, 20, 20)).map((entry) => entry.id)).toEqual(["b", "c"]);
    expect(index.search(box(300, 300)).map((entry) => entry.id)).toEqual([]);
  });

  it("should find entries at a point with tolerance", () => {
    const index = new SpatialIndex<string>();
    index.upsert("a", box(0, 0), "a");
    index.upsert("b", box(100, 100), "b");
    expect(index.searchPoint(5, 5).map((entry) => entry.id)).toEqual(["a"]);
    expect(index.searchPoint(11, 5).map((entry) => entry.id)).toEqual([]);
    expect(index.searchPoint(11, 5, 2).map((entry) => entry.id)).toEqual(["a"]);
    expect(index.searchPoint(100, 100).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("should replace an entry when upserted at a new position", () => {
    const index = new SpatialIndex<string>();
    index.upsert("a", box(0, 0), "a");
    index.upsert("a", box(500, 500), "a");
    expect(index.size).toBe(1);
    expect(index.search(box(0, 0)).map((entry) => entry.id)).toEqual([]);
    expect(index.search(box(500, 500)).map((entry) => entry.id)).toEqual(["a"]);
    expect(index.get("a")?.bounds).toEqual(box(500, 500));
  });

  it("should remove and clear", () => {
    const index = new SpatialIndex<string>();
    index.upsert("a", box(0, 0), "a");
    index.upsert("b", box(20, 0), "b");
    expect(index.remove("a")).toBe(true);
    expect(index.remove("a")).toBe(false);
    expect(index.size).toBe(1);
    expect(index.has("a")).toBe(false);
    expect(index.search(box(0, 0)).map((entry) => entry.id)).toEqual([]);
    index.clear();
    expect(index.size).toBe(0);
    expect(index.search(box(0, 0))).toEqual([]);
  });

  it("should grow its root when entries fall outside the initial bounds", () => {
    const index = new SpatialIndex<string>({ bounds: box(-10, -10, 20, 20), capacity: 2 });
    index.upsert("a", box(0, 0), "a");
    index.upsert("b", box(10_000, 10_000), "b");
    expect(index.search(box(10_000, 10_000)).map((entry) => entry.id)).toEqual(["b"]);
    expect(index.search(box(0, 0)).map((entry) => entry.id)).toEqual(["a"]);
  });

  it("should handle many entries without losing any", () => {
    const index = new SpatialIndex<number>({ capacity: 2, maxDepth: 4 });
    const expected: string[] = [];
    for (let position = 0; position < 200; position += 1) {
      const id = `entry-${position}`;
      index.upsert(id, box(position * 20, position * 20), position);
      expected.push(id);
    }
    const found = index.search(box(-1, -1, 10_000, 10_000)).map((entry) => entry.id);
    expect(found).toHaveLength(expected.length);
    expect([...found].sort()).toEqual([...expected].sort());
  });

  it("should build from a list", () => {
    const index = spatialIndexFrom([
      { id: "a", bounds: box(0, 0), value: 1 },
      { id: "b", bounds: box(50, 0), value: 2 },
    ]);
    expect(index.size).toBe(2);
    expect(index.search(box(0, 0)).map((entry) => entry.value)).toEqual([1]);
  });

  it("should report its current bounds", () => {
    const index = new SpatialIndex<string>({ bounds: box(0, 0, 100, 100) });
    expect(index.bounds).toEqual(box(0, 0, 100, 100));
    index.upsert("a", box(200, 200), "a");
    expect(rectContainsRect(index.bounds, box(200, 200))).toBe(true);
  });
});
