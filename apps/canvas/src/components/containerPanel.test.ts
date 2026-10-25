import { WorkspaceDocument } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  containerLinks,
  LOOSE_CARDS_TITLE,
  portalBoard,
  portalContents,
  portalTargetId,
  retargetOptions,
} from "./useContainerPanelModel";

/**
 * The container panel is small on purpose: a portal reads the board it opens, a
 * section reads its members, and both read the links drawn to them. These are
 * the two pure pieces behind it.
 */

function setup() {
  const workspace = new WorkspaceDocument();
  const board = workspace.createBoard({ name: "Home" });
  const opened = workspace.createBoard({ name: "Opened" });
  const section = workspace.createSection({ boardId: board.id, x: 0, y: 400, title: "Act one" });
  const portal = workspace.createPortalCard({ boardId: board.id, targetBoardId: opened.id });
  const note = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
  return { workspace, board, opened, section, portal, note };
}

describe("portalBoard", () => {
  it("resolves the board a portal opens", () => {
    const { opened, portal } = setup();
    expect(portalBoard(portal, [opened])?.name).toBe("Opened");
  });

  it("is null when the board is gone or the card is not a portal", () => {
    const { portal, note } = setup();
    expect(portalBoard(portal, [])).toBeNull();
    expect(portalBoard(note, [])).toBeNull();
    expect(portalBoard(undefined, [])).toBeNull();
  });
});

describe("containerLinks", () => {
  it("lists a section's links by the thing at the other end", () => {
    const { workspace, board, section, note } = setup();
    workspace.addEdge({
      boardId: board.id,
      source: note.id,
      target: section.id,
      targetKind: "section",
    });

    const rows = containerLinks("section", section.id, {
      edges: workspace.listEdges(),
      boards: workspace.listBoards(),
      sections: workspace.listSections(),
      displayTitle: () => "The note",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      direction: "in",
      kind: "card",
      title: "The note",
      otherId: note.id,
    });
  });

  it("reads a link drawn from the container as outgoing", () => {
    const { workspace, board, section, note } = setup();
    workspace.addEdge({
      boardId: board.id,
      source: section.id,
      sourceKind: "section",
      target: note.id,
    });

    const [row] = containerLinks("section", section.id, {
      edges: workspace.listEdges(),
      boards: workspace.listBoards(),
      sections: workspace.listSections(),
      displayTitle: () => "The note",
    });
    expect(row?.direction).toBe("out");
  });

  it("names a board and a section at the other end, not just cards", () => {
    const { workspace, board, opened, section } = setup();
    workspace.addEdge({
      boardId: board.id,
      source: section.id,
      sourceKind: "section",
      target: opened.id,
      targetKind: "board",
    });

    const [row] = containerLinks("section", section.id, {
      edges: workspace.listEdges(),
      boards: workspace.listBoards(),
      sections: workspace.listSections(),
      displayTitle: () => "",
    });
    expect(row).toMatchObject({ direction: "out", kind: "board", title: "Opened" });
  });

  it("ignores links that touch neither end", () => {
    const { workspace, board, note } = setup();
    const other = workspace.createCard({ boardId: board.id, position: { x: 400, y: 0 } });
    workspace.addEdge({ boardId: board.id, source: note.id, target: other.id });

    expect(
      containerLinks("section", "no-such-section", {
        edges: workspace.listEdges(),
        boards: workspace.listBoards(),
        sections: workspace.listSections(),
        displayTitle: () => "x",
      }),
    ).toHaveLength(0);
  });

  it("keeps a link's description, so several links to one thing stay distinct", () => {
    const { workspace, board, section, note } = setup();
    const first = workspace.addEdge({
      boardId: board.id,
      source: note.id,
      sourceConnector: note.connectors[0]?.id,
      target: section.id,
      targetKind: "section",
      targetConnector: section.connectors?.[0]?.id,
    });
    if (!first) throw new Error("expected the first link");
    workspace.setEdgeLabel(first.id, "sets up");

    const rows = containerLinks("section", section.id, {
      edges: workspace.listEdges(),
      boards: workspace.listBoards(),
      sections: workspace.listSections(),
      displayTitle: () => "The note",
    });
    expect(rows[0]?.description).toBe("sets up");
  });
});

describe("portalTargetId", () => {
  it("keeps the stored board id even after the board is deleted", () => {
    const { workspace, opened, portal } = setup();
    workspace.deleteBoard(opened.id);
    expect(portalTargetId(portal)).toBe(opened.id);
    expect(portalBoard(portal, workspace.listBoards())).toBeNull();
  });
});

describe("portalContents", () => {
  /** A board with two sections, a member under each, and one loose card. */
  function contentsSetup() {
    const workspace = new WorkspaceDocument();
    const board = workspace.createBoard({ name: "Opened" });
    const elsewhere = workspace.createBoard({ name: "Elsewhere" });
    // The lower section is created first, so paint order and reading order differ.
    const lower = workspace.createSection({ boardId: board.id, x: 0, y: 400, title: "Act two" });
    const upper = workspace.createSection({
      boardId: board.id,
      x: 0,
      y: 0,
      title: "Act one",
      color: "rose",
    });
    const lowerCard = workspace.createCard({ boardId: board.id, position: { x: 20, y: 420 } });
    const upperCard = workspace.createCard({ boardId: board.id, position: { x: 20, y: 20 } });
    const loose = workspace.createCard({ boardId: board.id, position: { x: 1200, y: 1200 } });
    const foreign = workspace.createCard({
      boardId: elsewhere.id,
      position: { x: 20, y: 20 },
    });
    const titles: Record<string, string> = {
      [lowerCard.id]: "Lower card",
      [upperCard.id]: "Upper card",
      [loose.id]: "Loose card",
      [foreign.id]: "Elsewhere card",
    };
    const read = (boardId: string | null) =>
      portalContents({
        boardId,
        sections: workspace.listSections(),
        placements: workspace.listPlacements(),
        cards: workspace.listCards(),
        displayTitle: (cardId) => titles[cardId] ?? "Untitled",
      });
    return { workspace, board, elsewhere, lower, upper, lowerCard, upperCard, loose, read };
  }

  it("groups a board's cards under its sections, in paint order, loose cards last", () => {
    const { lower, upper, lowerCard, upperCard, loose, read } = contentsSetup();
    const contents = read(lower.boardId);
    expect(contents.map((group) => group.title)).toEqual(["Act two", "Act one", LOOSE_CARDS_TITLE]);
    expect(contents[0]).toMatchObject({ sectionId: lower.id, cards: [{ id: lowerCard.id }] });
    expect(contents[1]).toMatchObject({
      sectionId: upper.id,
      color: "rose",
      cards: [{ id: upperCard.id, title: "Upper card" }],
    });
    expect(contents[2]).toEqual({
      sectionId: null,
      title: LOOSE_CARDS_TITLE,
      cards: [{ id: loose.id, title: "Loose card" }],
    });
  });

  it("leaves other boards' cards out of the grouping", () => {
    const { board, read } = contentsSetup();
    const ids = read(board.id).flatMap((group) => group.cards.map((card) => card.title));
    expect(ids).toEqual(["Lower card", "Upper card", "Loose card"]);
  });

  it("reads a board that is gone as empty instead of throwing", () => {
    const { workspace, board, read } = contentsSetup();
    workspace.deleteBoard(board.id);
    expect(read(board.id)).toEqual([]);
    expect(read(null)).toEqual([]);
  });

  it("keeps a section with no cards, so an empty act still reads", () => {
    const workspace = new WorkspaceDocument();
    const board = workspace.createBoard({ name: "Opened" });
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0, title: "Empty act" });
    const groups = portalContents({
      boardId: board.id,
      sections: workspace.listSections(),
      placements: workspace.listPlacements(),
      cards: workspace.listCards(),
      displayTitle: () => "Untitled",
    });
    expect(groups).toEqual([{ sectionId: section.id, title: "Empty act", cards: [] }]);
  });
});

describe("retargetOptions", () => {
  it("offers every board but the one that went away, by name", () => {
    const workspace = new WorkspaceDocument();
    const home = workspace.createBoard({ name: "Home" });
    const notes = workspace.createBoard({ name: "Notes" });
    const gone = workspace.createBoard({ name: "Gone" });
    workspace.deleteBoard(gone.id);

    const options = retargetOptions(workspace.listBoards(), gone.id);
    expect(options.map((option) => option.name)).toEqual(["Home", "Notes"]);
    expect(options.map((option) => option.id)).toEqual([home.id, notes.id]);
  });
});
