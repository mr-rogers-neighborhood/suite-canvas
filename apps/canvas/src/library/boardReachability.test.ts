import type { PropertyValue } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { openedBoardIds } from "./boardReachability";
import type { LibraryBoard, LibraryItem } from "./libraryTypes";

const board = (id: string, title = id): LibraryBoard => ({
  id,
  title,
  open: false,
  cardCount: 0,
});

const card = (id: string, properties: Record<string, PropertyValue>): LibraryItem => ({
  id,
  title: id,
  boards: [],
  typeIds: [],
  tagIds: [],
  sectionIds: [],
  properties,
});

describe("openedBoardIds", () => {
  it("counts the board a portal names", () => {
    const opened = openedBoardIds(
      [board("home"), board("guide")],
      [card("p1", { "portal-board": "guide" })],
      "home",
    );

    expect([...opened]).toEqual(["home", "guide"]);
  });

  it("counts the named home board even when no portal points at it", () => {
    const opened = openedBoardIds([board("home"), board("guide")], [], "home");
    expect(opened.has("home")).toBe(true);
    expect(opened.has("guide")).toBe(false);
  });

  it("falls back to the first board when the workspace names no home", () => {
    // The shell opens the first board when nothing else is open or requested, so
    // that board is reachable without a portal.
    const opened = openedBoardIds([board("first"), board("second")], [], null);
    expect(opened.has("first")).toBe(true);
    expect(opened.has("second")).toBe(false);
  });

  it("ignores a board property that names nothing", () => {
    const opened = openedBoardIds(
      [board("home"), board("guide")],
      [
        card("p1", { "portal-board": "  " }),
        card("p2", { "portal-board": 3 }),
        card("p3", {}),
        card("p4", { title: "guide" }),
      ],
      "home",
    );

    expect([...opened]).toEqual(["home"]);
  });
});
