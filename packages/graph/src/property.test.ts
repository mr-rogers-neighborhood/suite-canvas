import { describe, expect, it } from "vitest";
import { formatPropertyValue, isPropertyValueEmpty } from "./property.js";
import type { FieldDefinition } from "./schema.js";

function field(overrides: Partial<FieldDefinition>): FieldDefinition {
  return {
    id: "f1",
    name: "Field",
    kind: "text",
    required: false,
    order: 0,
    options: [],
    ...overrides,
  };
}

const options = [
  { id: "a", label: "Alpha", order: 0 },
  { id: "b", label: "Beta", order: 1 },
];

describe("formatPropertyValue", () => {
  it("should trim text and treat whitespace as empty", () => {
    const text = field({ kind: "text" });
    expect(formatPropertyValue(text, "  value  ")).toBe("  value  ");
    expect(formatPropertyValue(text, "   ")).toBe("\u2014");
    expect(formatPropertyValue(text, undefined, { empty: "" })).toBe("");
  });

  it("should format numbers, including zero, and reject non-finite values", () => {
    const number = field({ kind: "number" });
    expect(formatPropertyValue(number, 0)).toBe("0");
    expect(formatPropertyValue(number, -2.5)).toBe("-2.5");
    expect(formatPropertyValue(number, Number.NaN)).toBe("\u2014");
    expect(formatPropertyValue(number, Number.POSITIVE_INFINITY)).toBe("\u2014");
  });

  it("should show a check for true and empty for false", () => {
    const checkbox = field({ kind: "checkbox" });
    expect(formatPropertyValue(checkbox, true)).toBe("\u2713");
    expect(formatPropertyValue(checkbox, false)).toBe("\u2014");
    expect(formatPropertyValue(checkbox, true, { checked: "yes" })).toBe("yes");
  });

  it("should use option labels and mark a deleted option unavailable", () => {
    const select = field({ kind: "select", options });
    expect(formatPropertyValue(select, "a")).toBe("Alpha");
    expect(formatPropertyValue(select, "gone")).toBe("Unavailable");
    expect(formatPropertyValue(select, "")).toBe("\u2014");
  });

  it("should order multi-select labels by option order and hide deleted ids", () => {
    const multi = field({ kind: "multiSelect", options });
    expect(formatPropertyValue(multi, ["b", "a", "gone"])).toBe("Alpha, Beta");
    expect(formatPropertyValue(multi, ["gone"])).toBe("Unavailable");
    expect(formatPropertyValue(multi, [])).toBe("\u2014");
  });

  it("should use the live card title and mark a dangling value unavailable", () => {
    const card = field({ kind: "card" });
    expect(formatPropertyValue(card, "c1", { cardTitle: "Ada" })).toBe("Ada");
    expect(
      formatPropertyValue(card, "c1", { cardTitle: "Ada", formatCard: (title) => `[[${title}]]` }),
    ).toBe("[[Ada]]");
    expect(formatPropertyValue(card, "missing")).toBe("Unavailable");
    expect(formatPropertyValue(card, "c1", { cardTitle: "Ada", includeCard: false })).toBe(
      "\u2014",
    );
  });
});

describe("isPropertyValueEmpty", () => {
  it("should treat whitespace, false and non-finite numbers as empty", () => {
    expect(isPropertyValueEmpty(field({ kind: "text" }), "   ")).toBe(true);
    expect(isPropertyValueEmpty(field({ kind: "text" }), "x")).toBe(false);
    expect(isPropertyValueEmpty(field({ kind: "checkbox" }), false)).toBe(true);
    expect(isPropertyValueEmpty(field({ kind: "checkbox" }), true)).toBe(false);
    expect(isPropertyValueEmpty(field({ kind: "number" }), 0)).toBe(false);
    expect(isPropertyValueEmpty(field({ kind: "number" }), Number.NaN)).toBe(true);
  });

  it("should count deleted options and all-deleted multi-selects as empty", () => {
    expect(isPropertyValueEmpty(field({ kind: "select", options }), "gone")).toBe(true);
    expect(isPropertyValueEmpty(field({ kind: "select", options }), "a")).toBe(false);
    expect(isPropertyValueEmpty(field({ kind: "multiSelect", options }), ["gone"])).toBe(true);
    expect(isPropertyValueEmpty(field({ kind: "multiSelect", options }), ["gone", "a"])).toBe(
      false,
    );
  });

  it("should count a card value without a live target as empty", () => {
    const card = field({ kind: "card" });
    expect(isPropertyValueEmpty(card, "c1")).toBe(true);
    expect(isPropertyValueEmpty(card, "c1", { cardTitle: "Ada" })).toBe(false);
  });
});

describe("date validation in the document", () => {
  it("should accept a real calendar date and reject an invalid one", async () => {
    const { WorkspaceDocument } = await import("./loro/WorkspaceDocument.js");
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    workspace.createCard({ id: "c1" });
    const due = workspace.addField("note", { name: "Due", kind: "date" });

    workspace.setProperty("c1", due.id, "2024-02-29");
    expect(workspace.getCard("c1")?.properties[due.id]).toBe("2024-02-29");
    expect(() => workspace.setProperty("c1", due.id, "2025-02-29")).toThrow(/date/);
    expect(() => workspace.setProperty("c1", due.id, "not-a-date")).toThrow(/date/);
  });
});
