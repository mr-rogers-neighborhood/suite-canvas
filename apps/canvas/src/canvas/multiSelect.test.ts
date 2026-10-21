import type { LayerAction } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CARD_HEIGHT,
  DEFAULT_CARD_WIDTH,
  dragMoves,
  dragRects,
  layerActions,
  orderedSelection,
  selectionSummary,
} from "./multiSelect";

/**
 * The board's paint order after one layer action, mirroring
 * `WorkspaceDocument.moveLayer`'s index math (including its no-op case).
 */
function applyLayer(order: readonly string[], id: string, action: LayerAction): string[] {
  const index = order.indexOf(id);
  if (index === -1) return [...order];
  const rest = order.filter((entry) => entry !== id);
  const target =
    action === "front"
      ? rest.length
      : action === "back"
        ? 0
        : action === "forward"
          ? Math.min(rest.length, index + 1)
          : Math.max(0, index - 1);
  if (target === index) return [...order];
  const next = [...rest];
  next.splice(target, 0, id);
  return next;
}

function applyAll(order: readonly string[], ids: readonly string[], action: LayerAction): string[] {
  return layerActions(ids, action).reduce(
    (current, id) => applyLayer(current, id, action),
    [...order],
  );
}

describe("selectionSummary", () => {
  it("counts distinct cards and pluralises the label", () => {
    expect(selectionSummary(["a"])).toMatchObject({ count: 1, multiple: false, noun: "1 card" });
    expect(selectionSummary(["a", "b"])).toMatchObject({
      count: 2,
      multiple: true,
      noun: "2 cards",
    });
    expect(selectionSummary([])).toMatchObject({ count: 0, multiple: false, noun: "0 cards" });
  });

  it("dedupes ids without losing their order", () => {
    const summary = selectionSummary(["b", "a", "b"]);
    expect(summary.ids).toEqual(["b", "a"]);
    expect(summary.count).toBe(2);
  });
});

describe("orderedSelection", () => {
  it("returns the selection in board paint order and ignores off-board ids", () => {
    expect(orderedSelection(["a", "b", "c"], ["c", "a", "gone"])).toEqual(["a", "c"]);
  });
});

describe("layerActions", () => {
  const board = ["a", "b", "c", "d", "e"];
  const selected = orderedSelection(board, ["b", "d"]);

  it("brings a selection to the front without reordering it", () => {
    expect(applyAll(board, selected, "front")).toEqual(["a", "c", "e", "b", "d"]);
  });

  it("sends a selection to the back without reordering it", () => {
    expect(applyAll(board, selected, "back")).toEqual(["b", "d", "a", "c", "e"]);
  });

  it("moves every selected card forward exactly one layer", () => {
    expect(applyAll(board, selected, "forward")).toEqual(["a", "c", "b", "e", "d"]);
  });

  it("moves every selected card backward exactly one layer", () => {
    expect(applyAll(board, selected, "backward")).toEqual(["b", "a", "d", "c", "e"]);
  });

  it("keeps a contiguous selection together", () => {
    expect(applyAll(board, ["b", "c"], "front")).toEqual(["a", "d", "e", "b", "c"]);
    expect(applyAll(board, ["b", "c"], "back")).toEqual(["b", "c", "a", "d", "e"]);
  });

  it("returns the ids in the direction the action is applied", () => {
    expect(layerActions(["a", "b", "c"], "front")).toEqual(["a", "b", "c"]);
    expect(layerActions(["a", "b", "c"], "backward")).toEqual(["a", "b", "c"]);
    expect(layerActions(["a", "b", "c"], "forward")).toEqual(["c", "b", "a"]);
    expect(layerActions(["a", "b", "c"], "back")).toEqual(["c", "b", "a"]);
  });
});

describe("dragMoves", () => {
  it("maps nodes to placement moves", () => {
    expect(
      dragMoves([
        { id: "a", position: { x: 10, y: 20 } },
        { id: "b", position: { x: -5.5, y: 0 } },
      ]),
    ).toEqual([
      { cardId: "a", x: 10, y: 20 },
      { cardId: "b", x: -5.5, y: 0 },
    ]);
  });
});

describe("dragRects", () => {
  it("prefers the measured size, then the stored size, then the canvas default", () => {
    expect(
      dragRects([
        { id: "a", position: { x: 0, y: 0 }, measured: { width: 300, height: 200 }, width: 1 },
        { id: "b", position: { x: 1, y: 2 }, width: 240, height: 180 },
        { id: "c", position: { x: 3, y: 4 } },
      ]),
    ).toEqual([
      { x: 0, y: 0, width: 300, height: 200 },
      { x: 1, y: 2, width: 240, height: 180 },
      { x: 3, y: 4, width: DEFAULT_CARD_WIDTH, height: DEFAULT_CARD_HEIGHT },
    ]);
  });
});
