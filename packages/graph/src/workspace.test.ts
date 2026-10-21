import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { cardSchema, graphEdgeSchema } from "./schema.js";
import {
  DEFAULT_BOARD_ID,
  migrateLegacyDocument,
  WorkspaceDocument,
} from "./yjs/WorkspaceDocument.js";

const now = Date.now();

function createCard(cardId: string, kind = "note") {
  const card = {
    id: cardId,
    kind,
    createdAt: now,
    updatedAt: now,
    connectors: [],
    data: {},
  };
  if (kind === "note") return cardSchema.parse(card);
  throw new Error(`unknown kind ${kind}`);
}

function createEdge(edgeId: string, boardId: string) {
  return graphEdgeSchema.parse({
    id: edgeId,
    boardId,
    source: "a",
    target: "b",
    kind: "references",
    path: "bezier",
    bidirectional: false,
    createdAt: now,
    updatedAt: now,
  });
}

describe("safeParse", () => {
  it("parses a note card via cardSchema", () => {
    expect(() => createCard("a")).not.toThrow();
  });

  it("rejects unknown kinds", () => {
    expect(() => createCard("a", "sketch")).toThrow();
  });

  it("requires a board on persisted edges", () => {
    expect(() =>
      graphEdgeSchema.parse({ ...createEdge("e1", "board-1"), boardId: undefined }),
    ).toThrow();
  });
});

describe("WorkspaceDocument boards", () => {
  it("creates a default board when the workspace is empty", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.ensureBoard();
    expect(board.id).toBe(DEFAULT_BOARD_ID);
    expect(workspace.listBoards()).toHaveLength(1);
    expect(workspace.ensureBoard().id).toBe(DEFAULT_BOARD_ID);
  });

  it("renames boards but ignores blank names", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.createBoard({ name: "Research" });
    workspace.renameBoard(board.id, "Research 2026");
    expect(workspace.getBoard(board.id)?.name).toBe("Research 2026");
    workspace.renameBoard(board.id, "   ");
    expect(workspace.getBoard(board.id)?.name).toBe("Research 2026");
  });

  it("deletes a board's placements and edges but keeps its cards", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.createBoard();
    const card = workspace.createCard({ boardId: board.id });
    workspace.addEdge({ boardId: board.id, source: card.id, target: card.id });

    workspace.deleteBoard(board.id);

    expect(workspace.getBoard(board.id)).toBeUndefined();
    expect(workspace.getCard(card.id)).toBeDefined();
    expect(workspace.listCardPlacements(card.id)).toHaveLength(0);
    expect(workspace.listEdges()).toHaveLength(0);
  });

  it("trashes only the cards left without a board when asked", () => {
    const workspace = new WorkspaceDocument();
    const shared = workspace.createBoard({ name: "Shared" });
    const doomed = workspace.createBoard({ name: "Doomed" });
    const survivor = workspace.createCard({ boardId: shared.id });
    const orphan = workspace.createCard({ boardId: shared.id });
    workspace.placeCard(doomed.id, survivor.id, { x: 10, y: 10 });
    workspace.placeCard(doomed.id, orphan.id, { x: 40, y: 40 });
    workspace.unplaceCard(shared.id, orphan.id);

    workspace.deleteBoard(doomed.id, { cards: "trash" });

    expect(workspace.isTrashed(orphan.id)).toBe(true);
    expect(workspace.isTrashed(survivor.id)).toBe(false);
    expect(workspace.listCardPlacements(survivor.id)).toHaveLength(1);
  });
});

describe("WorkspaceDocument cards and placements", () => {
  it("creates cards in the inbox by default", () => {
    const workspace = new WorkspaceDocument();
    const card = workspace.createCard();
    expect(workspace.listInboxCards().map((entry) => entry.id)).toEqual([card.id]);
    expect(workspace.homeBoardId(card.id)).toBeNull();
  });

  it("creates a card directly on a board", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.createBoard();
    const card = workspace.createCard({ boardId: board.id, position: { x: 12, y: 8 } });
    const placement = workspace.getPlacement(board.id, card.id);
    expect(placement).toMatchObject({ x: 12, y: 8 });
    expect(workspace.listInboxCards()).toHaveLength(0);
  });

  it("allows one placement per card and board", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.createBoard();
    const card = workspace.createCard({ boardId: board.id });

    workspace.placeCard(board.id, card.id, { x: 100, y: 100 });

    expect(workspace.listCardPlacements(card.id)).toHaveLength(1);
    expect(workspace.getPlacement(board.id, card.id)?.x).toBe(100);
  });

  it("shares one card across boards and derives home from the oldest placement", () => {
    const workspace = new WorkspaceDocument();
    const first = workspace.createBoard({ name: "First" });
    const second = workspace.createBoard({ name: "Second" });
    const card = workspace.createCard({ boardId: first.id });
    workspace.placeCard(second.id, card.id, { x: 50, y: 50 });

    expect(workspace.listCardPlacements(card.id)).toHaveLength(2);
    expect(workspace.homeBoardId(card.id)).toBe(first.id);

    workspace.unplaceCard(first.id, card.id);
    expect(workspace.homeBoardId(card.id)).toBe(second.id);
  });

  it("keeps layer order per board", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.createBoard();
    const other = workspace.createBoard();
    const a = workspace.createCard({ boardId: board.id });
    const b = workspace.createCard({ boardId: board.id });
    workspace.createCard({ boardId: other.id });

    expect(workspace.getPlacement(board.id, a.id)?.z).toBe(0);
    expect(workspace.getPlacement(board.id, b.id)?.z).toBe(1);

    workspace.moveLayer(board.id, a.id, "front");
    expect(workspace.getPlacement(board.id, a.id)?.z).toBe(1);
    expect(workspace.getPlacement(board.id, b.id)?.z).toBe(0);
    expect(
      workspace.getPlacement(other.id, workspace.listBoardCards(other.id)[0]?.id ?? "")?.z,
    ).toBe(0);
  });

  it("falls back to the body's first line and then Untitled", () => {
    const workspace = new WorkspaceDocument();
    const card = workspace.createCard();
    expect(workspace.displayTitle(card.id)).toBe("Untitled");

    const body = workspace.getContent(card.id);
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("  Hello world\nsecond line")]);
    body.insert(0, [paragraph]);

    expect(workspace.displayTitle(card.id)).toBe("Hello world");

    const title = workspace.getTitle(card.id);
    const titleParagraph = new Y.XmlElement("paragraph");
    titleParagraph.insert(0, [new Y.XmlText("Typed title")]);
    title.insert(0, [titleParagraph]);

    expect(workspace.displayTitle(card.id)).toBe("Typed title");
  });
});

describe("WorkspaceDocument fragments and sizes", () => {
  it("never creates shared fragments on read", () => {
    const workspace = new WorkspaceDocument();
    const card = workspace.createCard();

    // Reading a card whose text has not arrived must not publish a competing
    // fragment: that would win the CRDT race and orphan the real content.
    const other = workspace.createCard();
    workspace.purgeCard(other.id);

    expect(() => workspace.peekContent("missing")).not.toThrow();
    expect(workspace.peekContent("missing")).toBe(workspace.peekContent("missing"));
    expect(workspace.peekContent(card.id)).toBe(workspace.getContent(card.id));
  });

  it("records a resized card per placement", () => {
    const workspace = new WorkspaceDocument();
    const first = workspace.createBoard({ name: "First" });
    const second = workspace.createBoard({ name: "Second" });
    const card = workspace.createCard({ boardId: first.id });
    workspace.placeCard(second.id, card.id, { x: 0, y: 0 });

    workspace.updatePlacementSize(first.id, card.id, { width: 320, height: 200 });

    expect(workspace.getPlacement(first.id, card.id)).toMatchObject({ width: 320, height: 200 });
    // Size is a property of the placement, not the card.
    expect(workspace.getPlacement(second.id, card.id)?.width).toBeUndefined();
  });
});

describe("WorkspaceDocument trash", () => {
  it("hides trashed cards from boards but keeps their placements", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.createBoard();
    const card = workspace.createCard({ boardId: board.id });

    workspace.trashCard(card.id);

    expect(workspace.listBoardCards(board.id)).toHaveLength(0);
    expect(workspace.listTrashedCards().map((entry) => entry.id)).toEqual([card.id]);
    expect(workspace.listCardPlacements(card.id)).toHaveLength(1);

    workspace.restoreCard(card.id);
    expect(workspace.listBoardCards(board.id).map((entry) => entry.id)).toEqual([card.id]);
  });

  it("purges a card, its placements, content, title and edges", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.createBoard();
    const card = workspace.createCard({ boardId: board.id });
    const other = workspace.createCard({ boardId: board.id });
    workspace.addEdge({ boardId: board.id, source: card.id, target: other.id });
    workspace.getTitle(card.id);

    workspace.trashCard(card.id);
    workspace.purgeCard(card.id);

    expect(workspace.getCard(card.id)).toBeUndefined();
    expect(workspace.listCardPlacements(card.id)).toHaveLength(0);
    expect(workspace.listEdges()).toHaveLength(0);
    expect(workspace.listTrashedCards()).toHaveLength(0);
  });

  it("empties the trash", () => {
    const workspace = new WorkspaceDocument();
    const a = workspace.createCard();
    const b = workspace.createCard();
    workspace.trashCard(a.id);
    workspace.trashCard(b.id);

    workspace.emptyTrash();

    expect(workspace.listCards()).toHaveLength(0);
  });
});

describe("WorkspaceDocument edges", () => {
  it("only draws edges whose endpoints are placed on the board", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.createBoard();
    const other = workspace.createBoard();
    const a = workspace.createCard({ boardId: board.id });
    const b = workspace.createCard({ boardId: board.id });
    const edge = workspace.addEdge({ boardId: board.id, source: a.id, target: b.id });
    if (!edge) throw new Error("expected edge");

    expect(workspace.listBoardEdges(board.id)).toHaveLength(1);
    expect(workspace.listBoardEdges(other.id)).toHaveLength(0);

    // Dormant, not deleted: the link survives a detour through the inbox.
    workspace.unplaceCard(board.id, b.id);
    expect(workspace.listBoardEdges(board.id)).toHaveLength(0);
    expect(workspace.getEdge(edge.id)).toBeDefined();

    workspace.placeCard(board.id, b.id, { x: 0, y: 0 });
    expect(workspace.listBoardEdges(board.id)).toHaveLength(1);
  });

  it("hides edges that touch a trashed card", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.createBoard();
    const a = workspace.createCard({ boardId: board.id });
    const b = workspace.createCard({ boardId: board.id });
    workspace.addEdge({ boardId: board.id, source: a.id, target: b.id });

    workspace.trashCard(b.id);

    expect(workspace.listBoardEdges(board.id)).toHaveLength(0);
    workspace.restoreCard(b.id);
    expect(workspace.listBoardEdges(board.id)).toHaveLength(1);
  });

  it("refuses self links and supports reconnection and reversal", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.createBoard();
    const a = workspace.createCard({ boardId: board.id });
    const b = workspace.createCard({ boardId: board.id });
    const c = workspace.createCard({ boardId: board.id });

    expect(workspace.addEdge({ boardId: board.id, source: a.id, target: a.id })).toBeNull();

    const edge = workspace.addEdge({ boardId: board.id, source: a.id, target: b.id });
    if (!edge) throw new Error("expected edge");

    workspace.reconnectEdge(edge.id, "target", c.id, undefined);
    expect(workspace.getEdge(edge.id)?.target).toBe(c.id);

    workspace.reverseEdge(edge.id);
    expect(workspace.getEdge(edge.id)).toMatchObject({ source: c.id, target: a.id });
  });
});

describe("WorkspaceDocument connectors", () => {
  it("starts a card with four connectors and can move them", () => {
    const workspace = new WorkspaceDocument();
    const card = workspace.createCard();
    expect(workspace.getCard(card.id)?.connectors).toHaveLength(4);

    const connector = workspace.getCard(card.id)?.connectors[1];
    if (!connector) throw new Error("expected connector");

    workspace.moveConnector(card.id, connector.id, { x: 0.42, y: 0.3 });
    expect(workspace.getCard(card.id)?.connectors[1]).toMatchObject({ x: 0.42, y: 0.3 });

    workspace.moveConnector(card.id, connector.id, { x: 0.42, y: 0.3 }, { snap: true });
    expect(workspace.getCard(card.id)?.connectors[1]).toMatchObject({ x: 0.5, y: 0 });
  });
});

describe("migration", () => {
  function legacyDoc() {
    const doc = new Y.Doc();
    const nodes = doc.getMap("nodes");
    nodes.set("starter-1", {
      id: "starter-1",
      kind: "note",
      position: { x: 0, y: 0 },
      z: 0,
      createdAt: 1000,
      updatedAt: 1000,
      connectors: [],
      data: {},
    });
    nodes.set("starter-2", {
      id: "starter-2",
      kind: "note",
      position: { x: 320, y: 0 },
      z: 1,
      createdAt: 2000,
      updatedAt: 2000,
      connectors: [],
      data: {},
    });
    doc.getMap("edges").set("edge-1", {
      id: "edge-1",
      source: "starter-1",
      target: "starter-2",
      kind: "references",
      createdAt: 3000,
      updatedAt: 3000,
    });
    return doc;
  }

  it("converts nodes into cards and placements on one board", () => {
    const doc = legacyDoc();
    const workspace = new WorkspaceDocument(doc);

    const boards = workspace.listBoards();
    expect(boards).toHaveLength(1);
    expect(boards[0]?.id).toBe(DEFAULT_BOARD_ID);

    const cards = workspace.listBoardCards(DEFAULT_BOARD_ID);
    expect(cards.map((card) => card.id)).toEqual(["starter-1", "starter-2"]);
    expect(cards[0]?.connectors).toHaveLength(4);

    expect(workspace.getPlacement(DEFAULT_BOARD_ID, "starter-2")).toMatchObject({ x: 320, y: 0 });
    expect(workspace.listBoardEdges(DEFAULT_BOARD_ID).map((edge) => edge.id)).toEqual(["edge-1"]);
    expect(workspace.getEdge("edge-1")?.boardId).toBe(DEFAULT_BOARD_ID);
  });

  it("does not stamp the version when there is nothing to migrate", () => {
    const doc = new Y.Doc();
    const workspace = new WorkspaceDocument(doc);
    expect(doc.getMap("meta").get("schemaVersion")).toBeUndefined();

    // Data arrives later (this client simply had not hydrated yet) and migrates.
    doc.getMap("nodes").set("late", {
      id: "late",
      kind: "note",
      position: { x: 5, y: 6 },
      createdAt: 1,
      updatedAt: 1,
      connectors: [],
      data: {},
    });
    workspace.migrateLegacy();

    expect(workspace.listCards().map((card) => card.id)).toEqual(["late"]);
    expect(workspace.getPlacement(DEFAULT_BOARD_ID, "late")).toMatchObject({ x: 5, y: 6 });
  });

  it("is idempotent when run twice", () => {
    const doc = legacyDoc();
    new WorkspaceDocument(doc);
    const workspace = new WorkspaceDocument(doc);
    migrateLegacyDocument(doc);

    expect(workspace.listBoards()).toHaveLength(1);
    expect(workspace.listCards()).toHaveLength(2);
    expect(workspace.listPlacements()).toHaveLength(2);
    expect(workspace.listEdges()).toHaveLength(1);
  });
});

describe("WorkspaceDocument.observe", () => {
  it("reports the section that changed", () => {
    const workspace = new WorkspaceDocument();
    const changes: string[] = [];
    const stop = workspace.observe((change) => {
      changes.push(`${change.section}:${change.action}:${change.key}`);
    });

    const board = workspace.createBoard({ id: "b1" });
    const card = workspace.createCard({ id: "c1", boardId: board.id });
    workspace.trashCard(card.id);
    stop();
    workspace.createCard();

    expect(changes).toEqual([
      "boards:add:b1",
      "cards:add:c1",
      "placements:add:b1/c1",
      "cards:update:c1",
    ]);
  });
});
