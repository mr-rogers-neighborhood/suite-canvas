import { describe, expect, it } from "vitest";
import { firstPresentTarget, matchArticles } from "./match";
import type { HandbookArticle } from "./types";

function article(id: string, targets: HandbookArticle["targets"], order = 10): HandbookArticle {
  return {
    id,
    slug: id,
    title: id,
    description: "",
    section: "chrome",
    order,
    targets,
    html: "",
    text: "",
  };
}

const titleBar = article("chrome/title-bar", [{ kind: "ui", id: "title-bar" }]);
const chrome = article(
  "chrome/chrome",
  [
    { kind: "ui", id: "title-bar" },
    { kind: "ui", id: "dock" },
  ],
  20,
);
const selection = article("getting-around/selection", [], 30);

describe("matchArticles", () => {
  it("should list nothing when nothing is on screen", () => {
    const match = matchArticles([titleBar, chrome, selection], new Set());
    expect(match).toEqual({ articles: [], items: 0, undocumented: 0 });
  });

  it("should list the article whose subject is present, and count the item", () => {
    const match = matchArticles([titleBar, selection], new Set(["ui:title-bar"]));
    expect(match.articles.map((entry) => entry.id)).toEqual(["chrome/title-bar"]);
    expect(match.items).toBe(1);
  });

  it("should never list an article that documents a system rather than an element", () => {
    const match = matchArticles([selection], new Set(["ui:title-bar"]));
    expect(match.articles).toHaveLength(0);
    expect(match.undocumented).toBe(1);
  });

  it("should prefer the article about exactly this thing over one that mentions it", () => {
    const match = matchArticles([chrome, titleBar], new Set(["ui:title-bar"]));
    expect(match.articles.map((entry) => entry.id)).toEqual(["chrome/title-bar", "chrome/chrome"]);
  });

  it("should count items, not articles: two articles about one control are one thing", () => {
    const match = matchArticles([titleBar, chrome], new Set(["ui:title-bar"]));
    expect(match.items).toBe(1);
    expect(match.articles).toHaveLength(2);
  });

  it("should answer an explain scope even when the thing is not on this board", () => {
    const match = matchArticles([titleBar], new Set(), [{ kind: "ui", id: "title-bar" }]);
    expect(match.articles.map((entry) => entry.id)).toEqual(["chrome/title-bar"]);
    // Nothing is counted as present, because the question is about the selection.
    expect(match.items).toBe(0);
  });

  it("should sort equals by the authored order rather than by file name", () => {
    const later = article("chrome/z-later", [{ kind: "ui", id: "title-bar" }], 90);
    const earlier = article("chrome/a-earlier", [{ kind: "ui", id: "title-bar" }], 10);
    const match = matchArticles([later, earlier], new Set(["ui:title-bar"]));
    expect(match.articles.map((entry) => entry.id)).toEqual(["chrome/a-earlier", "chrome/z-later"]);
  });
});

describe("firstPresentTarget", () => {
  it("should name the first target the screen can actually point at", () => {
    expect(firstPresentTarget(chrome, new Set(["ui:dock"]))).toEqual({ kind: "ui", id: "dock" });
    expect(firstPresentTarget(chrome, new Set())).toBeNull();
  });
});
