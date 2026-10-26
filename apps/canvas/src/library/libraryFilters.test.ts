import { describe, expect, it } from "vitest";
import {
  facetCounts,
  filterItems,
  groupBySection,
  matchesFilters,
  UNSORTED_SECTION,
} from "./libraryFilters";

const items = [
  { typeIds: ["note"], tagIds: ["research"] },
  { typeIds: ["note"], tagIds: ["misc"] },
  { typeIds: ["concept"], tagIds: ["research"] },
  { typeIds: ["concept", "source"], tagIds: ["reading"] },
];

const scoped = [
  { id: "a", typeIds: ["note"], tagIds: ["research"], sectionIds: ["sub", "parent"] },
  { id: "b", typeIds: ["note"], tagIds: ["misc"], sectionIds: ["parent"] },
  { id: "c", typeIds: ["concept"], tagIds: ["research"], sectionIds: [UNSORTED_SECTION] },
  { id: "d", typeIds: ["concept", "source"], tagIds: ["reading"], sectionIds: [] },
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

describe("section filtering", () => {
  it("should include a section's descendants when the parent is selected", () => {
    const ids = filterItems(scoped, [], [], ["parent"]).map((item) => item.id);
    expect(ids).toEqual(["a", "b"]);
  });

  it("should match a nested section on its own", () => {
    const ids = filterItems(scoped, [], [], ["sub"]).map((item) => item.id);
    expect(ids).toEqual(["a"]);
  });

  it("should offer unsorted as an explicit option", () => {
    const ids = filterItems(scoped, [], [], [UNSORTED_SECTION]).map((item) => item.id);
    expect(ids).toEqual(["c"]);
  });

  it("should AND sections with types and tags", () => {
    expect(filterItems(scoped, ["note"], [], ["parent"]).map((item) => item.id)).toEqual([
      "a",
      "b",
    ]);
    expect(filterItems(scoped, ["note"], ["research"], ["parent"]).map((item) => item.id)).toEqual([
      "a",
    ]);
    expect(filterItems(scoped, ["concept"], [], ["parent"])).toHaveLength(0);
  });

  it("should OR section ids within the group", () => {
    const ids = filterItems(scoped, [], [], ["sub", UNSORTED_SECTION]).map((item) => item.id);
    expect(ids).toEqual(["a", "c"]);
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

  it("should count sections against the type and tag facets", () => {
    const counts = facetCounts(scoped, ["note"], [], []);
    expect(counts.sections.get("parent")).toBe(2);
    expect(counts.sections.get("sub")).toBe(1);
    expect(counts.sections.get(UNSORTED_SECTION) ?? 0).toBe(0);
  });

  it("should count types against the section facet", () => {
    const counts = facetCounts(scoped, [], [], ["parent"]);
    expect(counts.types.get("note")).toBe(2);
    expect(counts.types.get("concept") ?? 0).toBe(0);
    expect(counts.tags.get("research")).toBe(1);
  });
});

describe("groupBySection", () => {
  const sectionOrder = [
    { id: "parent", title: "Parent", depth: 0 },
    { id: "sub", title: "Sub", depth: 1 },
    { id: "empty", title: "Empty", depth: 0 },
  ];

  it("should order groups by section, put unsorted last and omit empty groups", () => {
    const groups = groupBySection(scoped, sectionOrder);
    expect(groups.map((group) => group.id)).toEqual(["parent", "sub", UNSORTED_SECTION]);
    expect(groups.map((group) => group.title)).toEqual(["Parent", "Sub", "Unsorted"]);
    expect(groups[1]?.depth).toBe(1);
  });

  it("should keep incoming item order inside a group", () => {
    const groups = groupBySection(
      [
        { id: "first", typeIds: ["note"], tagIds: [], sectionIds: ["parent"] },
        { id: "second", typeIds: ["note"], tagIds: [], sectionIds: ["parent"] },
      ],
      sectionOrder,
    );
    expect(groups[0]?.items.map((item) => item.id)).toEqual(["first", "second"]);
  });

  it("should put cards with no known section into unsorted", () => {
    const groups = groupBySection(scoped, [{ id: "parent", title: "Parent", depth: 0 }]);
    expect(groups.at(-1)).toMatchObject({ id: UNSORTED_SECTION, title: "Unsorted" });
    expect(groups.at(-1)?.items.map((item) => item.id)).toEqual(["c", "d"]);
  });
});
