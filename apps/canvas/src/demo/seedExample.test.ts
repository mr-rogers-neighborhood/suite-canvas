import { type Card, type PropertyValue, sectionMembership, WorkspaceDocument } from "@suite/graph";
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
    .listViews()
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
  it("seeds three named views, fourteen cards and five boards", () => {
    const { workspace, summary } = seeded();

    expect(DEMO_SEED_VERSION).toBe(1);
    expect(summary.boards).toHaveLength(3);
    expect(summary.rootBoardId).toBe(summary.boards[0]);
    expect(
      workspace
        .listViews()
        .map((view) => view.name)
        .sort(),
    ).toEqual(["Atlas", "Research", "Sources"]);
    expect(summary.cards).toBe(14);
    expect(workspace.listCards()).toHaveLength(summary.cards);
    // No card plays the part of a container any more: a Board is the frame.
    expect(summary.nestedBoards).toBe(5);
    expect(workspace.listBoards()).toHaveLength(summary.nestedBoards);
  });

  it("gives every card a title and a body", () => {
    const { workspace } = seeded();

    for (const card of workspace.listCards()) {
      expect(workspace.displayTitle(card.id)).not.toBe("Untitled");
      expect(workspace.cardText(card.id).length).toBeGreaterThan(0);
    }
  });

  it("nests one board inside another to show depth", () => {
    const { workspace } = seeded();
    const nested = workspace.getBoard("demo-section-atlas-nested");
    const outer = workspace.getBoard("demo-section-atlas-start");

    expect(nested?.parentBoardId).toBe(outer?.id);
    expect(workspace.boardPath("demo-section-atlas-nested")).toEqual([
      workspace.boardRoot("demo-section-atlas-nested"),
      "demo-section-atlas-start",
      "demo-section-atlas-nested",
    ]);
    // The card moved into the inner frame, not a copy of it.
    expect(
      workspace.getPlacement("demo-section-atlas-nested", "demo-card-atlas-nesting"),
    ).toBeDefined();
    expect(
      workspace.getPlacement("demo-section-atlas-start", "demo-card-atlas-welcome"),
    ).toBeDefined();
  });

  it("wraps each board around the cards it owns", () => {
    const { workspace } = seeded();
    const owners = new Map<string, string[]>();
    for (const placement of workspace.listPlacements()) {
      owners.set(placement.boardId, [...(owners.get(placement.boardId) ?? []), placement.cardId]);
    }

    // A card belongs to exactly one Board now (ADR-0039): nesting replaced the
    // portal card, so the frames are ownership, not just geometry.
    expect((owners.get("demo-section-atlas-start") ?? []).sort()).toEqual([
      "demo-card-atlas-welcome",
    ]);
    expect(owners.get("demo-section-atlas-nested")).toEqual(["demo-card-atlas-nesting"]);
    expect((owners.get("demo-section-atlas-sketches") ?? []).sort()).toEqual([
      "demo-card-atlas-links",
      WHITEBOARD_CARD,
    ]);
    expect((owners.get("demo-section-research-questions") ?? []).sort()).toEqual([
      "demo-card-research-depth",
      "demo-card-research-portals",
    ]);
    expect((owners.get("demo-section-sources-reading") ?? []).sort()).toEqual([
      "demo-card-sources-crdt",
      "demo-card-sources-layout",
    ]);
    // Every other atlas card stays on the plane itself.
    const atlasPlane = workspace.listViews()[0]?.id ?? "";
    expect(owners.get(atlasPlane)?.length).toBeGreaterThan(0);

    // The root-plane frame still contains its card's anchor: geometry and
    // ownership agree for a card that is not nested.
    const membership = sectionMembership(
      workspace.listBoardPlacements(atlasPlane),
      workspace.listSections(atlasPlane),
    );
    expect(membership.get("demo-card-atlas-welcome")).toBe("demo-section-atlas-start");
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

    for (const board of workspace.listViews()) {
      const placements = workspace.listBoardPlacements(board.id);
      expect(placements.length).toBeGreaterThan(0);
      const spots = new Set(placements.map((placement) => `${placement.x},${placement.y}`));
      expect(spots.size).toBe(placements.length);
    }
    // The nested Board sits inside its parent's world rect: depth is geometric,
    // not a second document.
    const outer = workspace.boardWorldRect("demo-section-atlas-start");
    const inner = workspace.boardWorldRect("demo-section-atlas-nested");
    expect(outer).not.toBeNull();
    expect(inner).not.toBeNull();
    if (outer && inner) {
      expect(inner.x).toBeGreaterThanOrEqual(outer.x);
      expect(inner.y).toBeGreaterThanOrEqual(outer.y);
      expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
      expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 1);
    }
    expect(summary.rootBoardId).toBe(workspace.boardRoot("demo-section-atlas-nested"));
  });

  it("produces the same workspace on two runs", () => {
    expect(fingerprint(seeded().workspace)).toEqual(fingerprint(seeded().workspace));
  });

  it("reuses an existing board as the root instead of leaving an empty one behind", () => {
    const workspace = new WorkspaceDocument();
    const existing = workspace.createView({ name: "Mine" });

    const summary = seedExampleWorkspace(workspace);

    expect(summary.rootBoardId).toBe(existing.id);
    expect(workspace.listViews()).toHaveLength(3);
    expect(workspace.getView(existing.id)?.name).toBe("Atlas");
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
