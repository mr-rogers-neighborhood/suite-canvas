import { describe, expect, it } from "vitest";
import { presenceChipInk } from "./presence";

describe("presenceChipInk", () => {
  it("keeps a chip readable on dark and pale peer colours", () => {
    expect(presenceChipInk("#111827")).toBe("#ffffff");
    expect(presenceChipInk("#fde68a")).toBe("#1d1d1f");
    expect(presenceChipInk("#1d4ed8")).toBe("#ffffff");
  });

  it("accepts the short form and refuses anything that is not a colour", () => {
    expect(presenceChipInk("#fff")).toBe("#1d1d1f");
    expect(presenceChipInk("not-a-colour")).toBe("#ffffff");
    expect(presenceChipInk("#12345")).toBe("#ffffff");
  });
});
