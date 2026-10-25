import { describe, expect, it } from "vitest";
import { behaviourTypeIds, isBehaviourType } from "./behaviours";

/**
 * A behaviour is a card the runtime gives meaning to (ADR-0040, ADR-0011 §3), so
 * the library must never offer it as a facet — offering it reads as "author your
 * own Sketch type", which the model forbids.
 */
describe("isBehaviourType", () => {
  it("recognises the runtime-owned types and nothing else", () => {
    for (const id of behaviourTypeIds) expect(isBehaviourType(id)).toBe(true);
    expect(isBehaviourType("note")).toBe(false);
    expect(isBehaviourType("character")).toBe(false);
  });

  it("reads a missing or unset type as not a behaviour", () => {
    expect(isBehaviourType(undefined)).toBe(false);
    expect(isBehaviourType(null)).toBe(false);
    expect(isBehaviourType("")).toBe(false);
  });
});
