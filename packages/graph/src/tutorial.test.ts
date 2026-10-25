import { describe, expect, it } from "vitest";
import type { Target } from "./target.js";
import {
  emptyTourStep,
  normalizeStep,
  parseStep,
  primaryTarget,
  STEP_ATTRIBUTES,
  stepAttributes,
  stepHasDeadTarget,
  type TargetExistence,
  tourStepAdvanceModes,
} from "./tutorial.js";

const card = (id: string): Target => ({ kind: "card", id });
const section = (id: string): Target => ({ kind: "section", id });

const allPresent: TargetExistence = {
  card: () => true,
  board: () => true,
  section: () => true,
  link: () => true,
};

describe("parseStep", () => {
  it("should round-trip a stored step through its attributes unchanged", () => {
    const stored = {
      id: "step-1",
      targets: [card("a"), section("s1")],
      viewport: { x: 120, y: -40, zoom: 1.5 },
      caption: "Start with the outline",
      advance: "click" as const,
    };

    const parsed = parseStep(stored);
    expect(parsed).toEqual(stored);
    // The node hands attributes back exactly as it stored them, so a save and a
    // reload of the block cannot drift.
    expect(parseStep(stepAttributes(parsed))).toEqual(stored);
  });

  it("should keep several targets and read the first as primary", () => {
    const parsed = parseStep({ targets: [card("a"), card("b"), section("s1")] });

    expect(parsed?.targets.map((target) => target.id)).toEqual(["a", "b", "s1"]);
    expect(primaryTarget(parsed as NonNullable<typeof parsed>)).toEqual(card("a"));
  });

  it("should treat a null attribute as absent rather than invalid", () => {
    const parsed = parseStep({
      stepId: null,
      targets: [card("a")],
      viewport: null,
      caption: null,
      advance: null,
    });

    expect(parsed).toEqual({ id: undefined, targets: [card("a")] });
    expect(stepAttributes(parsed)).toEqual({
      stepId: null,
      targets: [card("a")],
      viewport: null,
      caption: null,
      advance: "next",
    });
  });

  it("should drop a malformed or duplicated target and keep the good ones", () => {
    const parsed = normalizeStep({
      targets: [card("a"), { kind: "nope", id: "x" }, card("a"), { id: "broken" }, card("b")],
    });

    expect(parsed?.targets).toEqual([card("a"), card("b")]);
  });

  it("should refuse a step with no target, which is what an unarmed block is", () => {
    expect(parseStep({ targets: [] })).toBeNull();
    expect(parseStep(emptyTourStep("step-1"))).toBeNull();
    expect(parseStep(null)).toBeNull();
    expect(parseStep("tour")).toBeNull();
  });

  it("should trim a caption and drop an empty one", () => {
    expect(parseStep({ targets: [card("a")], caption: "  read this  " })?.caption).toBe(
      "read this",
    );
    expect(parseStep({ targets: [card("a")], caption: "   " })?.caption).toBeUndefined();
  });

  it("should refuse a viewport that cannot be a camera", () => {
    expect(parseStep({ targets: [card("a")], viewport: { x: 0, y: 0, zoom: 0 } })?.viewport).toBe(
      undefined,
    );
    expect(
      parseStep({ targets: [card("a")], viewport: { x: 0, y: 0, zoom: 2 } })?.viewport,
    ).toEqual({ x: 0, y: 0, zoom: 2 });
  });

  it("should keep the advance mode vocabulary small and known", () => {
    expect(tourStepAdvanceModes).toEqual(["next", "click"]);
    expect(parseStep({ targets: [card("a")], advance: "auto" })?.advance).toBeUndefined();
  });
});

describe("dead targets", () => {
  const step = parseStep({ targets: [card("here"), card("gone")] });

  it("should report a target the document no longer holds", () => {
    const exists: TargetExistence = { ...allPresent, card: (id) => id === "here" };

    expect(stepHasDeadTarget(step as NonNullable<typeof step>, exists)).toBe(true);
    expect(
      stepHasDeadTarget(parseStep({ targets: [card("here")] }) as NonNullable<typeof step>, exists),
    ).toBe(false);
  });
});

describe("step attributes", () => {
  it("should name exactly the attributes the block declares", () => {
    expect([...STEP_ATTRIBUTES]).toEqual(["stepId", "targets", "viewport", "caption", "advance"]);
  });
});
