import { describe, expect, it } from "vitest";
import { cardTypeSchema, sectionColorSchema, sectionColors, typePluralName } from "./schema.js";

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

describe("sectionColorSchema", () => {
  it("accepts the six shipped palette ids", () => {
    for (const color of sectionColors) expect(sectionColorSchema.parse(color)).toBe(color);
  });

  it("accepts a swatch the workspace palette added", () => {
    // A section's colour is a palette id, and a palette is the workspace's to extend.
    expect(sectionColorSchema.parse("swatch-1a2b3c4d")).toBe("swatch-1a2b3c4d");
  });

  it("refuses an empty or oversized id", () => {
    expect(sectionColorSchema.safeParse("").success).toBe(false);
    expect(sectionColorSchema.safeParse("c".repeat(65)).success).toBe(false);
  });
});
