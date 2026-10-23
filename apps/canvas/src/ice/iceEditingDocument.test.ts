import { WorkspaceDocument } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { workspaceWriter } from "./iceBridge";
import { type CanonicalPlacement, CardProjection } from "./iceCardProjection";
import {
  createIceEditingController,
  type IceEditingOptions,
  type ScreenPoint,
} from "./iceEditingController";

/**
 * The canonical round trip, without ICE: a gesture goes through the same writer
 * the canvas uses, the document holds the new placement, Loro undo restores it,
 * and the projection re-derives the entity from the placement it reads.
 */

interface FakeEntity {
  readonly id: number;
  box: { x: number; y: number; width: number; height: number };
}

function documentWithCard() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const card = workspace.createCard({ boardId: board.id, position: { x: 100, y: 120 } });
  return { workspace, board, card };
}

function harness(options: { role?: "editor" | "viewer" } = {}) {
  const { workspace, board, card } = documentWithCard();
  const boxes = new Map<number, { x: number; y: number; width: number; height: number }>();
  boxes.set(1, { x: 100, y: 120, width: 288, height: 240 });

  const editing: IceEditingOptions = {
    camera: () => ({ x: 0, y: 0, zoom: 1 }),
    pick: () => 1,
    rectOf: (entity) => boxes.get(entity) ?? null,
    writer: workspaceWriter(workspace),
    role: options.role ?? "editor",
    removeCards: () => {},
    slots: new Map([[1, { cardId: card.id, boardId: board.id }]]),
    rootBoardId: board.id,
  };
  const controller = createIceEditingController(editing);
  return { workspace, board, card, boxes, controller };
}

function centre(box: { x: number; y: number; width: number; height: number }): ScreenPoint {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

describe("editing a live document", () => {
  it("should move the placement once and let Loro undo restore it", () => {
    const { workspace, board, card, boxes, controller } = harness();
    const start = centre(boxes.get(1) ?? { x: 0, y: 0, width: 1, height: 1 });

    controller.pointerDown(1, start);
    boxes.set(1, { x: 420, y: 380, width: 288, height: 240 });
    expect(controller.pointerUp(1, { x: start.x + 320, y: start.y + 260 })).toBe(true);

    const moved = workspace.getPlacement(board.id, card.id);
    expect(moved?.x).toBeCloseTo(420, 3);
    expect(moved?.y).toBeCloseTo(380, 3);

    workspace.undo();
    const restored = workspace.getPlacement(board.id, card.id);
    expect(restored?.x).toBeCloseTo(100, 3);
    expect(restored?.y).toBeCloseTo(120, 3);

    workspace.redo();
    expect(workspace.getPlacement(board.id, card.id)?.x).toBeCloseTo(420, 3);
  });

  it("should write position and size together on a resize", () => {
    const { workspace, board, card, boxes, controller } = harness();
    const start = centre(boxes.get(1) ?? { x: 0, y: 0, width: 1, height: 1 });

    controller.pointerDown(1, start);
    boxes.set(1, { x: 100, y: 120, width: 360, height: 300 });
    controller.pointerUp(1, { x: start.x + 36, y: start.y + 30 });

    const resized = workspace.getPlacement(board.id, card.id);
    expect(resized?.width).toBeCloseTo(360, 3);
    expect(resized?.height).toBeCloseTo(300, 3);
    expect(resized?.x).toBeCloseTo(100, 3);
  });

  it("should trash the card once and restore it on undo", () => {
    const { workspace, board, card, controller } = harness();
    const removed: string[] = [];

    const withRemoval = createIceEditingController({
      camera: () => ({ x: 0, y: 0, zoom: 1 }),
      pick: () => 1,
      rectOf: () => ({ x: 100, y: 120, width: 288, height: 240 }),
      writer: workspaceWriter(workspace),
      role: "editor",
      removeCards: (ids) => removed.push(...ids),
      slots: new Map([[1, { cardId: card.id, boardId: board.id }]]),
      rootBoardId: board.id,
    });

    expect(withRemoval.deleteSelection([card.id])).toBe(true);
    expect(workspace.getCard(card.id)?.deletedAt).toBeGreaterThan(0);
    expect(removed).toEqual([card.id]);

    workspace.undo();
    expect(workspace.getCard(card.id)?.deletedAt ?? undefined).toBeUndefined();
    expect(workspace.listBoardCards(board.id).map((entry) => entry.id)).toContain(card.id);
    // The gesture itself wrote nothing.
    expect(controller.pointerDown(1, { x: 1, y: 1 })).toBe(true);
  });

  it("should leave the document untouched for a viewer", () => {
    const { workspace, board, card, boxes, controller } = harness({ role: "viewer" });
    const start = centre(boxes.get(1) ?? { x: 0, y: 0, width: 1, height: 1 });

    controller.pointerDown(1, start);
    boxes.set(1, { x: 420, y: 380, width: 288, height: 240 });
    controller.pointerUp(1, { x: start.x + 320, y: start.y + 260 });

    expect(workspace.getPlacement(board.id, card.id)?.x).toBeCloseTo(100, 3);
  });

  it("should re-derive the entity from the canonical placement after an undo", () => {
    const { workspace, board, card, boxes, controller } = harness();
    const start = centre(boxes.get(1) ?? { x: 0, y: 0, width: 1, height: 1 });

    controller.pointerDown(1, start);
    boxes.set(1, { x: 420, y: 380, width: 288, height: 240 });
    controller.pointerUp(1, { x: start.x + 320, y: start.y + 260 });

    let next = 10;
    const spawned: FakeEntity[] = [];
    const projection = new CardProjection<FakeEntity>({
      spawn: (placement: CanonicalPlacement) => {
        next += 1;
        const entity = {
          id: next,
          box: { x: placement.x, y: placement.y, width: 288, height: 240 },
        };
        spawned.push(entity);
        return entity;
      },
      remove: () => {},
      boxOf: (entity) => entity.box,
    });
    const live = { id: 1, box: boxes.get(1) as FakeEntity["box"] };
    projection.register(live, card.id, board.id);

    workspace.undo();
    const placements = workspace.listBoardPlacements(board.id).map((placement) => ({
      boardId: placement.boardId,
      cardId: placement.cardId,
      x: placement.x,
      y: placement.y,
    }));
    const report = projection.reconcile(placements, { width: 288, height: 240 });

    expect(report.moved).toHaveLength(1);
    expect(spawned[0]?.box.x).toBeCloseTo(100, 3);
    expect(spawned[0]?.box.y).toBeCloseTo(120, 3);
  });
});
