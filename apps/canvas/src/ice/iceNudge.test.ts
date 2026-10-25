import { describe, expect, it, vi } from "vitest";

import { applyCanonicalWrite, type CanonicalWriter, capabilitiesForRole } from "./iceBridge";
import { ICE_NUDGE_STEP, ICE_NUDGE_STEP_FAR, type IceNudgeCard, planNudge } from "./iceNudge";

const writerCaps = capabilitiesForRole("editor");
const viewerCaps = capabilitiesForRole("viewer");

const card = (overrides: Partial<IceNudgeCard> = {}): IceNudgeCard => ({
  cardId: "card-a",
  boardId: "board-1",
  x: 100,
  y: 100,
  width: 120,
  height: 80,
  ...overrides,
});

function writer(): CanonicalWriter & {
  readonly calls: Array<{
    boardId: string;
    moves: readonly { cardId: string; x: number; y: number }[];
  }>;
} {
  const calls: Array<{
    boardId: string;
    moves: readonly { cardId: string; x: number; y: number }[];
  }> = [];
  return {
    calls,
    movePlacements: (boardId, moves) => {
      calls.push({ boardId, moves });
    },
    updatePlacementGeometry: vi.fn(),
    createCard: vi.fn(),
    trashCards: vi.fn(),
    moveSections: vi.fn(),
    updateSectionGeometry: vi.fn(),
    updateBoardRect: vi.fn(),
    nestBoard: vi.fn(),
    deleteSections: vi.fn(),
    addEdge: vi.fn(),
    removeEdges: vi.fn(),
  };
}

describe("nudging a selection", () => {
  it("should move one unit in the pressed direction, as one move write", () => {
    const plan = planNudge({
      cards: [card()],
      delta: { x: ICE_NUDGE_STEP, y: 0 },
      capabilities: writerCaps,
    });
    if (plan.status !== "commit") throw new Error("expected a commit");
    const target = writer();
    applyCanonicalWrite(target, plan.write);
    expect(target.calls).toEqual([
      { boardId: "board-1", moves: [{ cardId: "card-a", x: 101, y: 100 }] },
    ]);
  });

  it("should step ten units with the far step and keep the size", () => {
    const plan = planNudge({
      cards: [card()],
      delta: { x: 0, y: -ICE_NUDGE_STEP_FAR },
      capabilities: writerCaps,
    });
    if (plan.status !== "commit") throw new Error("expected a commit");
    if (plan.write.kind !== "movePlacements") throw new Error("expected one board");
    expect(plan.write.moves[0]).toEqual({ cardId: "card-a", x: 100, y: 90 });
  });

  it("should move a multi-selection in one write", () => {
    const plan = planNudge({
      cards: [card({ cardId: "a" }), card({ cardId: "b", x: 400 })],
      delta: { x: 0, y: ICE_NUDGE_STEP },
      capabilities: writerCaps,
    });
    if (plan.status !== "commit") throw new Error("expected a commit");
    const target = writer();
    applyCanonicalWrite(target, plan.write);
    expect(target.calls).toHaveLength(1);
    expect(target.calls[0]?.moves).toEqual([
      { cardId: "a", x: 100, y: 101 },
      { cardId: "b", x: 400, y: 101 },
    ]);
  });

  it("should keep a selection that spans Boards as one gesture", () => {
    const plan = planNudge({
      cards: [card({ cardId: "a" }), card({ cardId: "b", boardId: "board-2" })],
      delta: { x: ICE_NUDGE_STEP, y: 0 },
      capabilities: writerCaps,
    });
    if (plan.status !== "commit") throw new Error("expected a commit");
    expect(plan.write.kind).toBe("movePlacementsMany");
    if (plan.write.kind !== "movePlacementsMany") return;
    expect(plan.write.groups.map((group) => group.boardId)).toEqual(["board-1", "board-2"]);
  });

  it("should write nothing for a viewer", () => {
    expect(planNudge({ cards: [card()], delta: { x: 1, y: 0 }, capabilities: viewerCaps })).toEqual(
      {
        status: "denied",
        reason: "read-only",
      },
    );
  });

  it("should write nothing when no card resolved", () => {
    expect(
      planNudge({ cards: [], delta: { x: 1, y: 0 }, capabilities: writerCaps }).status,
    ).not.toBe("commit");
  });
});
