import type { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

function sync(a: LoroDoc, b: LoroDoc): void {
  const fromA = a.export({ mode: "update" });
  const fromB = b.export({ mode: "update" });
  b.import(fromA);
  a.import(fromB);
}

function setup() {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureView();
  return { workspace, board };
}

describe("sections", () => {
  it("creates, reads and lists sections per board", () => {
    const { workspace, board } = setup();
    const other = workspace.createView({ name: "Other" });
    const section = workspace.createSection({
      boardId: board.id,
      title: "Research",
      x: 40,
      y: 60,
      width: 420,
      height: 300,
      color: "blue",
    });
    workspace.createSection({ boardId: other.id, title: "Elsewhere", x: 0, y: 0 });

    expect(workspace.getSection(section.id)).toEqual(section);
    expect(workspace.listSections(board.id).map((entry) => entry.title)).toEqual(["Research"]);
    expect(workspace.listSections()).toHaveLength(2);
  });

  it("renames and recolors without rewriting the geometry", () => {
    const { workspace, board } = setup();
    const section = workspace.createSection({ boardId: board.id, x: 10, y: 10 });

    workspace.renameSection(section.id, "Themes");
    workspace.setSectionColor(section.id, "rose");

    expect(workspace.getSection(section.id)).toMatchObject({
      title: "Themes",
      color: "rose",
      x: 10,
      y: 10,
    });

    workspace.setSectionColor(section.id, null);
    expect(workspace.getSection(section.id)?.color).toBeUndefined();
  });

  it("moves sections and member placements in one undo step", () => {
    const { workspace, board } = setup();
    const section = workspace.createSection({
      boardId: board.id,
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    const card = workspace.createCard({ boardId: board.id, position: { x: 40, y: 40 } });

    workspace.moveSectionsBatch({
      sections: [{ id: section.id, x: 100, y: 120 }],
      placements: [{ boardId: board.id, cardId: card.id, x: 140, y: 160 }],
    });

    expect(workspace.getSection(section.id)).toMatchObject({ x: 100, y: 120 });
    expect(workspace.getPlacement(board.id, card.id)).toMatchObject({ x: 140, y: 160 });

    workspace.undo();

    expect(workspace.getSection(section.id)).toMatchObject({ x: 0, y: 0 });
    expect(workspace.getPlacement(board.id, card.id)).toMatchObject({ x: 40, y: 40 });
  });

  it("deletes only the region and keeps its cards", () => {
    const { workspace, board } = setup();
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });
    const card = workspace.createCard({ boardId: board.id, position: { x: 20, y: 20 } });

    workspace.deleteSection(section.id);

    expect(workspace.getSection(section.id)).toBeUndefined();
    expect(workspace.getPlacement(board.id, card.id)).toBeDefined();
    expect(workspace.getCard(card.id)).toBeDefined();
  });

  it("removes a board's sections with the board", () => {
    const { workspace, board } = setup();
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });

    workspace.deleteView(board.id, { cards: "keep" });

    expect(workspace.getSection(section.id)).toBeUndefined();
  });

  it("converges concurrent renames and moves", () => {
    const a = new WorkspaceDocument();
    const b = new WorkspaceDocument();
    const board = a.ensureView();
    b.doc.import(a.doc.export({ mode: "update" }));
    const section = a.createSection({ boardId: board.id, title: "A", x: 0, y: 0 });
    b.doc.import(a.doc.export({ mode: "update" }));

    a.renameSection(section.id, "From A");
    b.updateSectionGeometry(section.id, { x: 200, y: 100, width: 400, height: 300 });
    sync(a.doc, b.doc);

    expect(a.getSection(section.id)).toMatchObject({ title: "From A", x: 200, y: 100 });
    expect(a.listSections(board.id)).toHaveLength(1);
  });
});
