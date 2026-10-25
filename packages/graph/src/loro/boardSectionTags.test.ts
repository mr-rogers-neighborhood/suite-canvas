import { LoroDoc } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

/** A document with one board on it: a workspace does not seed a board by itself. */
function workspace() {
  const doc = new WorkspaceDocument();
  const board = doc.createBoard({ name: "Tags" });
  return { doc, board };
}

/** Reconciles two replicas the way the sync provider does: both updates, both ways. */
function sync(a: WorkspaceDocument, b: WorkspaceDocument): void {
  const fromA = a.exportUpdate();
  const fromB = b.exportUpdate();
  a.importUpdate(fromB);
  b.importUpdate(fromA);
}

describe("board and section tags", () => {
  it("round-trips a board's tags through getBoard and listBoards", () => {
    const { doc, board } = workspace();
    const research = doc.createTag({ name: "Research" });
    const draft = doc.createTag({ name: "Draft" });

    doc.setBoardTags(board.id, [research.id, draft.id]);

    const expected = [draft.id, research.id].sort();
    expect(doc.getBoard(board.id)?.tags).toEqual(expected);
    expect(doc.listBoards().find((entry) => entry.id === board.id)?.tags).toEqual(expected);
  });

  it("round-trips a section's tags through getSection and listSections", () => {
    const { doc, board } = workspace();
    const section = doc.createSection({ boardId: board.id, title: "Region", x: 0, y: 0 });
    const tag = doc.createTag({ name: "Lens" });

    doc.setSectionTags(section.id, [tag.id]);

    expect(doc.getSection(section.id)?.tags).toEqual([tag.id]);
    expect(doc.listSections(board.id).find((entry) => entry.id === section.id)?.tags).toEqual([
      tag.id,
    ]);
  });

  it("keeps tags added on two replicas when they merge", () => {
    const a = new WorkspaceDocument();
    const board = a.createBoard({ name: "Shared" });
    const section = a.createSection({ boardId: board.id, title: "Region", x: 0, y: 0 });
    const fromA = a.createTag({ name: "Alpha" });
    const fromB = a.createTag({ name: "Beta" });

    const b = new WorkspaceDocument();
    b.importSnapshot(a.exportSnapshot());

    a.addBoardTag(board.id, fromA.id);
    a.addSectionTag(section.id, fromA.id);
    b.addBoardTag(board.id, fromB.id);
    b.addSectionTag(section.id, fromB.id);
    sync(a, b);

    const expected = [fromA.id, fromB.id].sort();
    expect(a.getBoard(board.id)?.tags).toEqual(expected);
    expect(b.getBoard(board.id)?.tags).toEqual(expected);
    expect(a.getSection(section.id)?.tags).toEqual(expected);
    expect(b.getSection(section.id)?.tags).toEqual(expected);
  });

  it("removing a tag leaves the others alone", () => {
    const { doc, board } = workspace();
    const section = doc.createSection({ boardId: board.id, title: "Region", x: 0, y: 0 });
    const keep = doc.createTag({ name: "Keep" });
    const drop = doc.createTag({ name: "Drop" });
    doc.setBoardTags(board.id, [keep.id, drop.id]);
    doc.setSectionTags(section.id, [keep.id, drop.id]);

    doc.removeBoardTag(board.id, drop.id);
    doc.removeSectionTag(section.id, drop.id);

    expect(doc.getBoard(board.id)?.tags).toEqual([keep.id]);
    expect(doc.getSection(section.id)?.tags).toEqual([keep.id]);

    doc.setBoardTags(board.id, [keep.id]);
    expect(doc.getBoard(board.id)?.tags).toEqual([keep.id]);
  });

  it("carries tags onto a duplicated board and its sections", () => {
    const { doc, board } = workspace();
    const tag = doc.createTag({ name: "Carried" });
    const section = doc.createSection({ boardId: board.id, title: "Region", x: 0, y: 0 });
    doc.setBoardTags(board.id, [tag.id]);
    doc.setSectionTags(section.id, [tag.id]);

    const copy = doc.duplicateBoard(board.id);
    if (!copy) throw new Error("a board with a name is duplicable");

    expect(doc.getBoard(copy.id)?.tags).toEqual([tag.id]);
    expect(doc.listSections(copy.id).map((entry) => entry.tags)).toEqual([[tag.id]]);
  });

  it("leaves a membership dormant when the tag record is deleted", () => {
    const { doc, board } = workspace();
    const tag = doc.createTag({ name: "Temporary" });
    doc.setBoardTags(board.id, [tag.id]);

    doc.deleteTag(tag.id);

    // The stored id survives; the UI filters by existing tag records.
    expect(doc.listTags()).toEqual([]);
    expect(doc.getBoard(board.id)?.tags).toEqual([tag.id]);
  });

  it("never widens a placement or a card's own tags", () => {
    const { doc, board } = workspace();
    const card = doc.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    const tag = doc.createTag({ name: "Board only" });
    doc.setBoardTags(board.id, [tag.id]);

    expect(doc.getCard(card.id)?.tags).toEqual([]);
    const placement = doc.getPlacement(board.id, card.id);
    expect(placement).toBeDefined();
    expect(placement && "tags" in placement).toBe(false);
  });

  it("reads a board and a section stored before tags existed as having none", () => {
    const raw = new LoroDoc();
    const fields = raw.getMap("boards").ensureMergeableMap("legacy");
    fields.set("name", "Legacy");
    fields.set("createdAt", 1);
    fields.set("updatedAt", 1);
    const section = raw.getMap("sections").ensureMergeableMap("legacy-section");
    section.set("boardId", "legacy");
    section.set("title", "Legacy region");
    section.set("x", 0);
    section.set("y", 0);
    section.set("width", 320);
    section.set("height", 240);
    section.set("z", 0);
    section.set("createdAt", 1);
    section.set("updatedAt", 1);
    raw.commit({ origin: "struct:init" });

    const doc = new WorkspaceDocument(raw);

    expect(doc.getBoard("legacy")?.tags).toEqual([]);
    expect(doc.listBoards().find((entry) => entry.id === "legacy")?.tags).toEqual([]);
    expect(doc.getSection("legacy-section")?.tags).toEqual([]);
  });
});
