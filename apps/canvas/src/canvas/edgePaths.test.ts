import { edgePaths } from "@suite/graph";
import { describe, expect, it } from "vitest";

/**
 * The stored path enum is a contract: the renderer, the inspector's Path list and
 * the edge context menu each enumerate it, and an enum value with no renderer
 * throws the next time the edge is read back.
 */
describe("edge path enum", () => {
  it("offers the five routings the renderer draws", () => {
    expect([...edgePaths]).toEqual(["bezier", "straight", "step", "smoothstep", "avoid"]);
  });
});
