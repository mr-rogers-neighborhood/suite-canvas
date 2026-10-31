import { beforeEach, describe, expect, it } from "vitest";
import { activeHandbookRect, defaultHandbookRects, useHandbookStore } from "./handbookStore";

beforeEach(() => {
  useHandbookStore.setState({
    open: false,
    articleId: null,
    lastArticleId: null,
    scope: [],
    pane: "handbook",
    picking: false,
    collapsed: { x: 10, y: 10, width: 196, height: 36 },
    expanded: { x: 10, y: 10, width: 360, height: 460 },
  });
  window.localStorage.clear();
});

describe("the handbook store", () => {
  it("should keep one float with two remembered sizes", () => {
    expect(activeHandbookRect(useHandbookStore.getState()).height).toBe(36);
    useHandbookStore.getState().setOpen(true);
    expect(activeHandbookRect(useHandbookStore.getState()).height).toBe(460);

    // Moving the panel does not move the pill: they are the reader's two placements.
    useHandbookStore.getState().setRect("expanded", { x: 100, y: 50, width: 380, height: 500 });
    expect(useHandbookStore.getState().collapsed).toEqual({ x: 10, y: 10, width: 196, height: 36 });
  });

  it("should remember where the reader put it", () => {
    useHandbookStore.getState().setRect("collapsed", { x: 300, y: 200, width: 196, height: 36 });
    const stored: unknown = JSON.parse(window.localStorage.getItem("suite.handbook.v1") ?? "null");
    expect(stored).toMatchObject({
      open: false,
      collapsed: { x: 300, y: 200, width: 196, height: 36 },
    });
  });

  it("should name the last article on the pill, and forget it when the article closes", () => {
    useHandbookStore.getState().openArticle("chrome/title-bar");
    expect(useHandbookStore.getState().lastArticleId).toBe("chrome/title-bar");
    useHandbookStore.getState().closeArticle();
    expect(useHandbookStore.getState().articleId).toBeNull();
    // The pill keeps naming what was last read; that is the difference between the two ids.
    expect(useHandbookStore.getState().lastArticleId).toBe("chrome/title-bar");
  });

  it("should treat the explain scope as a set of targets", () => {
    useHandbookStore.getState().addToScope({ kind: "ui", id: "title-bar" });
    useHandbookStore.getState().addToScope({ kind: "ui", id: "title-bar" });
    expect(useHandbookStore.getState().scope).toHaveLength(1);

    useHandbookStore.getState().removeFromScope({ kind: "ui", id: "title-bar" });
    expect(useHandbookStore.getState().scope).toHaveLength(0);
  });

  it("should park a first-visit pill clear of the window edge and the dock", () => {
    const rects = defaultHandbookRects({ width: 1200, height: 800 });
    expect(rects.collapsed.x + rects.collapsed.width).toBeLessThan(1200);
    expect(rects.expanded.x + rects.expanded.width).toBeLessThan(1200);
    expect(rects.expanded.y).toBeGreaterThan(0);
  });
});
