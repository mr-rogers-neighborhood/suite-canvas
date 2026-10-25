import { WorkspaceDocument } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { containerLinks, portalBoard } from "./useContainerPanelModel";

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
    expect(rows[0]).toMatchObject({ direction: "in", kind: "card", title: "The note" });
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
