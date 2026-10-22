import { describe, expect, it } from "vitest";
import { cardTypeSchema, typePluralName } from "./schema.js";

const base = {
  id: "character",
  name: "Character",
  glyph: "C",
  createdAt: 0,
  updatedAt: 0,
  fields: [],
};

describe("typePluralName", () => {
  it("should pluralise with a plain s by default", () => {
    expect(typePluralName({ name: "Character" })).toBe("Characters");
    expect(typePluralName({ name: "Story beat" })).toBe("Story beats");
  });

  it("should add es after a sibilant", () => {
    expect(typePluralName({ name: "Class" })).toBe("Classes");
    expect(typePluralName({ name: "Box" })).toBe("Boxes");
    expect(typePluralName({ name: "Match" })).toBe("Matches");
  });

  it("should prefer an explicit plural", () => {
    expect(typePluralName({ name: "Person", pluralName: "People" })).toBe("People");
    expect(typePluralName({ name: "Character", pluralName: "  Cast  " })).toBe("Cast");
  });

  it("should tolerate an empty name", () => {
    expect(typePluralName({ name: "  " })).toBe("");
  });
});

describe("cardTypeSchema", () => {
  it("should accept a type without a plural name", () => {
    expect(cardTypeSchema.parse(base).pluralName).toBeUndefined();
  });

  it("should accept an explicit plural name", () => {
    expect(cardTypeSchema.parse({ ...base, pluralName: "Characters" }).pluralName).toBe(
      "Characters",
    );
  });
});
