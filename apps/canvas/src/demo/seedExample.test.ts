import {
  type Card,
  PORTAL_BOARD_FIELD_ID,
  PORTAL_TYPE_ID,
  type PropertyValue,
  sectionMembership,
  WorkspaceDocument,
} from "@suite/graph";
import { describe, expect, it } from "vitest";
import { DEMO_SEED_VERSION, seedExampleWorkspace, seedModeFor } from "./seedExample";

const WHITEBOARD_CARD = "demo-card-atlas-whiteboard";
const CANVAS_CARD = "demo-card-atlas-canvas";

function seeded(): {
  workspace: WorkspaceDocument;
  summary: ReturnType<typeof seedExampleWorkspace>;
} {
  const workspace = new WorkspaceDocument();
  return { workspace, summary: seedExampleWorkspace(workspace) };
}

function portalTarget(card: Card | undefined): string | undefined {
  const value = card?.properties[PORTAL_BOARD_FIELD_ID];
  return typeof value === "string" ? value : undefined;
}

/**
 * Property ids are minted by the document, so the demo is compared by field
 * name and, for a select, by the option's label rather than its id.
 */
function propertyFingerprint(
  workspace: WorkspaceDocument,
  card: Card,
): Record<string, PropertyValue> {
  const fields = new Map(
    (workspace.getType(card.primaryTypeId)?.fields ?? []).map((field) => [field.id, field]),
  );
  const values: [string, PropertyValue][] = [];
  for (const [fieldId, value] of Object.entries(card.properties)) {
    const field = fields.get(fieldId);
    if (!field) {
      values.push([fieldId, value]);
      continue;
    }
    const option =
      field.kind === "select" ? field.options.find((entry) => entry.id === value) : undefined;
    values.push([field.name, option ? option.label : value]);
  }
  values.sort(([first], [second]) => first.localeCompare(second));
  return Object.fromEntries(values);
}

/** Everything the seed decides, in a comparable order. */
function fingerprint(workspace: WorkspaceDocument) {
  const boards = workspace
    .listBoards()
    .map((board) => ({ id: board.id, name: board.name }))
    .sort((first, second) => first.id.localeCompare(second.id));

  const cards = workspace
    .listCards()
    .map((card) => ({
      id: card.id,
      title: workspace.displayTitle(card.id),
      body: workspace.cardText(card.id),
      type: card.primaryTypeId,
      tagCount: card.tags.length,
      properties: propertyFingerprint(workspace, card),
    }))
    .sort((first, second) => first.id.localeCompare(second.id));

  const placements = workspace
    .listPlacements()
    .map((placement) => ({
      key: `${placement.boardId}/${placement.cardId}`,
      x: placement.x,
      y: placement.y,
      width: placement.width ?? 0,
      height: placement.height ?? 0,
    }))
    .sort((first, second) => first.key.localeCompare(second.key));

  const sections = workspace
    .listSections()
    .map((section) => ({
      id: section.id,
      boardId: section.boardId,
      title: section.title,
      x: section.x,
      y: section.y,
      width: section.width,
      height: section.height,
    }))
    .sort((first, second) => first.id.localeCompare(second.id));

  const edges = workspace
    .listEdges()
    .map((edge) => ({
      boardId: edge.boardId,
      source: edge.source,
      target: edge.target,
      kind: edge.kind,
      label: edge.label ?? "",
    }))
    .sort((first, second) => first.source.localeCompare(second.source));

  const drawing = workspace.drawing(WHITEBOARD_CARD);
  return {
    boards,
    cards,
    placements,
    sections,
    edges,
    drawing: {
      order: drawing?.order ?? [],
      elements: (drawing?.elements ?? []).map((element) => ({
        id: element.id,
        type: element.type,
        x: element.x,
        y: element.y,
      })),
    },
  };
}

describe("seedExampleWorkspace", () => {
  it("seeds three named boards and the documented card and portal counts", () => {
    const { workspace, summary } = seeded();

    expect(DEMO_SEED_VERSION).toBe(1);
    expect(summary.boards).toHaveLength(3);
    expect(summary.rootBoardId).toBe(summary.boards[0]);
    expect(
      workspace
        .listBoards()
        .map((board) => board.name)
        .sort(),
    ).toEqual(["Atlas", "Research", "Sources"]);
    expect(summary.cards).toBe(14);
    expect(summary.portals).toBe(4);
    expect(workspace.listCards()).toHaveLength(summary.cards + summary.portals);
    expect(workspace.listCardsOfType(PORTAL_TYPE_ID)).toHaveLength(summary.portals);
  });

  it("gives every card a title, and every content card a body", () => {
    const { workspace } = seeded();

    for (const card of workspace.listCards()) {
      expect(workspace.displayTitle(card.id)).not.toBe("Untitled");
      if (card.primaryTypeId === PORTAL_TYPE_ID) continue;
      expect(workspace.cardText(card.id).length).toBeGreaterThan(0);
    }
  });

  it("links the boards with portals, including a depth-two hop and a cycle", () => {
    const { workspace, summary } = seeded();
    const cards = new Map(workspace.listCards().map((card) => [card.id, card]));
    const research = "demo-board-research";
    const sources = "demo-board-sources";

    expect(portalTarget(cards.get("demo-portal-atlas-research"))).toBe(research);
    expect(portalTarget(cards.get("demo-portal-atlas-sources"))).toBe(sources);
    // Depth two: Atlas opens Research, and Research opens Sources.
    expect(portalTarget(cards.get("demo-portal-research-sources"))).toBe(sources);
    expect(workspace.getCard("demo-portal-research-sources")?.primaryTypeId).toBe(PORTAL_TYPE_ID);
    expect(workspace.getPlacement(research, "demo-portal-research-sources")).toBeDefined();
    // The cycle: Sources points back at the root board.
    expect(portalTarget(cards.get("demo-portal-sources-atlas"))).toBe(summary.rootBoardId);
    expect(workspace.getPlacement(sources, "demo-portal-sources-atlas")).toBeDefined();
  });

  it("wraps the sections around their cards and nothing else", () => {
    const { workspace } = seeded();
    const members = new Map<string, string[]>();
    // Membership is derived per board: two boards may overlap geometrically.
    for (const board of workspace.listBoards()) {
      const membership = sectionMembership(
        workspace.listBoardPlacements(board.id),
        workspace.listSections(board.id),
      );
      for (const [cardId, sectionId] of membership) {
        members.set(sectionId, [...(members.get(sectionId) ?? []), cardId]);
      }
    }

    expect([...members.keys()].sort()).toEqual([
      "demo-section-atlas-sketches",
      "demo-section-atlas-start",
      "demo-section-research-questions",
      "demo-section-sources-reading",
    ]);
    expect((members.get("demo-section-atlas-start") ?? []).sort()).toEqual([
      "demo-card-atlas-nesting",
      "demo-card-atlas-welcome",
    ]);
    expect((members.get("demo-section-atlas-sketches") ?? []).sort()).toEqual([
      "demo-card-atlas-links",
      WHITEBOARD_CARD,
    ]);
    expect((members.get("demo-section-research-questions") ?? []).sort()).toEqual([
      "demo-card-research-depth",
      "demo-card-research-portals",
    ]);
    expect((members.get("demo-section-sources-reading") ?? []).sort()).toEqual([
      "demo-card-sources-crdt",
      "demo-card-sources-layout",
    ]);
  });

  it("stores the whiteboard scene on the drawing card", () => {
    const { workspace } = seeded();
    const drawing = workspace.drawing(WHITEBOARD_CARD);

    expect(drawing?.elements.map((element) => element.id)).toEqual([
      "demo-sketch-atlas",
      "demo-sketch-research",
      "demo-sketch-link",
      "demo-sketch-caption",
    ]);
    expect(drawing?.elements.map((element) => element.type)).toEqual([
      "rectangle",
      "rectangle",
      "arrow",
      "text",
    ]);
    expect(workspace.getCard(WHITEBOARD_CARD)?.primaryTypeId).toBe("whiteboard");
  });

  it("adds tags, typed properties and one labelled edge", () => {
    const { workspace, summary } = seeded();
    const canvas = workspace.getCard(CANVAS_CARD);

    expect(workspace.listTags().map((tag) => tag.name)).toEqual([
      "concept",
      "demo",
      "reference",
      "ritual",
      "sketch",
      "strategy",
      "workflow",
    ]);
    expect(canvas && propertyFingerprint(workspace, canvas)).toEqual({
      "North star": "Zoom out and still know where you are.",
      Stage: "Growing",
    });

    const edges = workspace.listEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      boardId: summary.rootBoardId,
      source: "demo-card-atlas-welcome",
      target: "demo-card-atlas-nesting",
      kind: "references",
      label: "leads to",
    });
  });

  it("lays every board out on distinct coordinates", () => {
    const { workspace, summary } = seeded();

    for (const board of workspace.listBoards()) {
      const placements = workspace.listBoardPlacements(board.id);
      expect(placements.length).toBeGreaterThan(0);
      const spots = new Set(placements.map((placement) => `${placement.x},${placement.y}`));
      expect(spots.size).toBe(placements.length);
    }
    // The root board's two portals are sized by the layout planner, so a child
    // board's frame fits inside them.
    for (const cardId of ["demo-portal-atlas-research", "demo-portal-atlas-sources"]) {
      const placement = workspace.getPlacement(summary.rootBoardId, cardId);
      expect(placement?.width).toBeGreaterThan(0);
      expect(placement?.height).toBeGreaterThan(0);
    }
  });

  it("produces the same workspace on two runs", () => {
    expect(fingerprint(seeded().workspace)).toEqual(fingerprint(seeded().workspace));
  });

  it("reuses an existing board as the root instead of leaving an empty one behind", () => {
    const workspace = new WorkspaceDocument();
    const existing = workspace.createBoard({ name: "Mine" });

    const summary = seedExampleWorkspace(workspace);

    expect(summary.rootBoardId).toBe(existing.id);
    expect(workspace.listBoards()).toHaveLength(3);
    expect(workspace.getBoard(existing.id)?.name).toBe("Atlas");
  });
});

describe("seedModeFor", () => {
  it("seeds the example for a workspace the launcher just created", () => {
    expect(seedModeFor("?workspace=w&fresh=1")).toBe("example");
    expect(seedModeFor("?fresh=1")).toBe("example");
  });

  it("keeps the two starter cards for an existing or direct workspace", () => {
    expect(seedModeFor("?workspace=w")).toBe("starter");
    expect(seedModeFor("?workspace=w&board=board-1")).toBe("starter");
    expect(seedModeFor("")).toBe("starter");
  });

  it("seeds nothing when a test asks for a blank board", () => {
    expect(seedModeFor("?workspace=w&blank=1")).toBe("blank");
    expect(seedModeFor("?workspace=w&blank=1&fresh=1")).toBe("blank");
  });
});
