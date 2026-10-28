import { beforeEach, describe, expect, it } from "vitest";
import { pinnedWorkspaceOrder, readWorkspacePins } from "./workspacePins";

const rows = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Beta" },
  { id: "c", name: "Gamma" },
];

beforeEach(() => {
  window.localStorage.clear();
});

describe("workspace pins", () => {
  it("starts with nothing pinned, and survives an unreadable store", () => {
    expect(readWorkspacePins()).toEqual([]);
    window.localStorage.setItem("suite.workspacePins.v1", "not json");
    expect(readWorkspacePins()).toEqual([]);
    window.localStorage.setItem("suite.workspacePins.v1", JSON.stringify({ a: true }));
    expect(readWorkspacePins()).toEqual([]);
  });

  it("puts a pinned workspace first, in the order it was pinned", () => {
    const order = pinnedWorkspaceOrder(rows, ["c", "a"]);
    expect(order.map((row) => row.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps the rest in the order it arrived", () => {
    // The list is a recency list; a pin lifts a row out of it without reordering what
    // is left, so an unpin puts the row back where it was rather than at the end.
    expect(pinnedWorkspaceOrder(rows, []).map((row) => row.id)).toEqual(["a", "b", "c"]);
  });

  it("ignores a pin whose workspace is gone", () => {
    // A pin outlives a workspace deleted on another device; a dead id is not a row.
    expect(pinnedWorkspaceOrder(rows, ["gone", "b"]).map((row) => row.id)).toEqual(["b", "a", "c"]);
  });
});
