import { describe, expect, it } from "vitest";
import { describeValue, frontmatterTags, splitFrontmatter } from "./frontmatter.js";
import { coercePropertyValue, keptPropertyLines, planProperties } from "./properties.js";

describe("splitFrontmatter", () => {
  it("reads a block at the top of the file and returns the body without it", () => {
    const frontmatter = splitFrontmatter("---\ntags: [a]\nstatus: Done\n---\n# Title\n");
    expect(frontmatter.data.status).toBe("Done");
    expect(frontmatter.keys).toEqual(["tags", "status"]);
    expect(frontmatter.body.trim()).toBe("# Title");
    expect(frontmatter.error).toBeNull();
  });

  it("treats a `---` that is not at the top as a rule, not frontmatter", () => {
    const frontmatter = splitFrontmatter("# Title\n\n---\n\nBody");
    expect(frontmatter.raw).toBeNull();
    expect(frontmatter.body).toContain("Body");
  });

  it("keeps an unparseable block as text and names the reason", () => {
    const frontmatter = splitFrontmatter("---\nthis: [is\n---\nBody");
    expect(frontmatter.data).toEqual({});
    expect(frontmatter.error).toContain("kept as body text");
  });

  it("keeps an unclosed block as body text", () => {
    const frontmatter = splitFrontmatter("---\nstatus: Done\n");
    expect(frontmatter.raw).toBeNull();
    expect(frontmatter.error).toContain("never closed");
  });

  it("reads a frontmatter that is not a set of keys as no properties", () => {
    const frontmatter = splitFrontmatter("---\n- one\n- two\n---\nBody");
    expect(frontmatter.data).toEqual({});
    expect(frontmatter.error).toContain("not a set of keys");
  });
});

describe("frontmatterTags", () => {
  it("reads a list, a comma string, a single value and the singular key", () => {
    expect(frontmatterTags({ tags: ["a", "b"] })).toEqual(["a", "b"]);
    expect(frontmatterTags({ tags: "a, b" })).toEqual(["a", "b"]);
    expect(frontmatterTags({ tags: "a" })).toEqual(["a"]);
    expect(frontmatterTags({ tag: "#a" })).toEqual(["#a"]);
    expect(frontmatterTags({ Tags: "a" })).toEqual(["a"]);
  });

  it("reads nothing from a key it does not know", () => {
    expect(frontmatterTags({ topics: "a" })).toEqual([]);
  });
});

describe("describeValue", () => {
  it("flattens a list and a nested value to text", () => {
    expect(describeValue(["a", "b"])).toBe("a, b");
    expect(describeValue({ a: 1 })).toBe('{"a":1}');
    expect(describeValue(true)).toBe("true");
    expect(describeValue(null)).toBe("");
  });
});

const fields = [
  {
    id: "f-status",
    name: "Status",
    kind: "select" as const,
    options: [{ id: "o-1", label: "In progress", order: 0 }],
  },
  { id: "f-owner", name: "owner", kind: "text" as const, options: [] },
  { id: "f-count", name: "Count", kind: "number" as const, options: [] },
  { id: "f-done", name: "Done", kind: "checkbox" as const, options: [] },
  {
    id: "f-tags",
    name: "Topics",
    kind: "multiSelect" as const,
    options: [
      { id: "o-a", label: "Alpha", order: 0 },
      { id: "o-b", label: "Beta", order: 1 },
    ],
  },
  { id: "f-link", name: "Related", kind: "card" as const, options: [] },
  { id: "f-group", name: "Detail", kind: "group" as const, options: [] },
];

describe("coercePropertyValue", () => {
  it("matches a select by option label, case-insensitively", () => {
    const coerced = coercePropertyValue(fields[0] as never, "in progress");
    expect(coerced).toEqual({ ok: true, value: "o-1" });
  });

  it("refuses a select value that names no option", () => {
    expect(coercePropertyValue(fields[0] as never, "Blocked")).toEqual({
      ok: false,
      reason: "names no option",
    });
  });

  it("reads a number from a string and refuses a word", () => {
    expect(coercePropertyValue(fields[2] as never, "42")).toEqual({ ok: true, value: 42 });
    expect(coercePropertyValue(fields[2] as never, "many").ok).toBe(false);
  });

  it("reads the checkboxes Obsidian writes", () => {
    expect(coercePropertyValue(fields[3] as never, "true")).toEqual({ ok: true, value: true });
    expect(coercePropertyValue(fields[3] as never, "no")).toEqual({ ok: true, value: false });
    expect(coercePropertyValue(fields[3] as never, "maybe").ok).toBe(false);
  });

  it("maps a multi-select through its option labels", () => {
    expect(coercePropertyValue(fields[4] as never, "Alpha, Beta")).toEqual({
      ok: true,
      value: ["o-a", "o-b"],
    });
    expect(coercePropertyValue(fields[4] as never, "Alpha, Gamma").ok).toBe(false);
  });

  it("resolves a card value through the caller's link index", () => {
    expect(
      coercePropertyValue(fields[5] as never, "[[Alpha]]", (target) =>
        target === "Alpha" ? "card-1" : null,
      ),
    ).toEqual({ ok: true, value: "card-1" });
  });

  it("refuses a composite field, because an import does not build one", () => {
    expect(coercePropertyValue(fields[6] as never, "x")).toEqual({
      ok: false,
      reason: "is a composite field, which an import does not build",
    });
  });

  it("refuses a date that is not a date", () => {
    const date = { id: "f-date", name: "Reviewed", kind: "date" as const, options: [] };
    expect(coercePropertyValue(date, "2024-05-01").ok).toBe(true);
    expect(coercePropertyValue(date, "last week").ok).toBe(false);
  });
});

describe("planProperties", () => {
  it("maps a key a field claims and keeps the rest as text", () => {
    const plan = planProperties({
      data: { Status: "In progress", Owner: "Ada", "custom-key": "kept" },
      keys: ["Status", "Owner", "custom-key"],
      fields,
    });
    expect(plan.properties).toHaveLength(2);
    expect(plan.kept).toEqual([{ key: "custom-key", text: "kept" }]);
    expect(plan.problems).toEqual([]);
  });

  it("keeps a value the field refused, and says why", () => {
    const plan = planProperties({
      data: { Status: "Blocked" },
      keys: ["Status"],
      fields,
    });
    expect(plan.properties).toEqual([]);
    expect(plan.kept).toEqual([{ key: "Status", text: "Blocked" }]);
    expect(plan.problems[0]).toContain("names no option");
  });

  it("ignores the keys Obsidian owns", () => {
    const plan = planProperties({
      data: { tags: ["a"], aliases: ["b"], type: "Project", cssclasses: "x" },
      keys: ["tags", "aliases", "type", "cssclasses"],
      fields,
    });
    expect(plan.kept).toEqual([]);
    expect(plan.properties).toEqual([]);
  });

  it("honours an explicit key to field id map", () => {
    const plan = planProperties({
      data: { who: "Ada" },
      keys: ["who"],
      fields,
      fieldByKey: { who: "f-owner" },
    });
    expect(plan.properties).toEqual([{ fieldId: "f-owner", value: "Ada" }]);
  });
});

describe("keptPropertyLines", () => {
  it("writes a key and its value on one line", () => {
    expect(keptPropertyLines([{ key: "a", text: "1" }])).toEqual(["a: 1"]);
  });
});
