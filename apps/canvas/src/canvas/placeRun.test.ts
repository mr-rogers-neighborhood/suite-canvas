import { describe, expect, it } from "vitest";
import {
  boxesOverlap,
  DEFAULT_PLACEMENT_OPTIONS,
  type PlanPlacementInput,
  planPlacementStep,
  planRunFrame,
  type RunBox,
} from "./placeRun";

/**
 * A run's shape is geometry, and geometry is worth pinning exactly: the same
 * queue in the same mode must always produce the same board, or a preview and the
 * commit can disagree. See ADR-0063.
 */

const SIZE = { width: 240, height: 200 };
const START = { x: 0, y: 0 };

function step(overrides: Partial<PlanPlacementInput> = {}) {
  return planPlacementStep({
    mode: "place",
    index: 0,
    size: SIZE,
    origin: null,
    anchor: null,
    start: START,
    occupied: [],
    ...overrides,
  });
}

/** Runs `count` steps, returning every box the run would place. */
function run(mode: PlanPlacementInput["mode"], count: number, options = DEFAULT_PLACEMENT_OPTIONS) {
  const boxes: RunBox[] = [];
  for (let index = 0; index < count; index += 1) {
    const result = step({
      mode,
      index,
      origin: boxes[0] ?? null,
      anchor: boxes[index - 1] ?? null,
      options,
    });
    boxes.push({ ...result.position, ...SIZE });
  }
  return boxes;
}

describe("planPlacementStep: the first card", () => {
  it("lands on the start point in every mode, and draws no line", () => {
    for (const mode of ["place", "thread", "web", "pattern"] as const) {
      const result = step({ mode });
      expect(result.position).toEqual(START);
      // There is nothing in the run to link to yet, and linking outside it would
      // be inventing a relationship.
      expect(result.link).toBeNull();
    }
  });
});

describe("planPlacementStep: place", () => {
  it("fills a row before wrapping, gap apart", () => {
    const boxes = run("place", 5, { ...DEFAULT_PLACEMENT_OPTIONS, columns: 3, gap: 40 });

    expect(boxes[1]).toEqual({ x: 280, y: 0, ...SIZE });
    expect(boxes[2]).toEqual({ x: 560, y: 0, ...SIZE });
    // The fourth card wraps to a second row.
    expect(boxes[3]).toEqual({ x: 0, y: 240, ...SIZE });
    expect(boxes[4]).toEqual({ x: 280, y: 240, ...SIZE });
  });

  it("draws no links: a dump is a dump", () => {
    expect(step({ mode: "place", index: 3, anchor: { x: 0, y: 0, ...SIZE } }).link).toBeNull();
  });

  it("nudges off a card that is already on the board", () => {
    const occupied = [{ x: 0, y: 0, ...SIZE }];
    const result = step({ occupied });

    expect(boxesOverlap({ ...result.position, ...SIZE }, occupied[0] as RunBox)).toBe(false);
    // Nudged down-right, so it reads as "next to" rather than "above".
    expect(result.position.x).toBeGreaterThan(0);
    expect(result.position.y).toBeGreaterThan(0);
  });
});

describe("planPlacementStep: thread", () => {
  it("places each card right of the one before it, vertically centred", () => {
    const boxes = run("thread", 3, { ...DEFAULT_PLACEMENT_OPTIONS, gap: 48 });

    expect(boxes[1]).toEqual({ x: 288, y: 0, ...SIZE });
    expect(boxes[2]).toEqual({ x: 576, y: 0, ...SIZE });
  });

  it("centres a shorter card on a taller one", () => {
    const taller: RunBox = { x: 0, y: 0, width: 240, height: 300 };
    const result = planPlacementStep({
      mode: "thread",
      index: 1,
      size: SIZE,
      origin: taller,
      anchor: taller,
      start: START,
      occupied: [],
      options: DEFAULT_PLACEMENT_OPTIONS,
    });

    expect(result.position.y).toBe((300 - 200) / 2);
  });

  it("links each card to the one before it", () => {
    expect(step({ mode: "thread", index: 2, anchor: { x: 0, y: 0, ...SIZE } }).link).toEqual({
      from: "anchor",
      to: "left",
    });
  });
});

describe("planPlacementStep: web", () => {
  it("places spokes around the origin, never on it", () => {
    const origin: RunBox = { x: 0, y: 0, ...SIZE };
    const spokes = [1, 2, 3, 4, 5].map(
      (index) => step({ mode: "web", index, origin, anchor: origin }).position,
    );

    for (const spoke of spokes) {
      const box = { ...spoke, ...SIZE };
      expect(boxesOverlap(box, origin)).toBe(false);
    }
    // The first spoke is to the right of the hub, so the shape has a readable start.
    expect(spokes[0]?.x).toBeGreaterThan(origin.x + origin.width);
    expect(Math.round(spokes[0]?.y ?? 0)).toBe(0);
  });

  it("spaces spokes unevenly on purpose, so any count reads as a ring", () => {
    const origin: RunBox = { x: 0, y: 0, ...SIZE };
    const first = step({ mode: "web", index: 1, origin, anchor: origin }).position;
    const second = step({ mode: "web", index: 2, origin, anchor: origin }).position;

    // A fixed angle would place spoke two opposite spoke one; the golden angle does
    // not, which is what keeps three spokes and twelve spokes both readable.
    const angleOf = (point: { x: number; y: number }) =>
      Math.atan2(point.y - (origin.y + origin.height / 2), point.x - (origin.x + origin.width / 2));
    expect(Math.abs(angleOf(first) - angleOf(second))).toBeGreaterThan(0.1);
  });

  it("links every spoke back to the origin, not to the previous spoke", () => {
    const origin: RunBox = { x: 0, y: 0, ...SIZE };
    const anchor: RunBox = { x: 400, y: 300, ...SIZE };

    expect(step({ mode: "web", index: 3, origin, anchor }).link).toEqual({
      from: "origin",
      to: "left",
    });
  });
});

describe("planPlacementStep: pattern", () => {
  it("branches right then left, one row down each time", () => {
    const boxes = run("pattern", 4, { ...DEFAULT_PLACEMENT_OPTIONS, gap: 40 });

    // Second card: right of the first, one row down.
    expect(boxes[1]).toEqual({ x: 280, y: 220, ...SIZE });
    // Third: left of the second, which is back past the first card's column.
    expect(boxes[2]?.x).toBeLessThan(boxes[1]?.x ?? 0);
    expect(boxes[2]?.y).toBe((boxes[1]?.y ?? 0) + SIZE.height + 20);
  });

  it("links each card to its parent", () => {
    expect(step({ mode: "pattern", index: 1, anchor: { x: 0, y: 0, ...SIZE } }).link).toEqual({
      from: "anchor",
      to: "top",
    });
  });
});

describe("planRunFrame", () => {
  it("wraps everything the run placed, padded on all four sides", () => {
    const frame = planRunFrame(
      [
        { x: 0, y: 0, ...SIZE },
        { x: 400, y: 300, ...SIZE },
      ],
      32,
    );

    expect(frame).toEqual({ x: -32, y: -32, width: 240 + 400 + 64, height: 200 + 300 + 64 });
  });

  it("has no frame for a run that placed nothing", () => {
    expect(planRunFrame([], 32)).toBeNull();
  });
});
