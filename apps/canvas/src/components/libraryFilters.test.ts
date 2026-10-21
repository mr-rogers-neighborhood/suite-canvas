import { describe, expect, it } from "vitest";
import { facetCounts, filterItems, matchesFilters } from "./libraryFilters";

const items = [
  { typeIds: ["note"], tagIds: ["research"] },
  { typeIds: ["note"], tagIds: ["misc"] },
  { typeIds: ["concept"], tagIds: ["research"] },
  { typeIds: ["concept", "source"], tagIds: ["reading"] },
];

describe("matchesFilters", () => {
  it("should match everything when no facet is selected", () => {
    for (const item of items) expect(matchesFilters(item, [], [])).toBe(true);
  });

  it("should OR types within the group", () => {
    expect(items.filter((item) => matchesFilters(item, ["note", "source"], []))).toHaveLength(3);
  });

  it("should AND types with tags", () => {
    expect(items.filter((item) => matchesFilters(item, ["concept"], ["research"]))).toHaveLength(1);
  });

  it("should return the same array when nothing is filtered", () => {
    expect(filterItems(items, [], [])).toBe(items);
  });
});

describe("facetCounts", () => {
  it("should count each facet against the other group", () => {
    const counts = facetCounts(items, ["concept"], ["research"]);

    // Type counts respect the tag filter.
    expect(counts.types.get("note")).toBe(1);
    expect(counts.types.get("concept")).toBe(1);
    // Tag counts respect the type filter.
    expect(counts.tags.get("research")).toBe(1);
    expect(counts.tags.get("reading")).toBe(1);
    expect(counts.tags.get("misc") ?? 0).toBe(0);
  });
});
