import { describe, expect, it } from "vitest";
import { peerDragGroup } from "./presenceGroups";

const placements = new Map([
  ["a", { x: 0, y: 0 }],
  ["b", { x: 300, y: 0 }],
]);
const sizes = new Map([
  ["a", { width: 200, height: 100 }],
  ["b", { width: 200, height: 100 }],
]);

describe("peerDragGroup", () => {
  it("should ignore a single-card drag", () => {
    const group = peerDragGroup({ nodeId: "a", position: { x: 10, y: 10 } }, placements, sizes);
    expect(group).toBeNull();
  });

  it("should span every dragged card at the anchor's delta", () => {
    const group = peerDragGroup(
      { nodeId: "a", position: { x: 40, y: 20 }, nodeIds: ["a", "b"] },
      placements,
      sizes,
    );
    expect(group).toEqual({ x: 40, y: 20, width: 500, height: 100, count: 2 });
  });

  it("should skip members that are not on this board", () => {
    const group = peerDragGroup(
      { nodeId: "a", position: { x: 0, y: 0 }, nodeIds: ["a", "ghost", "b"] },
      placements,
      sizes,
    );
    expect(group?.count).toBe(2);
  });

  it("should fall back to the default card size", () => {
    const group = peerDragGroup(
      { nodeId: "a", position: { x: 0, y: 0 }, nodeIds: ["a", "b"] },
      placements,
      new Map(),
    );
    expect(group).toEqual({ x: 0, y: 0, width: 524, height: 160, count: 2 });
  });

  it("should return null when the anchor is not on the board", () => {
    const group = peerDragGroup(
      { nodeId: "ghost", position: { x: 0, y: 0 }, nodeIds: ["ghost", "a"] },
      placements,
      sizes,
    );
    expect(group).toBeNull();
  });
});
