import { describe, expect, it } from "vitest";
import { forceLayout } from "./forceLayout.js";

const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }];
const edges = [{ source: "a", target: "b" }];

describe("forceLayout", () => {
  it("should place every node exactly once", () => {
    const points = forceLayout(nodes, edges);
    expect(points.map((point) => point.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("should be deterministic, so a render does not rearrange itself", () => {
    expect(forceLayout(nodes, edges)).toEqual(forceLayout(nodes, edges));
  });

  it("should stay inside the frame it is normalised into", () => {
    for (const point of forceLayout(nodes, edges, { width: 400, height: 300 })) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(1);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(1);
    }
  });

  it("should not stack nodes on one point", () => {
    const points = forceLayout(nodes, edges);
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i]!;
        const b = points[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.01);
      }
    }
  });

  it("should pull a connected pair closer than an unconnected node", () => {
    // The whole point of the layout: related cards sit together.
    const points = forceLayout(nodes, edges, { iterations: 120 });
    const at = (id: string) => points.find((point) => point.id === id)!;
    const related = Math.hypot(at("a").x - at("b").x, at("a").y - at("b").y);
    const unrelated = Math.max(
      Math.hypot(at("a").x - at("c").x, at("a").y - at("c").y),
      Math.hypot(at("b").x - at("c").x, at("b").y - at("c").y),
    );
    expect(related).toBeLessThanOrEqual(unrelated);
  });

  it("should handle the degenerate sizes", () => {
    expect(forceLayout([], [])).toEqual([]);
    expect(forceLayout([{ id: "only" }], [])).toHaveLength(1);
    // An edge naming a node that is not drawn is ignored rather than thrown.
    expect(forceLayout(nodes, [{ source: "a", target: "gone" }])).toHaveLength(3);
  });
});
