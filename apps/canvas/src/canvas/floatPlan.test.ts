import { describe, expect, it } from "vitest";
import { type FloatBounds, type FloatInput, type FloatRect, planFloats } from "./floatPlan";

const bounds: FloatBounds = { x: 0, y: 0, width: 1200, height: 800 };

const shell: readonly FloatRect[] = [
  { id: "title", x: 0, y: 0, width: 1200, height: 48 },
  { id: "dock", x: 0, y: 700, width: 1200, height: 100 },
];

function overlaps(a: FloatRect, b: FloatRect, gap = 8): boolean {
  return (
    a.x < b.x + b.width + gap &&
    b.x < a.x + a.width + gap &&
    a.y < b.y + b.height + gap &&
    b.y < a.y + a.height + gap
  );
}

function inside(rect: FloatRect, area: FloatBounds = bounds): boolean {
  return (
    rect.x >= area.x - 1 &&
    rect.y >= area.y - 1 &&
    rect.x + rect.width <= area.x + area.width + 1 &&
    rect.y + rect.height <= area.y + area.height + 1
  );
}

function find(rects: readonly FloatRect[], id: string): FloatRect {
  const found = rects.find((rect) => rect.id === id);
  if (found === undefined) throw new Error(`missing ${id}`);
  return found;
}

/** A tiny deterministic PRNG, so a failing case is reproducible. */
function rng(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("planFloats", () => {
  it("should leave a pin that is already legal exactly where it is", () => {
    const pin: FloatRect = { id: "card", x: 300, y: 200, width: 200, height: 150 };

    const plan = planFloats({ moving: [pin], obstacles: shell, bounds });

    expect(plan.rects).toEqual([pin]);
    expect(plan.moved).toEqual([]);
  });

  it("should separate two pins and keep the first one still", () => {
    const first: FloatRect = { id: "a", x: 300, y: 200, width: 200, height: 150 };
    const second: FloatRect = { id: "b", x: 320, y: 210, width: 200, height: 150 };

    const plan = planFloats({ moving: [first, second], obstacles: [], bounds });

    expect(find(plan.rects, "a")).toEqual(first);
    expect(overlaps(find(plan.rects, "a"), find(plan.rects, "b"))).toBe(false);
    expect(plan.moved).toEqual(["b"]);
  });

  it("should move a pin out from under the shell chrome", () => {
    const pin: FloatRect = { id: "card", x: 400, y: 10, width: 200, height: 150 };

    const plan = planFloats({ moving: [pin], obstacles: shell, bounds });
    const settled = find(plan.rects, "card");

    for (const obstacle of shell) expect(overlaps(settled, obstacle)).toBe(false);
    expect(inside(settled)).toBe(true);
    expect(plan.moved).toEqual(["card"]);
  });

  it("should pull a pin that starts outside the bounds back inside", () => {
    const pin: FloatRect = { id: "card", x: 3000, y: -400, width: 200, height: 150 };

    const plan = planFloats({ moving: [pin], obstacles: [], bounds });

    expect(inside(find(plan.rects, "card"))).toBe(true);
  });

  it("should do nothing at all when no pin is moving", () => {
    expect(planFloats({ moving: [], obstacles: shell, bounds })).toEqual({
      rects: [],
      moved: [],
    });
  });

  it("should give the same plan for the same input twice", () => {
    const input: FloatInput = {
      moving: [
        { id: "a", x: 100, y: 100, width: 200, height: 150 },
        { id: "b", x: 120, y: 110, width: 200, height: 150 },
        { id: "c", x: 140, y: 120, width: 200, height: 150 },
      ],
      obstacles: shell,
      bounds,
    };

    expect(planFloats(input)).toEqual(planFloats(input));
  });

  it("should never leave an overlap or leave the bounds, whatever the layout", () => {
    // The invariants, over layouts nobody hand-picked. A solver that only satisfies the
    // cases in this file is not a solver, which is what a random sweep is here to catch.
    for (let seed = 1; seed <= 150; seed += 1) {
      const random = rng(seed);
      const make = (id: string): FloatRect => ({
        id,
        x: Math.round(random() * 1000),
        y: Math.round(random() * 640),
        width: 80 + Math.round(random() * 140),
        height: 60 + Math.round(random() * 120),
      });
      const moving = Array.from({ length: 5 }, (_, index) => make(`m${String(index)}`));
      const obstacles = Array.from({ length: 2 }, (_, index) => make(`o${String(index)}`));
      const plan = planFloats({ moving, obstacles, bounds, gap: 8 });

      expect(plan.rects).toHaveLength(moving.length);
      for (const rect of plan.rects) {
        expect(inside(rect), `seed ${String(seed)} ${rect.id} left the bounds`).toBe(true);
        // A pin must clear the shell chrome and every other pin. Obstacles may overlap
        // each other: chrome is chrome, and the solver does not arrange the window.
        for (const obstacle of obstacles) {
          expect(
            overlaps(rect, obstacle, 7),
            `seed ${String(seed)}: ${rect.id} overlaps ${obstacle.id}`,
          ).toBe(false);
        }
      }
      for (let i = 0; i < plan.rects.length; i += 1) {
        for (let j = i + 1; j < plan.rects.length; j += 1) {
          const left = plan.rects[i] as FloatRect;
          const right = plan.rects[j] as FloatRect;
          expect(
            overlaps(left, right, 7),
            `seed ${String(seed)}: ${left.id} overlaps ${right.id}`,
          ).toBe(false);
        }
      }
    }
  });
});
