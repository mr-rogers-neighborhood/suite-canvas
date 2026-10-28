import type { Board } from "@suite/graph";
import { afterEach, describe, expect, it } from "vitest";
import { pinnedOrder, readBoardPins } from "./boardPins";

const KEY = "suite.boardPins.v1";

describe("readBoardPins", () => {
  afterEach(() => localStorage.removeItem(KEY));

  it("should answer with nothing when the browser has never pinned", () => {
    expect(readBoardPins()).toEqual([]);
  });

  it("should drop anything that is not an id", () => {
    localStorage.setItem(KEY, JSON.stringify(["b1", 2, null, { id: "b2" }, "b3"]));
    expect(readBoardPins()).toEqual(["b1", "b3"]);
  });

  it("should survive a value that is not a list", () => {
    localStorage.setItem(KEY, '"nonsense"');
    expect(readBoardPins()).toEqual([]);
  });

  it("should survive unreadable JSON", () => {
    localStorage.setItem(KEY, "{not json");
    expect(readBoardPins()).toEqual([]);
  });
});

describe("pinnedOrder", () => {
  const board = (id: string): Board => ({
    id,
    name: id,
    createdAt: 0,
    updatedAt: 0,
    tags: [],
  });

  it("should keep the order the reader pinned in", () => {
    const boards = [board("a"), board("b"), board("c")];
    expect(pinnedOrder(boards, ["c", "a"]).map((entry) => entry.id)).toEqual(["c", "a"]);
  });

  it("should drop a pin whose board is gone", () => {
    expect(pinnedOrder([board("a")], ["a", "deleted"]).map((entry) => entry.id)).toEqual(["a"]);
  });
});
