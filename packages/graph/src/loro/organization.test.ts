import { type LoroDoc, LoroList, LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

function sync(a: LoroDoc, b: LoroDoc): void {
  const fromA = a.export({ mode: "update" });
  const fromB = b.export({ mode: "update" });
  b.import(fromA);
  a.import(fromB);
}

/** A calendar-like body node, written the way `loro-prosemirror` writes one. */
function writeBody(workspace: WorkspaceDocument, cardId: string, text: string) {
  const content = workspace.getContent(cardId);
  content.set("nodeName", "doc");
  const blocks = content.getOrCreateContainer("children", new LoroList());
  const paragraph = blocks.insertContainer(blocks.length, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.getOrCreateContainer("attributes", new LoroMap()).set("textAlign", "left");
  const inline = paragraph.getOrCreateContainer("children", new LoroList());
  const node = inline.insertContainer(0, new LoroText());
  node.applyDelta([{ insert: `${text} plain ` }, { insert: "bold", attributes: { bold: true } }]);
  workspace.doc.commit({ origin: "text:body" });
}

function writeTitle(workspace: WorkspaceDocument, cardId: string, text: string) {
  const title = workspace.getTitle(cardId);
  title.set("nodeName", "doc");
  const blocks = title.getOrCreateContainer("children", new LoroList());
  const paragraph = blocks.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.getOrCreateContainer("attributes", new LoroMap());
  const inline = paragraph.getOrCreateContainer("children", new LoroList());
  inline.insertContainer(0, new LoroText()).insert(0, text);
  workspace.doc.commit({ origin: "text:title" });
}

function setup() {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureBoard();
  workspace.ensureDefaultTypes();
  const type = workspace.createType({ name: "Task" });
  const field = workspace.addField(type.id, { name: "Status", kind: "text" });
  const tag = workspace.createTag({ name: "urgent" });

  const card = workspace.createCard({
    typeId: type.id,
    boardId: board.id,
    position: { x: 100, y: 50 },
  });
  workspace.addCardTag(card.id, tag.id);
  workspace.setProperty(card.id, field.id, "open");
  writeTitle(workspace, card.id, "Plan the week");
  writeBody(workspace, card.id, "Monday");

  const other = workspace.createBoard({ name: "Ideas" });
  return { workspace, board, other, type, field, tag, card };
}

describe("duplicateCard", () => {
  it("should copy content, marks, properties, tags and types", () => {
    const { workspace, card, type, tag, field } = setup();
    const sourceContent = workspace.peekContent(card.id);
    const sourceTitle = workspace.peekTitle(card.id);

    const copy = workspace.duplicateCard(card.id);

    expect(copy.id).not.toBe(card.id);
    expect(copy.typeIds).toEqual([type.id]);
    expect(copy.primaryTypeId).toBe(type.id);
    expect(copy.tags).toEqual([tag.id]);
    expect(copy.properties).toEqual({ [field.id]: "open" });
    expect(copy.deletedAt).toBeNull();

    expect(workspace.displayTitle(copy.id)).toBe("Plan the week");
    expect(workspace.cardText(copy.id)).toBe(workspace.cardText(card.id));
    expect(workspace.cardText(copy.id)).toContain("bold");
    // Structure and marks survive: the trees are equal but not the same containers.
    expect(workspace.peekContent(copy.id)?.toJSON()).toEqual(sourceContent?.toJSON());
    expect(workspace.peekTitle(copy.id)?.toJSON()).toEqual(sourceTitle?.toJSON());
    expect(workspace.contentId(copy.id)).not.toBe(workspace.contentId(card.id));
    expect(workspace.titleId(copy.id)).not.toBe(workspace.titleId(card.id));
  });

  it("should not copy connectors or the source placement", () => {
    const { workspace, board, card } = setup();

    const copy = workspace.duplicateCard(card.id);

    expect(copy.connectors.map((connector) => connector.id)).not.toEqual(
      card.connectors.map((connector) => connector.id),
    );
    expect(workspace.listCardPlacements(copy.id)).toEqual([]);
    expect(workspace.homeBoardId(copy.id)).toBeNull();
    expect(workspace.getCard(card.id)).toBeDefined();
    expect(workspace.listCardPlacements(card.id)).toHaveLength(1);
    expect(workspace.getPlacement(board.id, card.id)?.x).toBe(100);
  });

  it("should place the copy near the source when a board is given", () => {
    const { workspace, board, card } = setup();

    const copy = workspace.duplicateCard(card.id, { boardId: board.id });

    expect(workspace.getPlacement(board.id, copy.id)).toMatchObject({ x: 124, y: 74 });
    expect(workspace.getPlacement(board.id, card.id)).toMatchObject({ x: 100, y: 50 });
    expect(workspace.listBoardCards(board.id).map((entry) => entry.id)).toEqual([card.id, copy.id]);

    const offset = workspace.duplicateCard(card.id, {
      boardId: board.id,
      offset: { x: 5, y: -5 },
    });
    expect(workspace.getPlacement(board.id, offset.id)).toMatchObject({ x: 105, y: 45 });
  });

  it("should leave the source untouched when the copy is edited", () => {
    const { workspace, card } = setup();
    const copy = workspace.duplicateCard(card.id);

    const copyBody = workspace.peekContent(copy.id)?.get("children");
    expect(copyBody).toBeDefined();
    const copyParagraph = (copyBody as LoroList).get(0) as LoroMap;
    const copyText = (copyParagraph.get("children") as LoroList).get(0) as LoroText;
    copyText.insert(0, "changed ");
    workspace.doc.commit({ origin: "text:body" });
    workspace.removeCardTag(copy.id, copy.tags[0] ?? "");
    workspace.setProperty(copy.id, Object.keys(copy.properties)[0] ?? "", null);

    expect(workspace.cardText(copy.id)).toContain("changed");
    expect(workspace.cardText(card.id)).not.toContain("changed");
    expect(workspace.getCard(card.id)?.tags).toEqual(copy.tags);
    expect(workspace.getCard(copy.id)?.properties).toEqual({});
    expect(workspace.getCard(card.id)?.properties).not.toEqual(
      workspace.getCard(copy.id)?.properties,
    );
  });

  it("should refuse to duplicate a trashed card", () => {
    const { workspace, card } = setup();
    workspace.trashCard(card.id);

    expect(() => workspace.duplicateCard(card.id)).toThrow(/trashed/);
    expect(workspace.listCards()).toHaveLength(1);
  });

  it("should refuse unknown cards and boards", () => {
    const { workspace, card } = setup();

    expect(() => workspace.duplicateCard("nope")).toThrow(/Unknown card/);
    expect(() => workspace.duplicateCard(card.id, { boardId: "nope" })).toThrow(/Unknown board/);
  });

  it("should land as one undo step", () => {
    const { workspace, board, card } = setup();

    const copy = workspace.duplicateCard(card.id, { boardId: board.id });
    workspace.undo();

    expect(workspace.getCard(copy.id)).toBeUndefined();
    expect(workspace.listCards().map((entry) => entry.id)).toEqual([card.id]);
  });
});

describe("moveCardToBoard", () => {
  it("should move the placement and keep the card's identity and content", () => {
    const { workspace, board, other, card, tag, field, type } = setup();

    const placement = workspace.moveCardToBoard(card.id, other.id);

    expect(placement.boardId).toBe(other.id);
    expect(workspace.getPlacement(board.id, card.id)).toBeUndefined();
    expect(workspace.getPlacement(other.id, card.id)).toMatchObject({ x: 100, y: 50 });
    expect(workspace.listBoardCards(board.id)).toEqual([]);
    expect(workspace.listBoardCards(other.id).map((entry) => entry.id)).toEqual([card.id]);

    const moved = workspace.getCard(card.id);
    expect(moved?.id).toBe(card.id);
    expect(moved?.typeIds).toEqual([type.id]);
    expect(moved?.tags).toEqual([tag.id]);
    expect(moved?.properties).toEqual({ [field.id]: "open" });
    expect(workspace.displayTitle(card.id)).toBe("Plan the week");
    expect(workspace.cardText(card.id)).toContain("Monday");
  });

  it("should accept an explicit position", () => {
    const { workspace, board, other, card } = setup();

    workspace.moveCardToBoard(card.id, other.id, { x: 10, y: 20 });

    expect(workspace.getPlacement(other.id, card.id)).toMatchObject({ x: 10, y: 20 });
    expect(workspace.getPlacement(board.id, card.id)).toBeUndefined();
  });

  it("should keep the target board's placement when the card is already there", () => {
    const { workspace, board, other, card } = setup();
    workspace.placeCard(other.id, card.id, { x: 500, y: 500 });

    workspace.moveCardToBoard(card.id, other.id);

    expect(workspace.listCardPlacements(card.id).map((entry) => entry.boardId)).toEqual([other.id]);
    expect(workspace.getPlacement(other.id, card.id)).toMatchObject({ x: 500, y: 500 });
    expect(workspace.getPlacement(board.id, card.id)).toBeUndefined();
  });

  it("should refuse an unknown board and an unknown card", () => {
    const { workspace, card } = setup();

    expect(() => workspace.moveCardToBoard(card.id, "nope")).toThrow(/Unknown board/);
    expect(() => workspace.moveCardToBoard("nope", "board-1")).toThrow(/Unknown card/);
    expect(workspace.getPlacement("board-1", card.id)).toBeDefined();
  });

  it("should leave an edge dormant when its other endpoint stays behind", () => {
    const { workspace, board, other, card } = setup();
    const second = workspace.createCard({ boardId: board.id, position: { x: 300, y: 50 } });
    const edge = workspace.addEdge({ boardId: board.id, source: card.id, target: second.id });
    expect(edge).not.toBeNull();
    expect(workspace.listBoardEdges(board.id)).toHaveLength(1);

    workspace.moveCardToBoard(card.id, other.id);

    // Dormant, not deleted: the workspace still holds the link.
    expect(workspace.listBoardEdges(board.id)).toEqual([]);
    expect(workspace.listEdges().map((entry) => entry.id)).toEqual([edge?.id]);
    expect(workspace.listBoardCards(other.id).map((entry) => entry.id)).toEqual([card.id]);

    workspace.moveCardToBoard(card.id, board.id);

    expect(workspace.listBoardEdges(board.id).map((entry) => entry.id)).toEqual([edge?.id]);
    expect(workspace.listEdges()).toHaveLength(1);
  });

  it("should converge across peers", () => {
    const { workspace, board, other, card } = setup();
    const peer = new WorkspaceDocument();

    workspace.moveCardToBoard(card.id, other.id, { x: 42, y: 42 });
    sync(workspace.doc, peer.doc);

    expect(peer.getPlacement(other.id, card.id)).toMatchObject({ x: 42, y: 42 });
    expect(peer.getPlacement(board.id, card.id)).toBeUndefined();
    expect(peer.displayTitle(card.id)).toBe("Plan the week");
  });
});
