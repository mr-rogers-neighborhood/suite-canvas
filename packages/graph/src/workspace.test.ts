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

    const order = () => workspace.listBoardCards(board.id).map((card) => card.id);
    const rankOfB = workspace.getPlacement(board.id, b.id)?.z;

    workspace.moveLayer(board.id, a.id, "front");
    expect(order()).toEqual([b.id, a.id]);
    // Only the moved placement gets a new rank; the stack is not renumbered.
    expect(workspace.getPlacement(board.id, b.id)?.z).toBe(rankOfB);
    expect(workspace.getPlacement(board.id, a.id)?.z).toBeGreaterThan(rankOfB ?? 0);
    expect(
      workspace.getPlacement(other.id, workspace.listBoardCards(other.id)[0]?.id ?? "")?.z,
    ).toBe(0);
  });

  it("orders forward, backward, front and back against the neighbours", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.createBoard();
    const cards = ["a", "b", "c"].map((id) => workspace.createCard({ id, boardId: board.id }));
    const order = () => workspace.listBoardCards(board.id).map((card) => card.id);
    const middle = cards[1]?.id ?? "";

    workspace.moveLayer(board.id, middle, "forward");
    expect(order()).toEqual(["a", "c", "b"]);
    workspace.moveLayer(board.id, middle, "backward");
    expect(order()).toEqual(["a", "b", "c"]);
    workspace.moveLayer(board.id, middle, "back");
    expect(order()).toEqual(["b", "a", "c"]);
    workspace.moveLayer(board.id, middle, "front");
    expect(order()).toEqual(["a", "c", "b"]);
    // Already at the boundary: the rank does not move.
    const rank = workspace.getPlacement(board.id, middle)?.z;
    workspace.moveLayer(board.id, middle, "front");
    expect(workspace.getPlacement(board.id, middle)?.z).toBe(rank);
    expect(order()).toEqual(["a", "c", "b"]);
  });

  it("renumbers only when ranks run out of float precision", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.createBoard();
    const cards = ["a", "b", "c"].map((id) => workspace.createCard({ id, boardId: board.id }));
    const order = () => workspace.listBoardCards(board.id).map((card) => card.id);
    const [first, middle, last] = cards.map((card) => card.id) as [string, string, string];

    // Squeeze "b" between "a" and "c" until the gap is below the precision floor.
    for (let attempt = 0; attempt < 80; attempt += 1) {
      workspace.moveLayer(board.id, middle, "forward");
      workspace.moveLayer(board.id, middle, "backward");
    }
    expect(order()).toEqual([first, middle, last]);

    workspace.moveLayer(board.id, middle, "back");
    expect(order()).toEqual([middle, first, last]);
    const ranks = workspace.listBoardPlacements(board.id).map((placement) => placement.z);
    expect(new Set(ranks).size).toBe(3);
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

  it("removes the links anchored to a connector it deletes", () => {
    const workspace = new WorkspaceDocument();
    const source = workspace.createCard({ boardId: DEFAULT_BOARD_ID });
    const target = workspace.createCard({ boardId: DEFAULT_BOARD_ID });
    const [anchored, other] = source.connectors;
    const [destination] = target.connectors;
    if (!anchored || !other || !destination) throw new Error("expected connectors");

    const dropped = workspace.addEdge({
      boardId: DEFAULT_BOARD_ID,
      source: source.id,
      target: target.id,
      sourceConnector: anchored.id,
      targetConnector: destination.id,
    });
    const kept = workspace.addEdge({
      boardId: DEFAULT_BOARD_ID,
      source: source.id,
      target: target.id,
      sourceConnector: other.id,
      targetConnector: destination.id,
    });

    workspace.removeConnector(source.id, anchored.id);

    expect(workspace.getEdge(dropped?.id ?? "")).toBeUndefined();
    expect(workspace.getEdge(kept?.id ?? "")).toBeDefined();
  });

  it("hides links whose connector no longer exists", () => {
    const workspace = new WorkspaceDocument();
    const source = workspace.createCard({ boardId: DEFAULT_BOARD_ID });
    const target = workspace.createCard({ boardId: DEFAULT_BOARD_ID });
    const edge = workspace.addEdge({
      boardId: DEFAULT_BOARD_ID,
      source: source.id,
      target: target.id,
      sourceConnector: "missing-connector",
    });
    if (!edge) throw new Error("expected an edge");

    expect(workspace.listEdges()).toHaveLength(1);
    expect(workspace.listBoardEdges(DEFAULT_BOARD_ID)).toEqual([]);
  });

  it("reports stable connector ids and allows removing all of them", () => {
    const workspace = new WorkspaceDocument();
    const card = workspace.createCard();
    const firstRead = workspace.getCard(card.id)?.connectors.map((connector) => connector.id);
    const secondRead = workspace.getCard(card.id)?.connectors.map((connector) => connector.id);
    expect(secondRead).toEqual(firstRead);

    for (const connector of card.connectors) {
      workspace.removeConnector(card.id, connector.id);
    }
    expect(workspace.getCard(card.id)?.connectors).toEqual([]);
    expect(workspace.getCard(card.id)?.connectors).toEqual([]);
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

  it("keeps links resolvable when plain records become field maps", () => {
    const doc = new Y.Doc();
    const connectors = [
      { id: "c-source", x: 1, y: 0.5 },
      { id: "c-target", x: 0, y: 0.5 },
    ];
    doc.getMap("boards").set(DEFAULT_BOARD_ID, {
      id: DEFAULT_BOARD_ID,
      name: "Board 1",
      createdAt: 1000,
      updatedAt: 1000,
    });
    doc.getMap("cards").set("a", { ...createCard("a"), connectors });
    doc.getMap("cards").set("b", { ...createCard("b"), connectors });
    doc.getMap("placements").set("board-1/a", {
      boardId: DEFAULT_BOARD_ID,
      cardId: "a",
      x: 0,
      y: 0,
      z: 0,
      createdAt: 1000,
    });
    doc.getMap("placements").set("board-1/b", {
      boardId: DEFAULT_BOARD_ID,
      cardId: "b",
      x: 320,
      y: 0,
      z: 1,
      createdAt: 2000,
    });
    doc.getMap("edges").set("edge-1", {
      ...createEdge("edge-1", DEFAULT_BOARD_ID),
      sourceConnector: connectors[0]?.id,
      targetConnector: connectors[1]?.id,
    });
    doc.getMap("meta").set("schemaVersion", 1);

    const workspace = new WorkspaceDocument(doc);

    expect(doc.getMap("meta").get("schemaVersion")).toBe(2);
    expect(workspace.getCard("a")?.connectors.map((connector) => connector.id)).toEqual([
      "c-source",
      "c-target",
    ]);
    expect(workspace.listBoardEdges(DEFAULT_BOARD_ID).map((edge) => edge.id)).toEqual(["edge-1"]);
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

describe("WorkspaceDocument concurrency", () => {
  /** Applies both directions so each client converges on the merged state. */
  function sync(a: Y.Doc, b: Y.Doc) {
    const fromA = Y.encodeStateAsUpdate(a);
    const fromB = Y.encodeStateAsUpdate(b);
    Y.applyUpdate(b, fromA, "sync");
    Y.applyUpdate(a, fromB, "sync");
  }

  function pair() {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = new WorkspaceDocument(docA);
    const b = new WorkspaceDocument(docB);
    const board = a.createBoard({ id: "board-1" });
    const card = a.createCard({ id: "card-1", boardId: board.id });
    sync(docA, docB);
    return { docA, docB, a, b, card };
  }

  it("keeps a connector move landed while the peer adds another connector", () => {
    const { docA, docB, a, b, card } = pair();
    const moved = card.connectors[0];
    if (!moved) throw new Error("expected a connector");

    a.moveConnector(card.id, moved.id, { x: 0.12, y: 0.34 });
    const added = b.addConnector(card.id);
    sync(docA, docB);

    expect(added).not.toBeNull();
    for (const workspace of [a, b]) {
      const connectors = workspace.getCard(card.id)?.connectors ?? [];
      expect(connectors).toHaveLength(5);
      expect(connectors.find((connector) => connector.id === moved.id)).toMatchObject({
        x: 0.12,
        y: 0.34,
      });
      expect(connectors.some((connector) => connector.id === added?.id)).toBe(true);
    }
  });

  it("keeps two connector moves that touch different connectors", () => {
    const { docA, docB, a, b, card } = pair();
    const [first, second] = card.connectors;
    if (!first || !second) throw new Error("expected connectors");

    a.moveConnector(card.id, first.id, { x: 0.2, y: 0.25 });
    b.moveConnector(card.id, second.id, { x: 0.75, y: 0.8 });
    sync(docA, docB);

    for (const workspace of [a, b]) {
      const connectors = workspace.getCard(card.id)?.connectors ?? [];
      expect(connectors.find((connector) => connector.id === first.id)).toMatchObject({
        x: 0.2,
        y: 0.25,
      });
      expect(connectors.find((connector) => connector.id === second.id)).toMatchObject({
        x: 0.75,
        y: 0.8,
      });
    }
  });

  it("keeps a resize landed while the peer drags the same card", () => {
    const { docA, docB, a, b, card } = pair();

    a.updatePlacementSize("board-1", card.id, { width: 420, height: 260 });
    b.updatePlacementPosition("board-1", card.id, { x: 96, y: -48 });
    sync(docA, docB);

    for (const workspace of [a, b]) {
      expect(workspace.getPlacement("board-1", card.id)).toMatchObject({
        x: 96,
        y: -48,
        width: 420,
        height: 260,
      });
    }
  });

  it("keeps a link reversal landed while the peer changes its path", () => {
    const { docA, docB, a, b, card } = pair();
    const other = a.createCard({ id: "card-2", boardId: "board-1" });
    const edge = a.addEdge({
      boardId: "board-1",
      source: card.id,
      target: other.id,
    });
    if (!edge) throw new Error("expected an edge");
    sync(docA, docB);

    a.setEdgeBidirectional(edge.id, true);
    b.setEdgePath(edge.id, "smoothstep");
    sync(docA, docB);

    for (const workspace of [a, b]) {
      expect(workspace.getEdge(edge.id)).toMatchObject({
        bidirectional: true,
        path: "smoothstep",
      });
    }
  });

  it("keeps a reorder landed while the peer reorders another card", () => {
    const { docA, docB, a, b } = pair();
    const cards = ["c1", "c2", "c3", "c4"].map((id) => a.createCard({ id, boardId: "board-1" }).id);
    sync(docA, docB);
    const [first, second, third, fourth] = cards as [string, string, string, string];

    a.moveLayer("board-1", first, "forward");
    b.moveLayer("board-1", fourth, "backward");
    sync(docA, docB);

    for (const workspace of [a, b]) {
      const order = workspace.listBoardCards("board-1").map((card) => card.id);
      expect(order.indexOf(first)).toBeGreaterThan(order.indexOf(second));
      expect(order.indexOf(fourth)).toBeLessThan(order.indexOf(third));
    }
  });

  it("keeps two cards' moves independent", () => {
    const { docA, docB, a, b, card } = pair();
    const other = a.createCard({ id: "card-2", boardId: "board-1" });
    sync(docA, docB);

    a.updatePlacementPosition("board-1", card.id, { x: -120, y: 12 });
    b.updatePlacementPosition("board-1", other.id, { x: 240, y: 88 });
    sync(docA, docB);

    for (const workspace of [a, b]) {
      expect(workspace.getPlacement("board-1", card.id)).toMatchObject({ x: -120, y: 12 });
      expect(workspace.getPlacement("board-1", other.id)).toMatchObject({ x: 240, y: 88 });
    }
  });
});
