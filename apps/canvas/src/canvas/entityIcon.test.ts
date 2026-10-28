import { describe, expect, it } from "vitest";
import { cardIcon, resolvedIcon, sectionIcon } from "./entityIcon";

/**
 * One chain, so the canvas, the inspector and the library cannot disagree about which icon a thing
 * draws. `style.icon` is what a reader edits; the record's own icon is next; the type's is what a card
 * falls back to. A card can also say "nothing", which is a decision rather than an absence.
 */
describe("the icon chain", () => {
  it("prefers the paint record over the record and the type", () => {
    expect(
      resolvedIcon({ style: { icon: "lucide:star" }, own: "lucide:moon", inherited: "lucide:sun" }),
    ).toBe("lucide:star");
  });

  it("falls back to the record, then to what it inherits", () => {
    expect(resolvedIcon({ own: "lucide:moon", inherited: "lucide:sun" })).toBe("lucide:moon");
    expect(resolvedIcon({ inherited: "lucide:sun" })).toBe("lucide:sun");
    expect(resolvedIcon({})).toBeNull();
  });

  it("lets a card choose nothing at all", () => {
    // Hidden beats the record and the type, which is what "no icon" means for a card.
    expect(resolvedIcon({ own: "lucide:moon", inherited: "lucide:sun", hidden: true })).toBeNull();
  });

  it("lets an explicit paint icon outrank a card that had none", () => {
    // Picking an icon for a card whose type icon was hidden means showing it, or the press would appear
    // to do nothing.
    expect(resolvedIcon({ style: { icon: "lucide:star" }, hidden: true })).toBe("lucide:star");
  });

  it("reads a card and a section through the same chain", () => {
    expect(cardIcon({ icon: "lucide:moon" }, "lucide:sun")).toBe("lucide:moon");
    expect(cardIcon({ style: { icon: "lucide:star" } }, "lucide:sun")).toBe("lucide:star");
    expect(sectionIcon({ icon: "lucide:book" })).toBe("lucide:book");
    // A section has no type to inherit from, so nothing set is nothing drawn.
    expect(sectionIcon({})).toBeNull();
  });
});
