import { describe, expect, it } from "vitest";
import {
  formatPropertyValue,
  isCalendarDate,
  isPropertyValueEmpty,
  isPropertyValueValid,
  propertyValueError,
  readPropertyValue,
} from "./property.js";
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
    expect(formatPropertyValue(card, "missing")).toBe("Unavailable card");
    expect(formatPropertyValue(card, "c1", { cardTitle: "Ada", includeCard: false })).toBe(
      "\u2014",
    );
  });

  it("should tell a referenced-but-unshared card from a missing one", () => {
    const card = field({ kind: "card" });

    // A projection stub: the record is absent, but the share kept a title.
    expect(
      readPropertyValue(card, "c1", { cardPresence: "stub", cardTitle: "Private card" }),
    ).toEqual({ text: "Private card", notShared: true });
    expect(
      readPropertyValue(card, "c1", {
        cardPresence: "stub",
        cardTitle: "Beta",
        formatCard: (title) => `[[${title}]]`,
      }),
    ).toEqual({ text: "[[Beta]]", notShared: true });

    // Nothing at all is known: an error-free but plainly unavailable target.
    expect(readPropertyValue(card, "c1", { cardPresence: "missing" })).toEqual({
      text: "Unavailable card",
      notShared: false,
    });
    expect(formatPropertyValue(card, "c1", { cardPresence: "stub" })).toBe("Not shared");
  });

  it("should read a board value as its name, a neutral label or unavailable", () => {
    const board = field({ kind: "board" });
    expect(formatPropertyValue(board, "b1", { boardName: "Research" })).toBe("Research");
    // No resolved name but the board still exists: a neutral label, not a lie.
    expect(formatPropertyValue(board, "b1")).toBe("Board");
    expect(formatPropertyValue(board, "b1", { boardName: "   " })).toBe("Board");
    expect(formatPropertyValue(board, "gone", { boardPresence: "missing" })).toBe(
      "Unavailable board",
    );
    expect(
      formatPropertyValue(board, "gone", { boardPresence: "missing", unavailable: "Deleted" }),
    ).toBe("Deleted");
    expect(formatPropertyValue(board, "")).toBe("\u2014");
  });

  it("should never read a board value through the card options", () => {
    const board = field({ kind: "board" });
    expect(
      formatPropertyValue(board, "b1", { cardTitle: "Ada", formatCard: (title) => `[[${title}]]` }),
    ).toBe("Board");
    expect(readPropertyValue(board, "b1", { cardTitle: "Ada" })).toEqual({
      text: "Board",
      notShared: false,
    });
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

  it("should count a board value as empty until its target resolves", () => {
    const board = field({ kind: "board" });
    expect(isPropertyValueEmpty(board, "b1")).toBe(true);
    expect(isPropertyValueEmpty(board, "b1", { boardName: "Research" })).toBe(false);
    expect(
      isPropertyValueEmpty(board, "b1", { boardName: "Research", boardPresence: "missing" }),
    ).toBe(true);
    expect(isPropertyValueEmpty(board, "   ", { boardName: "Research" })).toBe(true);
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

describe("card self-reference", () => {
  it("should refuse a card-valued property that points at its own card", async () => {
    const { WorkspaceDocument } = await import("./loro/WorkspaceDocument.js");
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    workspace.createCard({ id: "c1" });
    const related = workspace.addField("note", { name: "Related", kind: "card" });
    expect(() => workspace.setProperty("c1", related.id, "c1")).toThrow(/own card/);
    workspace.createCard({ id: "c2" });
    workspace.setProperty("c1", related.id, "c2");
    expect(workspace.getCard("c1")?.properties[related.id]).toBe("c2");
  });
});

describe("isPropertyValueValid", () => {
  it("should accept a clear and the primitive each kind stores", () => {
    expect(isPropertyValueValid(field({ kind: "text" }), null)).toBe(true);
    expect(isPropertyValueValid(field({ kind: "text" }), undefined)).toBe(true);
    expect(isPropertyValueValid(field({ kind: "text" }), "value")).toBe(true);
    expect(isPropertyValueValid(field({ kind: "number" }), 0)).toBe(true);
    expect(isPropertyValueValid(field({ kind: "checkbox" }), false)).toBe(true);
    expect(isPropertyValueValid(field({ kind: "date" }), "2024-02-29")).toBe(true);
    expect(isPropertyValueValid(field({ kind: "select", options }), "a")).toBe(true);
    expect(isPropertyValueValid(field({ kind: "multiSelect", options }), ["a", "b"])).toBe(true);
    expect(isPropertyValueValid(field({ kind: "card" }), "c2", { cardId: "c1" })).toBe(true);
    expect(isPropertyValueValid(field({ kind: "board" }), "b1")).toBe(true);
  });

  it("should reject the wrong primitive for every kind", () => {
    expect(isPropertyValueValid(field({ kind: "text" }), 42)).toBe(false);
    expect(isPropertyValueValid(field({ kind: "number" }), "12")).toBe(false);
    expect(isPropertyValueValid(field({ kind: "number" }), Number.NaN)).toBe(false);
    expect(isPropertyValueValid(field({ kind: "number" }), Number.POSITIVE_INFINITY)).toBe(false);
    expect(isPropertyValueValid(field({ kind: "checkbox" }), "yes")).toBe(false);
    expect(isPropertyValueValid(field({ kind: "date" }), 20240101)).toBe(false);
    expect(isPropertyValueValid(field({ kind: "select", options }), 1)).toBe(false);
    expect(isPropertyValueValid(field({ kind: "multiSelect", options }), "a")).toBe(false);
    expect(isPropertyValueValid(field({ kind: "card" }), 1)).toBe(false);
    expect(isPropertyValueValid(field({ kind: "board" }), 1)).toBe(false);
    expect(isPropertyValueValid(field({ kind: "board" }), "   ")).toBe(false);
    expect(propertyValueError(field({ kind: "board" }), 1)).toMatch(/board id/);
  });

  it("should reject a deleted option and an unknown multi-select id", () => {
    const select = field({ kind: "select", options });
    const multi = field({ kind: "multiSelect", options });
    expect(isPropertyValueValid(select, "gone")).toBe(false);
    expect(propertyValueError(select, "gone")).toMatch(/no longer exists/);
    expect(isPropertyValueValid(multi, ["a", "gone"])).toBe(false);
    expect(propertyValueError(multi, ["a", "gone"])).toMatch(/no longer exists/);
    // Repeated ids are harmless: storage only keeps the set.
    expect(isPropertyValueValid(multi, ["a", "a"])).toBe(true);
  });

  it("should reject a date that is not a real calendar day", () => {
    const due = field({ kind: "date" });
    expect(isCalendarDate("2024-02-29")).toBe(true);
    expect(isCalendarDate("2025-02-29")).toBe(false);
    expect(isCalendarDate("2024-13-01")).toBe(false);
    expect(isCalendarDate("01-02-2024")).toBe(false);
    expect(isPropertyValueValid(due, "2025-02-29")).toBe(false);
  });

  it("should reject a self-reference and, when resolvable, a dangling card", () => {
    const related = field({ kind: "card" });
    expect(isPropertyValueValid(related, "c1", { cardId: "c1" })).toBe(false);
    expect(propertyValueError(related, "c1", { cardId: "c1" })).toMatch(/own card/);
    expect(isPropertyValueValid(related, "missing", { cardId: "c1" })).toBe(true);
    expect(
      isPropertyValueValid(related, "missing", {
        cardId: "c1",
        cardExists: (id) => id === "c2",
      }),
    ).toBe(false);
    expect(
      isPropertyValueValid(related, "c2", {
        cardId: "c1",
        cardExists: (id) => id === "c2",
      }),
    ).toBe(true);
  });

  it("should check a board target only when one is supplied, and never self-check", () => {
    const board = field({ kind: "board" });
    expect(isPropertyValueValid(board, "gone")).toBe(true);
    expect(isPropertyValueValid(board, "gone", { boardExists: () => false })).toBe(false);
    expect(propertyValueError(board, "gone", { boardExists: (id) => id === "b1" })).toMatch(
      /board that does not exist/,
    );
    expect(isPropertyValueValid(board, "b1", { boardExists: (id) => id === "b1" })).toBe(true);
    // A board id is not a card id, so the card self-check cannot apply.
    expect(isPropertyValueValid(board, "c1", { cardId: "c1" })).toBe(true);
  });
});

describe("narrowed card fields", () => {
  const mediaField = {
    id: "f-media",
    name: "Cover",
    kind: "media" as const,
    options: [],
    order: 0,
    required: false,
    allowedTypeIds: ["media"],
  };

  it("should accept a card of the allowed type", () => {
    expect(
      propertyValueError(mediaField, "card-1", {
        cardTypeOf: () => "media",
        cardExists: () => true,
      }),
    ).toBeNull();
  });

  it("should refuse a card of another type, naming what it wanted", () => {
    expect(
      propertyValueError(mediaField, "card-1", {
        cardTypeOf: () => "note",
        cardExists: () => true,
      }),
    ).toBe('Field "Cover" expects a media card');
  });

  it("should stay a card reference for the id and self-reference rules", () => {
    expect(propertyValueError(mediaField, "", {})).toContain("expects a card id");
    expect(propertyValueError(mediaField, "card-1", { cardId: "card-1" })).toContain(
      "cannot point at its own card",
    );
    expect(propertyValueError(mediaField, "gone", { cardExists: () => false })).toContain(
      "does not exist",
    );
  });

  it("should skip the type rule when the caller cannot say what the card is", () => {
    // Refusing on missing information would make an offline or partial view
    // reject values that are perfectly valid in the document.
    expect(propertyValueError(mediaField, "card-1", {})).toBeNull();
  });

  it("should narrow nothing when the field names no types", () => {
    const open = { ...mediaField, allowedTypeIds: undefined };
    expect(propertyValueError(open, "card-1", { cardTypeOf: () => "note" })).toBeNull();
  });
});
