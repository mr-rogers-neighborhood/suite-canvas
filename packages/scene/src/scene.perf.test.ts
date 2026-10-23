import { describe, expect, it } from "vitest";
import { buildScene } from "./scene.js";
import type { BuildSceneInput, SceneCardInput, ScenePlacementInput } from "./types.js";

/**
 * `buildScene` is the whole projection: it walks placements, resolves LOD per
 * instance and lays out portal children before React paints anything. A board
 * of this size has to stay in the low milliseconds, so the budget below is a
 * smoke check for an accidental superlinear pass (a nested scan, a per-card
 * allocation loop), not a performance target. Measured on a dev laptop at
 * ~1-2 ms for 1 000 cards and ~5-8 ms for 5 000; the ceiling is two orders of
 * magnitude above that so a loaded CI machine cannot fail it for being busy.
 */
const BUDGET_MS = 500;
const COLUMNS = 40;

const note = (id: string): SceneCardInput => ({ id, primaryTypeId: "note", properties: {} });

/** Grid-placed, fixed-id cards: the same fixture on every run and machine. */
function boardOf(cards: number): BuildSceneInput {
  const inputs: SceneCardInput[] = [];
  const placements: ScenePlacementInput[] = [];
  for (let index = 0; index < cards; index += 1) {
    const id = `card-${index}`;
    inputs.push(note(id));
    placements.push({
      boardId: "board",
      cardId: id,
      x: (index % COLUMNS) * 280,
      y: Math.floor(index / COLUMNS) * 200,
      z: index,
    });
  }
  return {
    boards: [{ id: "board", name: "Board" }],
    cards: inputs,
    placements,
    rootBoardId: "board",
    camera: { x: 0, y: 0, zoom: 1 },
  };
}

function projectMs(cards: number): number {
  const input = boardOf(cards);
  const started = performance.now();
  const scene = buildScene(input);
  const elapsed = performance.now() - started;
  // Correctness first: a fast run that lost cards is not a projection.
  expect(scene.counts.cards).toBe(cards);
  expect(scene.cards).toHaveLength(cards);
  return elapsed;
}

describe("projection cost", () => {
  // Warm the JIT on a smaller board so the measured runs are not the first
  // execution of every code path.
  projectMs(1_000);

  it("should project 1 000 cards within the smoke budget", () => {
    expect(projectMs(1_000)).toBeLessThan(BUDGET_MS);
  });

  it("should project 5 000 cards within the smoke budget", () => {
    expect(projectMs(5_000)).toBeLessThan(BUDGET_MS);
  });
});
