import { describe, expect, it } from "vitest";
import { hasTab, INSPECTOR_SECTIONS, sectionsFor, tabLabel, tabsFor } from "./capabilities";

/**
 * One table decides what an inspector shows, so the tab strip and the body cannot
 * disagree, and a kind that has nothing for a tab never sees the tab.
 */
describe("inspector capabilities", () => {
  it("gives a card the three leaves an author already knows", () => {
    expect(tabsFor(["card"]).map((tab) => tab.id)).toEqual(["details", "content", "style"]);
    expect(tabLabel("content", "card")).toBe("Content");
    expect(tabLabel("content", "card", { tutorial: true })).toBe("Steps");
  });

  it("gives a container the same three leaves, with nothing of its own to style a section", () => {
    expect(tabsFor(["portal"]).map((tab) => tab.id)).toEqual(["details", "content", "style"]);
    expect(tabsFor(["section"]).map((tab) => tab.id)).toEqual(["details", "content"]);
    expect(tabLabel("content", "portal")).toBe("Contents");
    expect(hasTab(["section"], "style")).toBe(false);
  });

  it("gives a link no inspector tabs of its own", () => {
    expect(tabsFor(["edge"])).toEqual([]);
    expect(tabsFor(["connector"])).toEqual([]);
  });

  it("intersects across kinds, so a mixed selection keeps only what both have", () => {
    expect(tabsFor(["card", "portal"]).map((tab) => tab.id)).toEqual([
      "details",
      "content",
      "style",
    ]);
    expect(tabsFor(["card", "section"]).map((tab) => tab.id)).toEqual(["details", "content"]);
    expect(tabsFor([])).toEqual([]);
  });

  it("puts every body row on a tab that exists for the kinds it serves", () => {
    for (const section of INSPECTOR_SECTIONS) {
      for (const kind of section.kinds) {
        expect(hasTab([kind], section.tab)).toBe(true);
      }
    }
  });

  it("gives the contents row to every kind that holds something", () => {
    const contents = (kind: "card" | "portal" | "section") =>
      sectionsFor("content", [kind]).map((section) => section.id);

    expect(contents("card")).toEqual(["contents"]);
    expect(contents("portal")).toEqual(["contents"]);
    expect(contents("section")).toEqual(["contents"]);
  });
});
