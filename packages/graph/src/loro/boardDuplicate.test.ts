import { LoroList, LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import type { Connector } from "../schema.js";
import { PORTAL_BOARD_FIELD_ID, PORTAL_TYPE_ID, WorkspaceDocument } from "./WorkspaceDocument.js";

/** Counts commits, because one commit is the unit undo and history care about. */
function countCommits(workspace: WorkspaceDocument): () => number {
  let commits = 0;
  workspace.doc.subscribe(() => {
    commits += 1;
  });
  return () => commits;
}

function sideConnectors(prefix: string): Connector[] {
  return [
    { id: `${prefix}-top`, x: 0.5, y: 0 },
    { id: `${prefix}-right`, x: 1, y: 0.5 },
    { id: `${prefix}-bottom`, x: 0.5, y: 1 },
    { id: `${prefix}-left`, x: 0, y: 0.5 },
  ];
}

function writeBody(workspace: WorkspaceDocument, cardId: string, text: string): void {
  const content = workspace.getContent(cardId);
  content.set("nodeName", "doc");
  const blocks = content.getOrCreateContainer("children", new LoroList());
  const paragraph = blocks.insertContainer(blocks.length, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.getOrCreateContainer("attributes", new LoroMap());
  const inline = paragraph.getOrCreateContainer("children", new LoroList());
  inline.insertContainer(0, new LoroText()).insert(0, text);
  workspace.doc.commit({ origin: "text:body" });
}

function writeTitle(workspace: WorkspaceDocument, cardId: string, text: string): void {
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

/** Types into the first text node of a card's rich-text container. */
function prependToFirstText(workspace: WorkspaceDocument, container: LoroMap, text: string): void {
  const blocks = container.get("children") as LoroList;
  const paragraph = blocks.get(0) as LoroMap;
  const inline = paragraph.get("children") as LoroList;
  const node = inline.get(0) as LoroText;
  node.insert(0, text);
  workspace.doc.commit({ origin: "text:body" });
}

function setup() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const source = workspace.createBoard({ name: "Research" });
  const other = workspace.createBoard({ name: "Elsewhere" });
  const target = workspace.createBoard({ name: "Deep dive" });

  const sources = workspace.createSection({
    boardId: source.id,
    title: "Sources",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    color: "blue",
    connectors: sideConnectors("s1"),
  });
  const notes = workspace.createSection({
    boardId: source.id,
    title: "Notes",
    x: 440,
    y: 0,
    width: 360,
    height: 260,
    connectors: sideConnectors("s2"),
  });

  const a = workspace.createCard({
    boardId: source.id,
    position: { x: 10, y: 20 },
    connectors: sideConnectors("a"),
  });
  workspace.updatePlacementGeometry(source.id, a.id, { x: 10, y: 20, width: 220, height: 140 });
  writeTitle(workspace, a.id, "Plan the week");
  writeBody(workspace, a.id, "Alpha body");
  // The same card lives on two boards; a duplicate must copy it only once.
  workspace.placeCard(other.id, a.id, { x: 500, y: 60 });

  const b = workspace.createCard({
    boardId: source.id,
    position: { x: 300, y: 200 },
    connectors: sideConnectors("b"),
  });
  const onlyElsewhere = workspace.createCard({
    boardId: other.id,
    position: { x: 0, y: 0 },
    connectors: sideConnectors("c"),
  });

  const portal = workspace.createPortalCard({
    boardId: source.id,
    targetBoardId: target.id,
    position: { x: 600, y: 40 },
  });

  const cardToCard = workspace.addEdge({
    boardId: source.id,
    source: a.id,
    target: b.id,
    sourceConnector: "a-right",
    targetConnector: "b-bottom",
  });
  const cardToSection = workspace.addEdge({
    boardId: source.id,
    source: b.id,
    target: sources.id,
    targetKind: "section",
    sourceConnector: "b-left",
    targetConnector: "s1-left",
  });
  const cardToBoard = workspace.addEdge({
    boardId: source.id,
    source: a.id,
    target: target.id,
    targetKind: "board",
  });
  // A card that is not on the source board, and a board with no portal there:
  // neither end is reproduced, so neither link may come along.
  const toElsewhereCard = workspace.addEdge({
    boardId: source.id,
    source: b.id,
    target: onlyElsewhere.id,
  });
  const toElsewhereBoard = workspace.addEdge({
    boardId: source.id,
    source: b.id,
    target: other.id,
    targetKind: "board",
  });

  return {
    workspace,
    source,
    other,
    target,
    sources,
    notes,
    a,
    b,
    onlyElsewhere,
    portal,
    cardToCard,
    cardToSection,
    cardToBoard,
    toElsewhereCard,
    toElsewhereBoard,
  };
}

type Fixture = ReturnType<typeof setup>;

/** Every field the source board owns, flattened, so one `toEqual` covers it. */
function sourceState(fixture: Fixture) {
  const { workspace, source, other, a } = fixture;
  const cards = workspace.listBoardCards(source.id);
  return structuredClone({
    board: workspace.getBoard(source.id),
    sections: workspace.listSections(source.id),
    cards,
    placements: workspace.listBoardPlacements(source.id),
    edges: workspace.listEdges().filter((edge) => edge.boardId === source.id),
    bodies: cards.map((card) => workspace.cardText(card.id)),
    titles: cards.map((card) => workspace.displayTitle(card.id)),
    otherPlacement: workspace.getPlacement(other.id, a.id),
  });
}

function duplicate(fixture: Fixture, options: { name?: string } = {}) {
  const board = fixture.workspace.duplicateBoard(fixture.source.id, options);
  if (!board) throw new Error("duplicateBoard returned null for an existing board");
  return board;
}

/** Finds the copy of a source card by the placement coordinates it keeps. */
function copyOfCard(fixture: Fixture, copyBoardId: string, cardId: string): string | undefined {
  const { workspace, source } = fixture;
  const origin = workspace.getPlacement(source.id, cardId);
  if (!origin) return undefined;
  return workspace
    .listBoardPlacements(copyBoardId)
    .find((placement) => placement.x === origin.x && placement.y === origin.y)?.cardId;
}

describe("duplicateBoard", () => {
  it("should return null for a board that does not exist", () => {
    const { workspace } = setup();
    const boards = workspace.listBoards().length;

    expect(workspace.duplicateBoard("missing")).toBeNull();
    expect(workspace.listBoards()).toHaveLength(boards);
  });

  it("should copy sections, cards, placements and links with fresh ids", () => {
    const fixture = setup();
    const { workspace, source, target, sources, notes, a, b, portal } = fixture;

    const copy = duplicate(fixture);

    expect(workspace.getBoard(copy.id)).toMatchObject({ id: copy.id, name: "Research copy" });
    expect(workspace.listBoards()).toHaveLength(4);

    const copiedSections = workspace.listSections(copy.id);
    expect(copiedSections).toHaveLength(2);
    const copiedSources = copiedSections.find((section) => section.title === "Sources");
    const copiedNotes = copiedSections.find((section) => section.title === "Notes");
    expect(copiedSources).toBeDefined();
    expect(copiedNotes).toBeDefined();
    expect(copiedSections.map((section) => section.id)).not.toContain(sources.id);
    expect(copiedSections.map((section) => section.id)).not.toContain(notes.id);
    expect(copiedSources).toMatchObject({
      boardId: copy.id,
      x: sources.x,
      y: sources.y,
      width: sources.width,
      height: sources.height,
      z: sources.z,
      color: "blue",
    });
    expect(copiedSources?.connectors?.map(({ x, y }) => ({ x, y }))).toEqual(
      workspace.getSection(sources.id)?.connectors?.map(({ x, y }) => ({ x, y })),
    );
    expect(copiedSources?.connectors?.map((connector) => connector.id)).not.toContain("s1-top");

    const copiedCards = workspace.listBoardCards(copy.id);
    expect(copiedCards).toHaveLength(3);
    expect(copiedCards.map((card) => card.id)).not.toContain(a.id);
    expect(copiedCards.map((card) => card.id)).not.toContain(b.id);
    expect(copiedCards.map((card) => card.id)).not.toContain(portal.id);

    const copyAId = copyOfCard(fixture, copy.id, a.id);
    const copyBId = copyOfCard(fixture, copy.id, b.id);
    const copyPortalId = copyOfCard(fixture, copy.id, portal.id);
    expect(copyAId).toBeDefined();
    expect(copyBId).toBeDefined();
    expect(copyPortalId).toBeDefined();
    const copiedA = copyAId ? workspace.getCard(copyAId) : undefined;
    const copiedB = copyBId ? workspace.getCard(copyBId) : undefined;
    const copiedPortal = copyPortalId ? workspace.getCard(copyPortalId) : undefined;

    // The card's own content, title, types and property values come along.
    expect(workspace.cardText(copyAId ?? "")).toBe("Alpha body");
    expect(workspace.displayTitle(copyAId ?? "")).toBe("Plan the week");
    expect(copiedA?.typeIds).toEqual(workspace.getCard(a.id)?.typeIds);
    expect(copiedPortal?.properties[PORTAL_BOARD_FIELD_ID]).toBe(target.id);
    expect(copiedPortal?.typeIds).toEqual([PORTAL_TYPE_ID]);

    // Connectors keep their anchors, with fresh ids.
    expect(copiedA?.connectors.map(({ x, y }) => ({ x, y }))).toEqual(
      workspace.getCard(a.id)?.connectors.map(({ x, y }) => ({ x, y })),
    );
    expect(copiedA?.connectors.map((connector) => connector.id)).not.toContain("a-right");

    // Placement geometry and layer rank travel, not the source coordinates.
    const sourcePlacement = workspace.getPlacement(source.id, a.id);
    expect(workspace.getPlacement(copy.id, copyAId ?? "")).toMatchObject({
      x: sourcePlacement?.x,
      y: sourcePlacement?.y,
      width: sourcePlacement?.width,
      height: sourcePlacement?.height,
      z: sourcePlacement?.z,
    });
    expect(workspace.getPlacement(source.id, copyAId ?? "")).toBeUndefined();

    // Links are remapped onto the copies, connector by connector.
    const copiedEdges = workspace.listBoardEdges(copy.id);
    expect(copiedEdges).toHaveLength(3);
    expect(copiedEdges.map((edge) => edge.id)).not.toContain(fixture.cardToCard?.id);
    expect(copiedEdges.map((edge) => edge.id)).not.toContain(fixture.cardToSection?.id);

    const copiedCardToCard = copiedEdges.find(
      (edge) => edge.source === copyAId && edge.target === copyBId,
    );
    expect(copiedCardToCard).toBeDefined();
    expect(copiedCardToCard?.sourceConnector).toBe(copiedA?.connectors[1]?.id);
    expect(copiedCardToCard?.targetConnector).toBe(copiedB?.connectors[2]?.id);
    expect(copiedCardToCard?.kind).toBe(fixture.cardToCard?.kind);

    const copiedCardToSection = copiedEdges.find(
      (edge) => edge.source === copyBId && edge.target === copiedSources?.id,
    );
    expect(copiedCardToSection).toBeDefined();
    expect(copiedCardToSection?.targetKind).toBe("section");
    expect(copiedCardToSection?.sourceConnector).toBe(copiedB?.connectors[3]?.id);
    expect(copiedCardToSection?.targetConnector).toBe(copiedSources?.connectors?.[3]?.id);

    const copiedCardToBoard = copiedEdges.find(
      (edge) => edge.source === copyAId && edge.target === target.id,
    );
    expect(copiedCardToBoard).toBeDefined();
    expect(copiedCardToBoard?.targetKind).toBe("board");

    // No copied link names anything on the source board.
    const copiedEdgeSources = copiedEdges.flatMap((edge) => [edge.source, edge.target]);
    expect(copiedEdgeSources).not.toContain(a.id);
    expect(copiedEdgeSources).not.toContain(b.id);
    expect(copiedEdgeSources).not.toContain(sources.id);
    expect(copiedEdgeSources).not.toContain(fixture.onlyElsewhere.id);
    expect(copiedEdgeSources).not.toContain(fixture.other.id);

    // The source keeps its own records, including links that could not travel.
    expect(workspace.getEdge(fixture.cardToCard?.id ?? "")).toEqual(fixture.cardToCard);
    expect(workspace.getEdge(fixture.toElsewhereCard?.id ?? "")).toEqual(fixture.toElsewhereCard);
    expect(workspace.getEdge(fixture.toElsewhereBoard?.id ?? "")).toEqual(fixture.toElsewhereBoard);
  });

  it("should keep a copied card's rich text independent of the source", () => {
    const fixture = setup();
    const { workspace, source, a } = fixture;
    const copy = duplicate(fixture);
    const copyAId = copyOfCard(fixture, copy.id, a.id);
    if (!copyAId) throw new Error("copied card missing");

    const copyContent = workspace.peekContent(copyAId);
    const copyTitle = workspace.peekTitle(copyAId);
    if (!copyContent || !copyTitle) throw new Error("copied containers missing");
    expect(copyContent.id).not.toBe(workspace.peekContent(a.id)?.id);
    expect(copyTitle.id).not.toBe(workspace.peekTitle(a.id)?.id);

    prependToFirstText(workspace, copyContent, "edited ");
    prependToFirstText(workspace, copyTitle, "edited ");

    expect(workspace.cardText(copyAId)).toContain("edited Alpha body");
    expect(workspace.cardText(a.id)).toBe("Alpha body");
    expect(workspace.displayTitle(copyAId)).toBe("edited Plan the week");
    expect(workspace.displayTitle(a.id)).toBe("Plan the week");
    expect(workspace.getPlacement(source.id, a.id)).toMatchObject({ x: 10, y: 20 });
  });

  it("should copy a card placed on several boards exactly once", () => {
    const fixture = setup();
    const { workspace, source, other, a } = fixture;

    const copy = duplicate(fixture);

    const copiedCards = workspace.listBoardCards(copy.id);
    const copiesOfA = copiedCards.filter(
      (card) => workspace.cardText(card.id) === workspace.cardText(a.id),
    );
    expect(copiesOfA).toHaveLength(1);
    expect(workspace.listCardPlacements(copiesOfA[0]?.id ?? "")).toHaveLength(1);
    expect(
      workspace
        .listCardPlacements(a.id)
        .map((entry) => entry.boardId)
        .sort(),
    ).toEqual([source.id, other.id].sort());
    expect(workspace.listBoardCards(other.id).map((card) => card.id)).toEqual(
      expect.arrayContaining([a.id]),
    );
  });

  it("should leave the source board exactly as it was", () => {
    const fixture = setup();
    const before = sourceState(fixture);

    duplicate(fixture);

    expect(sourceState(fixture)).toEqual(before);
  });

  it("should drop links whose far end is not reproduced on the source board", () => {
    const fixture = setup();
    const { workspace, source, other, onlyElsewhere, b } = fixture;

    const copy = duplicate(fixture);

    const copiedEdges = workspace.listBoardEdges(copy.id);
    expect(copiedEdges.map((edge) => edge.target)).not.toContain(onlyElsewhere.id);
    expect(copiedEdges.map((edge) => edge.target)).not.toContain(other.id);
    expect(copiedEdges.map((edge) => edge.source)).not.toContain(b.id);
    // The source still holds both links.
    expect(workspace.listEdges().map((edge) => edge.id)).toEqual(
      expect.arrayContaining([fixture.toElsewhereCard?.id, fixture.toElsewhereBoard?.id]),
    );
    expect(workspace.listBoardEdges(source.id)).toHaveLength(3);
  });

  it("should undo the whole duplicate in one step", () => {
    const fixture = setup();
    const { workspace } = fixture;
    const before = sourceState(fixture);
    const boardsBefore = workspace
      .listBoards()
      .map((board) => board.id)
      .sort();
    const cardsBefore = workspace
      .listCards()
      .map((card) => card.id)
      .sort();
    const edgesBefore = workspace
      .listEdges()
      .map((edge) => edge.id)
      .sort();

    const copy = duplicate(fixture);
    const copiedCardIds = workspace.listBoardCards(copy.id).map((card) => card.id);
    expect(copiedCardIds).toHaveLength(3);
    expect(workspace.listSections(copy.id)).toHaveLength(2);
    expect(workspace.listBoardEdges(copy.id)).toHaveLength(3);

    workspace.undo();

    expect(workspace.getBoard(copy.id)).toBeUndefined();
    expect(workspace.listSections(copy.id)).toHaveLength(0);
    expect(workspace.listBoardPlacements(copy.id)).toHaveLength(0);
    expect(workspace.listBoardEdges(copy.id)).toHaveLength(0);
    expect(
      workspace
        .listBoards()
        .map((board) => board.id)
        .sort(),
    ).toEqual(boardsBefore);
    expect(
      workspace
        .listCards()
        .map((card) => card.id)
        .sort(),
    ).toEqual(cardsBefore);
    expect(
      workspace
        .listEdges()
        .map((edge) => edge.id)
        .sort(),
    ).toEqual(edgesBefore);
    expect(copiedCardIds.some((cardId) => workspace.getCard(cardId) !== undefined)).toBe(false);
    expect(sourceState(fixture)).toEqual(before);
  });

  it("should land the duplicate in a single commit", () => {
    const fixture = setup();
    const commits = countCommits(fixture.workspace);

    duplicate(fixture);

    expect(commits()).toBe(1);
  });

  it("should name the copy after the source unless a name is given", () => {
    const fixture = setup();
    const { workspace, source } = fixture;

    expect(duplicate(fixture).name).toBe("Research copy");
    expect(duplicate(fixture, { name: "  Copy of research  " }).name).toBe("Copy of research");
    // The rename rule ignores a blank name, so the default wins.
    expect(duplicate(fixture, { name: "   " }).name).toBe("Research copy");
    expect(workspace.getBoard(source.id)?.name).toBe("Research");
  });
});
