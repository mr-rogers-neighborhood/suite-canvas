import { describe, expect, it } from "vitest";
import { edgeEndpoints } from "../links.js";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

function setup() {
  const workspace = new WorkspaceDocument();
  const board = workspace.createBoard({ name: "Home" });
  const other = workspace.createBoard({ name: "Other" });
  return { workspace, board, other };
}

describe("container link endpoints", () => {
  it("links a card to a section and reads both kinds back", () => {
    const { workspace, board } = setup();
    const card = workspace.createCard({ boardId: board.id });
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });

    const edge = workspace.addEdge({
      boardId: board.id,
      source: card.id,
      target: section.id,
      targetKind: "section",
    });
    if (!edge) throw new Error("expected an edge");

    expect(edgeEndpoints(edge).target).toEqual({ kind: "section", id: section.id });
    expect(workspace.listLinksTo("section", section.id)).toHaveLength(1);
    expect(workspace.listLinksTo("card", card.id)).toHaveLength(1);
  });

  it("links a board to a board without either being placed", () => {
    const { workspace, board, other } = setup();
    const edge = workspace.addEdge({
      boardId: board.id,
      source: board.id,
      target: other.id,
      sourceKind: "board",
      targetKind: "board",
    });
    if (!edge) throw new Error("expected an edge");
    expect(workspace.listLinksTo("board", other.id)).toHaveLength(1);
  });

  it("refuses a link between a thing and itself at the same kind", () => {
    const { workspace, board } = setup();
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });
    expect(
      workspace.addEdge({
        boardId: board.id,
        source: section.id,
        target: section.id,
        sourceKind: "section",
        targetKind: "section",
      }),
    ).toBeNull();
  });

  it("allows a card and a section that happen to share an id", () => {
    const { workspace, board } = setup();
    const card = workspace.createCard({ boardId: board.id, id: "shared" });
    const section = workspace.createSection({ boardId: board.id, id: "shared", x: 0, y: 0 });
    const edge = workspace.addEdge({
      boardId: board.id,
      source: card.id,
      target: section.id,
      targetKind: "section",
    });
    expect(edge).not.toBeNull();
  });

  it("refuses an endpoint that does not exist", () => {
    const { workspace, board } = setup();
    const card = workspace.createCard({ boardId: board.id });
    expect(
      workspace.addEdge({
        boardId: board.id,
        source: card.id,
        target: "missing-section",
        targetKind: "section",
      }),
    ).toBeNull();
  });

  it("does not record the same connection twice, in either direction", () => {
    const { workspace, board } = setup();
    const card = workspace.createCard({ boardId: board.id });
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });
    const first = workspace.addEdge({
      boardId: board.id,
      source: card.id,
      target: section.id,
      targetKind: "section",
    });
    const duplicate = workspace.addEdge({
      boardId: board.id,
      source: section.id,
      target: card.id,
      sourceKind: "section",
    });

    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();
    expect(workspace.listEdges()).toHaveLength(1);
  });

  it("keeps two links between the same pair when they use different connectors", () => {
    const { workspace, board } = setup();
    const a = workspace.createCard({ boardId: board.id });
    const b = workspace.createCard({ boardId: board.id });
    const [first, second] = a.connectors;
    if (!first || !second) throw new Error("expected connectors");

    expect(
      workspace.addEdge({
        boardId: board.id,
        source: a.id,
        target: b.id,
        sourceConnector: first.id,
      }),
    ).not.toBeNull();
    expect(
      workspace.addEdge({
        boardId: board.id,
        source: a.id,
        target: b.id,
        sourceConnector: second.id,
      }),
    ).not.toBeNull();
  });
});

describe("drawing container links", () => {
  it("draws a section endpoint on its board and hides it on another board", () => {
    const { workspace, board, other } = setup();
    const card = workspace.createCard({ boardId: board.id });
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });
    workspace.addEdge({
      boardId: board.id,
      source: card.id,
      target: section.id,
      targetKind: "section",
    });

    expect(workspace.listBoardEdges(board.id)).toHaveLength(1);
    expect(workspace.listBoardEdges(other.id)).toHaveLength(0);
  });

  it("draws a board endpoint only where a portal to it exists", () => {
    const { workspace, board, other } = setup();
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });
    workspace.addEdge({
      boardId: board.id,
      source: other.id,
      target: section.id,
      sourceKind: "board",
      targetKind: "section",
    });

    // No portal on `board` points at `other`, so there is nothing to draw from.
    expect(workspace.listBoardEdges(board.id)).toHaveLength(0);

    workspace.createPortalCard({ boardId: board.id, targetBoardId: other.id });
    expect(workspace.listBoardEdges(board.id)).toHaveLength(1);
  });

  it("keeps the link when its portal is unplaced, and draws it again on return", () => {
    const { workspace, board, other } = setup();
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });
    const portal = workspace.createPortalCard({ boardId: board.id, targetBoardId: other.id });
    const edge = workspace.addEdge({
      boardId: board.id,
      source: other.id,
      target: section.id,
      sourceKind: "board",
      targetKind: "section",
    });
    if (!edge) throw new Error("expected an edge");

    workspace.unplaceCard(board.id, portal.id);
    expect(workspace.listBoardEdges(board.id)).toHaveLength(0);
    expect(workspace.getEdge(edge.id)).toBeDefined();

    workspace.placeCard(board.id, portal.id, { x: 40, y: 40 });
    expect(workspace.listBoardEdges(board.id)).toHaveLength(1);
  });

  it("hides a section link whose connector is gone", () => {
    const { workspace, board } = setup();
    const card = workspace.createCard({ boardId: board.id });
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });
    const edge = workspace.addEdge({
      boardId: board.id,
      source: card.id,
      target: section.id,
      targetKind: "section",
      targetConnector: "missing-connector",
    });
    if (!edge) throw new Error("expected an edge");
    expect(workspace.listBoardEdges(board.id)).toHaveLength(0);
  });
});

describe("reconnecting to a container", () => {
  it("retargets an end onto a section and records the kind", () => {
    const { workspace, board } = setup();
    const a = workspace.createCard({ boardId: board.id });
    const b = workspace.createCard({ boardId: board.id });
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });
    const edge = workspace.addEdge({ boardId: board.id, source: a.id, target: b.id });
    if (!edge) throw new Error("expected an edge");

    workspace.reconnectEdge(edge.id, "target", section.id, undefined, "section");

    expect(edgeEndpoints(workspace.getEdge(edge.id) ?? edge).target).toEqual({
      kind: "section",
      id: section.id,
    });
  });

  it("refuses to make a link point back at its own other end", () => {
    const { workspace, board } = setup();
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });
    const card = workspace.createCard({ boardId: board.id });
    const edge = workspace.addEdge({
      boardId: board.id,
      source: section.id,
      target: card.id,
      sourceKind: "section",
    });
    if (!edge) throw new Error("expected an edge");

    workspace.reconnectEdge(edge.id, "target", section.id, undefined, "section");

    expect(edgeEndpoints(workspace.getEdge(edge.id) ?? edge).target.kind).toBe("card");
  });
});

describe("section connectors", () => {
  it("starts every section with four connectors", () => {
    const { workspace, board } = setup();
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });
    expect(section.connectors).toHaveLength(4);
  });

  it("adds and removes a connector", () => {
    const { workspace, board } = setup();
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });
    const added = workspace.addSectionConnector(section.id);
    if (!added) throw new Error("expected a connector");

    expect(workspace.getSection(section.id)?.connectors).toHaveLength(5);

    workspace.removeSectionConnector(section.id, added.id);
    expect(workspace.getSection(section.id)?.connectors).toHaveLength(4);
  });

  it("moves a connector, snapping to the nearest anchor on request", () => {
    const { workspace, board } = setup();
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });
    const [first] = workspace.getSection(section.id)?.connectors ?? [];
    if (!first) throw new Error("expected a connector");

    workspace.moveSectionConnector(section.id, first.id, { x: 0.92, y: 0.94 }, { snap: true });

    const moved = workspace
      .getSection(section.id)
      ?.connectors?.find((connector) => connector.id === first.id);
    expect(moved).toMatchObject({ x: 1, y: 1 });
  });

  it("removes the links anchored to a connector it deletes", () => {
    const { workspace, board } = setup();
    const card = workspace.createCard({ boardId: board.id });
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });
    const [first, second] = section.connectors ?? [];
    if (!first || !second) throw new Error("expected connectors");

    const dropped = workspace.addEdge({
      boardId: board.id,
      source: card.id,
      target: section.id,
      targetKind: "section",
      targetConnector: first.id,
    });
    const kept = workspace.addEdge({
      boardId: board.id,
      source: card.id,
      target: section.id,
      targetKind: "section",
      targetConnector: second.id,
    });

    workspace.removeSectionConnector(section.id, first.id);

    expect(workspace.getEdge(dropped?.id ?? "")).toBeUndefined();
    expect(workspace.getEdge(kept?.id ?? "")).toBeDefined();
  });
});

describe("purging links when a container goes", () => {
  it("deletes links pointing at a deleted board", () => {
    const { workspace, board, other } = setup();
    const portal = workspace.createPortalCard({ boardId: board.id, targetBoardId: other.id });
    const card = workspace.createCard({ boardId: board.id });
    const edge = workspace.addEdge({
      boardId: board.id,
      source: other.id,
      target: card.id,
      sourceKind: "board",
    });
    if (!edge) throw new Error("expected an edge");

    workspace.deleteBoard(other.id);

    expect(workspace.getEdge(edge.id)).toBeUndefined();
    expect(workspace.getBoard(other.id)).toBeUndefined();
    expect(workspace.getCard(portal.id)).toBeDefined();
  });

  it("deletes links pointing at a deleted section", () => {
    const { workspace, board } = setup();
    const card = workspace.createCard({ boardId: board.id });
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });
    const edge = workspace.addEdge({
      boardId: board.id,
      source: card.id,
      target: section.id,
      targetKind: "section",
    });
    if (!edge) throw new Error("expected an edge");

    workspace.deleteSection(section.id);

    expect(workspace.getEdge(edge.id)).toBeUndefined();
  });
});

describe("deleteBoard card handling", () => {
  it("trashes only the cards that were on that board", () => {
    const { workspace, board, other } = setup();
    const onBoard = workspace.createCard({ boardId: board.id });
    const elsewhere = workspace.createCard({ boardId: other.id });

    workspace.deleteBoard(board.id, { cards: "trash" });

    expect(typeof workspace.getCard(onBoard.id)?.deletedAt).toBe("number");
    expect(workspace.getCard(elsewhere.id)?.deletedAt ?? null).toBeNull();
  });

  it("keeps a card that still lives on another board", () => {
    const { workspace, board, other } = setup();
    const shared = workspace.createCard({ boardId: board.id });
    workspace.placeCard(other.id, shared.id, { x: 0, y: 0 });

    workspace.deleteBoard(board.id, { cards: "trash" });

    expect(workspace.getCard(shared.id)?.deletedAt ?? null).toBeNull();
    expect(workspace.listCardPlacements(shared.id)).toHaveLength(1);
  });

  it("keeps cards in place when asked to", () => {
    const { workspace, board } = setup();
    const card = workspace.createCard({ boardId: board.id });

    workspace.deleteBoard(board.id, { cards: "keep" });

    expect(workspace.getCard(card.id)?.deletedAt ?? null).toBeNull();
  });
});
