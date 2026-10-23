import { describe, expect, it } from "vitest";
import { PIN_LABEL_MAX_LENGTH, type Pin, pinSchema, pinTargetKinds, sortPins } from "./pins.js";

function pin(overrides: Partial<Pin> = {}): Pin {
  return {
    id: "pin-1",
    boardId: "board-1",
    x: 120,
    y: 240,
    label: "Chapter two",
    color: "amber",
    createdBy: "user-1",
    createdAt: 1_000,
    ...overrides,
  };
}

describe("pinSchema", () => {
  it("accepts a minimal pin and keeps its point exact", () => {
    const parsed = pinSchema.parse(pin({ x: -12.5, y: 0.25 }));

    expect(parsed).toEqual(pin({ x: -12.5, y: 0.25 }));
    expect(parsed.target).toBeUndefined();
  });

  it("trims a label and drops surrounding whitespace", () => {
    expect(pinSchema.parse(pin({ label: "  Chapter two  " })).label).toBe("Chapter two");
  });

  it("refuses an empty or whitespace-only label", () => {
    expect(pinSchema.safeParse(pin({ label: "" })).success).toBe(false);
    expect(pinSchema.safeParse(pin({ label: "   " })).success).toBe(false);
  });

  it("caps the label at the shared maximum", () => {
    const atLimit = "x".repeat(PIN_LABEL_MAX_LENGTH);
    const overLimit = "x".repeat(PIN_LABEL_MAX_LENGTH + 1);

    expect(pinSchema.safeParse(pin({ label: atLimit })).success).toBe(true);
    expect(pinSchema.safeParse(pin({ label: overLimit })).success).toBe(false);
  });

  it("refuses a non-finite coordinate", () => {
    expect(pinSchema.safeParse(pin({ x: Number.NaN })).success).toBe(false);
    expect(pinSchema.safeParse(pin({ y: Number.POSITIVE_INFINITY })).success).toBe(false);
  });

  it("refuses an unknown colour and an empty board or id", () => {
    expect(pinSchema.safeParse(pin({ color: "chartreuse" as Pin["color"] })).success).toBe(false);
    expect(pinSchema.safeParse(pin({ boardId: "" })).success).toBe(false);
    expect(pinSchema.safeParse(pin({ createdBy: "" })).success).toBe(false);
  });

  it("accepts every target kind and refuses an unknown one", () => {
    for (const kind of pinTargetKinds) {
      const parsed = pinSchema.parse(pin({ target: { kind, id: "target-1" } }));

      expect(parsed.target).toEqual({ kind, id: "target-1" });
    }

    expect(
      pinSchema.safeParse(pin({ target: { kind: "portal" as "card", id: "board-2" } })).success,
    ).toBe(false);
    expect(pinSchema.safeParse(pin({ target: { kind: "card", id: "" } })).success).toBe(false);
  });

  it("refuses a timestamp that is not a whole non-negative number", () => {
    expect(pinSchema.safeParse(pin({ createdAt: -1 })).success).toBe(false);
    expect(pinSchema.safeParse(pin({ createdAt: 1.5 })).success).toBe(false);
  });
});

describe("sortPins", () => {
  it("should order by creation time, then by id", () => {
    // Kills the createdAt/id comparison mutants: without the tie-break two pins
    // created in the same millisecond would list in key-iteration order.
    const late = pin({ id: "b", createdAt: 2_000 });
    const early = pin({ id: "a", createdAt: 1_000 });
    const sameTimeLateId = pin({ id: "c", createdAt: 1_000 });

    expect(sortPins([late, sameTimeLateId, early]).map((entry) => entry.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });

  it("should not mutate the caller's list", () => {
    const unsorted = [pin({ id: "b", createdAt: 2 }), pin({ id: "a", createdAt: 1 })];

    expect(sortPins(unsorted).map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(unsorted.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});
