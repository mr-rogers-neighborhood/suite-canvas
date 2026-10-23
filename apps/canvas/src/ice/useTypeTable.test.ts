import { render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { typeTableCardIds, typeTableRows, useTypeTable } from "./useTypeTable";

const types = [
  { id: "note", name: "Note", glyph: "\u25a1" },
  { id: "concept", name: "Concept", glyph: "\u25c6", color: "#8b5cf6" },
  { id: "project", name: "Project", glyph: "P" },
];

const BOARD = "board-1";

function placement(boardId: string, cardId: string) {
  return { boardId, cardId };
}

describe("typeTableRows", () => {
  it("should return no rows for an empty board", () => {
    expect(typeTableRows({ cards: [], placements: [], types }, BOARD)).toEqual([]);
  });

  it("should return no rows when there is no board", () => {
    const cards = [{ id: "c1", primaryTypeId: "note" }];
    expect(typeTableRows({ cards, placements: [placement(BOARD, "c1")], types }, null)).toEqual([]);
  });

  it("should count one type and give it the whole share", () => {
    const cards = [
      { id: "c1", primaryTypeId: "note" },
      { id: "c2", primaryTypeId: "note" },
    ];
    const placements = [placement(BOARD, "c1"), placement(BOARD, "c2")];

    expect(typeTableRows({ cards, placements, types }, BOARD)).toEqual([
      { typeId: "note", name: "Note", glyph: "\u25a1", count: 2, share: 1 },
    ]);
  });

  it("should sort by count and break ties by name", () => {
    const cards = [
      { id: "c1", primaryTypeId: "note" },
      { id: "c2", primaryTypeId: "concept" },
      { id: "c3", primaryTypeId: "concept" },
      { id: "c4", primaryTypeId: "project" },
    ];
    const placements = cards.map((card) => placement(BOARD, card.id));

    const rows = typeTableRows({ cards, placements, types }, BOARD);

    expect(rows.map((row) => row.typeId)).toEqual(["concept", "note", "project"]);
    expect(rows.map((row) => row.count)).toEqual([2, 1, 1]);
    expect(rows[0]?.share).toBeCloseTo(0.5);
    expect(rows[0]?.color).toBe("#8b5cf6");
  });

  it("should skip a card whose type record is gone but keep it in the share", () => {
    const cards = [
      { id: "c1", primaryTypeId: "note" },
      { id: "c2", primaryTypeId: "note" },
      { id: "c3", primaryTypeId: "deleted-type" },
    ];
    const placements = cards.map((card) => placement(BOARD, card.id));

    const rows = typeTableRows({ cards, placements, types }, BOARD);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.typeId).toBe("note");
    // The missing record is not invented, and it is still one of the board's cards.
    expect(rows[0]?.share).toBeCloseTo(2 / 3);
  });

  it("should not count a placement whose card record is gone", () => {
    const cards = [{ id: "c1", primaryTypeId: "note" }];
    const placements = [placement(BOARD, "c1"), placement(BOARD, "missing")];

    expect(typeTableRows({ cards, placements, types }, BOARD)[0]?.share).toBe(1);
  });

  it("should leave trashed cards out of the counts and the total", () => {
    const cards = [
      { id: "c1", primaryTypeId: "note" },
      { id: "c2", primaryTypeId: "concept", deletedAt: 1_700_000_000_000 },
    ];
    const placements = [placement(BOARD, "c1"), placement(BOARD, "c2")];

    expect(typeTableRows({ cards, placements, types }, BOARD)).toEqual([
      { typeId: "note", name: "Note", glyph: "\u25a1", count: 1, share: 1 },
    ]);
  });

  it("should only count placements on the asked-about board", () => {
    const cards = [
      { id: "c1", primaryTypeId: "note" },
      { id: "c2", primaryTypeId: "concept" },
    ];
    const placements = [placement(BOARD, "c1"), placement("board-2", "c2")];

    const rows = typeTableRows({ cards, placements, types }, BOARD);

    expect(rows.map((row) => row.typeId)).toEqual(["note"]);
  });

  it("should count a card once when the same card is placed on two boards", () => {
    const cards = [{ id: "c1", primaryTypeId: "note" }];
    const placements = [placement(BOARD, "c1"), placement("board-2", "c1")];

    expect(typeTableRows({ cards, placements, types }, BOARD)[0]?.count).toBe(1);
  });
});

describe("typeTableCardIds", () => {
  it("should list the live cards of one type on the board, in id order", () => {
    const cards = [
      { id: "c2", primaryTypeId: "note" },
      { id: "c1", primaryTypeId: "note" },
      { id: "c3", primaryTypeId: "concept" },
      { id: "c4", primaryTypeId: "note", deletedAt: 1 },
      { id: "c5", primaryTypeId: "note" },
    ];
    const placements = [
      placement(BOARD, "c2"),
      placement(BOARD, "c1"),
      placement(BOARD, "c3"),
      placement(BOARD, "c4"),
      placement("board-2", "c5"),
    ];

    expect(typeTableCardIds({ cards, placements, types }, BOARD, "note")).toEqual(["c1", "c2"]);
  });

  it("should return nothing without a board", () => {
    const cards = [{ id: "c1", primaryTypeId: "note" }];
    expect(
      typeTableCardIds({ cards, placements: [placement(BOARD, "c1")], types }, null, "note"),
    ).toEqual([]);
  });
});

describe("useTypeTable", () => {
  /** Reads the rows the hook produces for the live store. */
  function Probe({ boardId }: { boardId?: string | null }) {
    const rows = useTypeTable(boardId);
    return createElement(
      "div",
      { "data-testid": "rows" },
      rows.map((row) => `${row.typeId}:${row.count}`).join(","),
    );
  }

  function seedWorkspace() {
    const workspace = useCanvasStore.getState().workspace;
    workspace.ensureDefaultTypes();
    const board = workspace.ensureBoard();
    workspace.createCard({ typeId: "note", boardId: board.id, position: { x: 0, y: 0 } });
    workspace.createCard({ typeId: "note", boardId: board.id, position: { x: 0, y: 10 } });
    workspace.createCard({ typeId: "concept", boardId: board.id, position: { x: 0, y: 20 } });
    useCanvasStore.setState({ ready: true, synced: true });
    return board;
  }

  it("should default to the board the canvas is on", () => {
    const board = seedWorkspace();
    useUiStore.setState({ activeBoardId: board.id });

    render(createElement(Probe, {}));

    expect(screen.getByTestId("rows")).toHaveTextContent("note:2,concept:1");
  });

  it("should follow an explicit board over the active one", () => {
    const board = seedWorkspace();
    const drafts = useCanvasStore.getState().workspace.createBoard({ name: "Drafts" });
    useUiStore.setState({ activeBoardId: board.id });

    render(createElement(Probe, { boardId: drafts.id }));

    // The drafts board is empty, so the seeded board's rows must not leak in.
    expect(screen.getByTestId("rows")).toBeEmptyDOMElement();
  });
});
