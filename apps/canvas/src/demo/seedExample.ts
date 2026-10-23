import {
  type Connector,
  type DrawingElement,
  type FieldDefinition,
  PORTAL_TYPE_ID,
  type Rect,
  type Section,
  type WorkspaceDocument,
} from "@suite/graph";
import {
  type FractalRecipe,
  type LayoutItem,
  type LayoutPlan,
  planFractalLayout,
} from "@suite/scene";
import { LoroMap, LoroText } from "loro-crdt";
import { ensureWhiteboardType, WHITEBOARD_TYPE_ID } from "../cards/whiteboard";
import { layoutPlanFromScene } from "../scene/layoutCommand";

/**
 * The example workspace a new scene-stage workspace starts from.
 *
 * Everything here is derived from fixed ids and a fixed recipe, so two runs
 * produce the same shape: the same boards, cards, portal graph, sections and
 * coordinates. Only ids the document API mints itself (tags, fields, options)
 * differ between runs, which is why the seed's own test compares those by name.
 *
 * Bump `DEMO_SEED_VERSION` whenever the shape changes materially; it is the
 * version a troubleshooting report can quote.
 */
export const DEMO_SEED_VERSION = 1;

const RESEARCH_BOARD_ID = "demo-board-research";
const SOURCES_BOARD_ID = "demo-board-sources";

/** Board keys used by the seed's data tables; `atlas` is the workspace's root. */
type DemoBoardKey = "atlas" | "research" | "sources";

const NOTE_SIZE = { width: 288, height: 240 } as const;
const WHITEBOARD_SIZE = { width: 440, height: 300 } as const;
const PORTAL_SIZE = { width: 288, height: 256 } as const;

/**
 * Grid root, grid children: insertion order keeps the introductions in the top
 * row, and the per-depth gap keeps a nested board from looking like a second
 * root.
 */
const DEMO_RECIPE: FractalRecipe = {
  pattern: "grid",
  gap: 48,
  padding: 64,
  align: "start",
  order: "created",
  jitter: 0,
  seed: 1,
  depth: { scale: 0.35, gap: 24, rotate: 0, pattern: "grid" },
};

/** Space between a section's edge and the cards it wraps. */
const SECTION_PADDING = 20;

interface DemoCardSpec {
  readonly id: string;
  readonly board: DemoBoardKey;
  readonly title: string;
  readonly body: readonly string[];
  readonly typeId?: string;
  readonly tags?: readonly string[];
  /** Property values by field name; the field is created by `ensureDemoSchema`. */
  readonly properties?: Readonly<Record<string, string>>;
  readonly size?: { readonly width: number; readonly height: number };
  readonly connectors?: readonly Connector[];
  readonly drawing?: readonly DrawingElement[];
}

interface DemoSectionSpec {
  readonly id: string;
  readonly board: DemoBoardKey;
  readonly title: string;
  readonly color: Section["color"];
  readonly members: readonly string[];
}

interface DemoPortalSpec {
  readonly id: string;
  readonly board: DemoBoardKey;
  readonly target: DemoBoardKey;
  readonly title: string;
}

const WELCOME_CARD = "demo-card-atlas-welcome";
const NESTING_CARD = "demo-card-atlas-nesting";
const WHITEBOARD_CARD = "demo-card-atlas-whiteboard";

/**
 * A small Excalidraw scene: two boxes, an arrow, and a label. The extra fields
 * are the ones Excalidraw keeps for a stable scene, so the card face and the
 * focus surface both render something recognisable.
 */
const WHITEBOARD_ELEMENTS: readonly DrawingElement[] = [
  {
    id: "demo-sketch-atlas",
    type: "rectangle",
    x: 24,
    y: 72,
    width: 150,
    height: 96,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "#a5d8ff",
    fillStyle: "solid",
    strokeWidth: 2,
    roughness: 1,
    opacity: 100,
    seed: 1,
    version: 1,
    versionNonce: 1,
    updated: 1,
    isDeleted: false,
    groupIds: [],
    boundElements: [{ id: "demo-sketch-link", type: "arrow" }],
    text: "Atlas",
  },
  {
    id: "demo-sketch-research",
    type: "rectangle",
    x: 256,
    y: 72,
    width: 150,
    height: 96,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "#b2f2bb",
    fillStyle: "solid",
    strokeWidth: 2,
    roughness: 1,
    opacity: 100,
    seed: 2,
    version: 1,
    versionNonce: 2,
    updated: 2,
    isDeleted: false,
    groupIds: [],
    boundElements: [{ id: "demo-sketch-link", type: "arrow" }],
    text: "Research",
  },
  {
    id: "demo-sketch-link",
    type: "arrow",
    x: 174,
    y: 120,
    width: 82,
    height: 0,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    roughness: 1,
    opacity: 100,
    seed: 3,
    version: 1,
    versionNonce: 3,
    updated: 3,
    isDeleted: false,
    groupIds: [],
    points: [
      { x: 0, y: 0 },
      { x: 82, y: 0 },
    ],
    startBinding: { elementId: "demo-sketch-atlas", focus: 0, gap: 4 },
    endBinding: { elementId: "demo-sketch-research", focus: 0, gap: 4 },
  },
  {
    id: "demo-sketch-caption",
    type: "text",
    x: 24,
    y: 24,
    width: 220,
    height: 25,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    roughness: 1,
    opacity: 100,
    seed: 4,
    version: 1,
    versionNonce: 4,
    updated: 4,
    isDeleted: false,
    groupIds: [],
    text: "A portal is a door, not a copy",
    fontSize: 20,
    fontFamily: 1,
    textAlign: "left",
    verticalAlign: "top",
  },
];

/** The cards, in layout order per board, so the introductions keep the top row. */
const DEMO_CARDS: readonly DemoCardSpec[] = [
  {
    id: WELCOME_CARD,
    board: "atlas",
    title: "Welcome to Atlas",
    body: [
      "Atlas is the home board of this example workspace.",
      "Everything you see is a card: notes, sources, whiteboards, and portals to other boards.",
      "Double-click a card to write in it. Drag it to move it. Nothing here is precious: it is a worked example.",
    ],
    tags: ["demo"],
    connectors: [
      { id: "demo-connector-welcome-right", x: 1, y: 0.5 },
      { id: "demo-connector-welcome-bottom", x: 0.5, y: 1 },
    ],
  },
  {
    id: NESTING_CARD,
    board: "atlas",
    title: "How boards nest",
    body: [
      "A portal is a card of the Portal type. It points at a board instead of holding text.",
      "Research and Sources are portals here, and Research opens Sources again. That is depth two.",
      "Sources links back to Atlas. The layout planner notices the cycle and stops instead of recursing.",
    ],
    tags: ["demo", "concept"],
    connectors: [
      { id: "demo-connector-nesting-left", x: 0, y: 0.5 },
      { id: "demo-connector-nesting-top", x: 0.5, y: 0 },
    ],
  },
  {
    id: "demo-card-atlas-capture",
    board: "atlas",
    title: "Capture first, sort later",
    body: [
      "Drop a thought on the board before deciding where it belongs.",
      "Types and tags are for retrieval, not for filing: a card can be found again without ever being moved.",
      "The inbox is where a card lives until it has a board.",
    ],
    tags: ["workflow"],
  },
  {
    id: WHITEBOARD_CARD,
    board: "atlas",
    title: "Sketch: three boards",
    body: ["A whiteboard card holds an Excalidraw scene, so a sketch is a card like any other."],
    typeId: WHITEBOARD_TYPE_ID,
    size: WHITEBOARD_SIZE,
    tags: ["demo", "sketch"],
    drawing: WHITEBOARD_ELEMENTS,
  },
  {
    id: "demo-card-atlas-links",
    board: "atlas",
    title: "Links and backlinks",
    body: [
      "An edge connects two cards. A connector is the anchor it attaches to, so the line follows when a card moves.",
      "Backlinks are derived from mentions, not stored, so they never drift out of date.",
      "The welcome card points at this one, which is where its backlink comes from.",
    ],
    tags: ["concept"],
  },
  {
    id: "demo-card-atlas-review",
    board: "atlas",
    title: "Weekly review",
    body: [
      "Open every portal, read what changed, then widen or prune.",
      "A section is geometry, not ownership: a card belongs to the smallest section that contains its header.",
      "Move the section and its cards come along.",
    ],
    tags: ["ritual"],
  },
  {
    id: "demo-card-atlas-canvas",
    board: "atlas",
    title: "Infinite canvas",
    body: [
      "The scene keeps a card's position per board and its size in flow units.",
      "A fractal recipe decides the shape. The plan is previewed before it is applied, and applying it is one undo step.",
      "Zoom out far enough and a portal's frame is the child board, scaled down.",
    ],
    typeId: "concept",
    tags: ["demo", "strategy"],
    properties: { Stage: "Growing", "North star": "Zoom out and still know where you are." },
  },

  {
    id: "demo-card-research-depth",
    board: "research",
    title: "Depth budget",
    body: [
      "Recursion stops at the depth cap. Without one, a cycle would plan forever.",
      "Two or three levels is enough to show structure; past that, the frame gets too small to read.",
    ],
    typeId: "concept",
    tags: ["strategy"],
    properties: { Stage: "Seedling", "North star": "Depth that stays readable." },
  },
  {
    id: "demo-card-research-portals",
    board: "research",
    title: "Portals as telescopes",
    body: [
      "A portal shows a board at a smaller scale, fitted into its frame.",
      "The same board can appear in several places, and each portal remembers its own frame size.",
    ],
    tags: ["concept"],
  },
  {
    id: "demo-card-research-overlap",
    board: "research",
    title: "Overlap is a symptom",
    body: [
      "Two cards overlapping usually means a size was measured before the content arrived.",
      "The layout planner reports overlaps as issues rather than silently nudging cards.",
    ],
  },
  {
    id: "demo-card-research-notes",
    board: "research",
    title: "Field notes",
    body: [
      "A card can carry a typed property as well as a tag.",
      "Stage and North star are fields on the Concept type, so they show in the inspector.",
    ],
    tags: ["ritual"],
  },

  {
    id: "demo-card-sources-layout",
    board: "sources",
    title: "Fractal layout pattern",
    body: [
      "One recipe, applied recursively: a pattern, a gap, and a per-depth scale.",
      "Every level is arranged by the same pure function, so a plan can be previewed without touching the document.",
    ],
    typeId: "source",
    tags: ["reference"],
  },
  {
    id: "demo-card-sources-crdt",
    board: "sources",
    title: "CRDT basics",
    body: [
      "Concurrent edits merge without a server deciding who wins.",
      "A document is a set of containers: two peers editing different fields of one card both keep their change.",
    ],
    typeId: "source",
    tags: ["reference"],
  },
  {
    id: "demo-card-sources-excalidraw",
    board: "sources",
    title: "Excalidraw scene format",
    body: [
      "A scene is a list of elements with a bounding box and a paint order.",
      "The whiteboard card stores exactly that, one map per element, so two people can draw at once.",
    ],
    typeId: "source",
    tags: ["reference"],
  },
];

const DEMO_SECTIONS: readonly DemoSectionSpec[] = [
  {
    id: "demo-section-atlas-start",
    board: "atlas",
    title: "Start here",
    color: "blue",
    members: [WELCOME_CARD, NESTING_CARD],
  },
  {
    id: "demo-section-atlas-sketches",
    board: "atlas",
    title: "Sketches",
    color: "amber",
    members: [WHITEBOARD_CARD, "demo-card-atlas-links"],
  },
  {
    id: "demo-section-research-questions",
    board: "research",
    title: "Open questions",
    color: "violet",
    members: ["demo-card-research-depth", "demo-card-research-portals"],
  },
  {
    id: "demo-section-sources-reading",
    board: "sources",
    title: "Reading list",
    color: "green",
    members: ["demo-card-sources-layout", "demo-card-sources-crdt"],
  },
];

/** Portals, in layout order per board. `sources -> atlas` closes the cycle. */
const DEMO_PORTALS: readonly DemoPortalSpec[] = [
  {
    id: "demo-portal-atlas-research",
    board: "atlas",
    target: "research",
    title: "Research",
  },
  { id: "demo-portal-atlas-sources", board: "atlas", target: "sources", title: "Sources" },
  {
    id: "demo-portal-research-sources",
    board: "research",
    target: "sources",
    title: "Sources, one level down",
  },
  { id: "demo-portal-sources-atlas", board: "sources", target: "atlas", title: "Back to Atlas" },
];

const DEMO_EDGE_LABEL = "leads to";

/** Which first-run content a workspace gets. */
export type DemoSeedMode = "blank" | "example" | "starter";

/**
 * Decides the seed from the page URL. `fresh=1` marks a workspace the launcher
 * just created, which starts from the example; `blank=1` seeds no cards at all
 * (tests and deep links rely on exact counts); anything else keeps the two
 * starter cards older workspaces were seeded with.
 */
export function seedModeFor(search: string): DemoSeedMode {
  const params = new URLSearchParams(search);
  if (params.get("blank") === "1") return "blank";
  return params.get("fresh") === "1" ? "example" : "starter";
}

export interface DemoSeedSummary {
  /** The root board: `Atlas`, unless the workspace already had a board. */
  readonly rootBoardId: string;
  /** Every board the seed wrote, root first. */
  readonly boards: readonly string[];
  readonly cards: number;
  readonly portals: number;
}

function boardIds(rootBoardId: string): Record<DemoBoardKey, string> {
  return { atlas: rootBoardId, research: RESEARCH_BOARD_ID, sources: SOURCES_BOARD_ID };
}

/** The editor writes rich text as a Loro tree; `createCard` only makes the map. */
function writeTitle(workspace: WorkspaceDocument, cardId: string, text: string): void {
  const title = workspace.getTitle(cardId);
  title.set("nodeName", "doc");
  title.ensureMergeableMap("attributes");
  const blocks = title.ensureMergeableList("children");
  blocks.clear();
  const paragraph = blocks.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  const inline = paragraph.ensureMergeableList("children");
  inline.insertContainer(0, new LoroText()).insert(0, text);
}

/** One paragraph per body string, written the way the body editor writes them. */
function writeBody(
  workspace: WorkspaceDocument,
  cardId: string,
  paragraphs: readonly string[],
): void {
  const root = workspace.getContent(cardId);
  root.set("nodeName", "doc");
  root.ensureMergeableMap("attributes");
  const blocks = root.ensureMergeableList("children");
  blocks.clear();
  paragraphs.forEach((text, index) => {
    const paragraph = blocks.insertContainer(index, new LoroMap());
    paragraph.set("nodeName", "paragraph");
    paragraph.ensureMergeableMap("attributes");
    const inline = paragraph.ensureMergeableList("children");
    inline.insertContainer(0, new LoroText()).insert(0, text);
  });
}

/** Select values are option ids; the demo data is written with option labels. */
function propertyValue(field: FieldDefinition, value: string): string {
  if (field.kind !== "select") return value;
  const option = field.options.find((entry) => entry.label === value);
  if (!option) throw new Error(`No option "${value}" on field "${field.name}"`);
  return option.id;
}

/**
 * The demo's schema: the whiteboard type, plus two typed fields on Concept so
 * the inspector has something real to show. Field ids are minted by the
 * document, so callers set values through the returned definitions.
 */
function ensureDemoSchema(workspace: WorkspaceDocument): Record<string, FieldDefinition> {
  ensureWhiteboardType(workspace);
  const existing = workspace.getType("concept")?.fields ?? [];
  const field = (name: string, create: () => FieldDefinition): FieldDefinition =>
    existing.find((entry) => entry.name === name) ?? create();
  return {
    Stage: field("Stage", () =>
      workspace.addField("concept", {
        name: "Stage",
        kind: "select",
        options: ["Seedling", "Growing", "Established"],
      }),
    ),
    "North star": field("North star", () =>
      workspace.addField("concept", { name: "North star", kind: "text" }),
    ),
  };
}

/** Cards and portals in layout order, one list per board. */
function layoutBoards(
  ids: Record<DemoBoardKey, string>,
  portals: readonly DemoPortalSpec[],
): Record<string, LayoutItem[]> {
  const boards: Record<DemoBoardKey, LayoutItem[]> = { atlas: [], research: [], sources: [] };
  for (const spec of DEMO_CARDS) {
    const size = spec.size ?? NOTE_SIZE;
    boards[spec.board].push({
      id: spec.id,
      width: size.width,
      height: size.height,
      typeId: spec.typeId ?? "note",
      createdAt: boards[spec.board].length,
    });
  }
  for (const portal of portals) {
    boards[portal.board].push({
      id: portal.id,
      width: PORTAL_SIZE.width,
      height: PORTAL_SIZE.height,
      typeId: PORTAL_TYPE_ID,
      portalBoardId: ids[portal.target],
      createdAt: boards[portal.board].length,
    });
  }
  return {
    [ids.atlas]: boards.atlas,
    [ids.research]: boards.research,
    [ids.sources]: boards.sources,
  };
}

/**
 * Every board in a plan, keyed by id; the portal tree is walked depth-first.
 * The first visit wins, which is the copy `layoutPlanFromScene` applies.
 */
function plansByBoard(plan: LayoutPlan): Map<string, LayoutPlan> {
  const boards = new Map<string, LayoutPlan>();
  const visit = (node: LayoutPlan): void => {
    if (!boards.has(node.boardId)) boards.set(node.boardId, node);
    for (const portal of node.portals) {
      if (portal.child) visit(portal.child);
    }
  };
  visit(plan);
  return boards;
}

/** The tightest rectangle around the members of a section, plus padding. */
function sectionRect(board: LayoutPlan, members: readonly string[]): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const id of members) {
    const placement = board.placements.find((candidate) => candidate.id === id);
    if (!placement) continue;
    minX = Math.min(minX, placement.x);
    minY = Math.min(minY, placement.y);
    maxX = Math.max(maxX, placement.x + placement.width);
    maxY = Math.max(maxY, placement.y + placement.height);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { x: 0, y: 0, width: 320, height: 240 };
  }
  return {
    x: minX - SECTION_PADDING,
    y: minY - SECTION_PADDING,
    width: maxX - minX + SECTION_PADDING * 2,
    height: maxY - minY + SECTION_PADDING * 2,
  };
}

/**
 * Writes the example workspace: three boards, fourteen cards, four portals (one
 * of them closing a cycle), four sections, tags, two typed properties, one edge
 * and one whiteboard scene, arranged by the shared fractal planner.
 *
 * The caller owns `markSeeded()`; this only writes content, so it can also be
 * used to preview the demo in a test document. The workspace's first board is
 * renamed to Atlas rather than left behind as an empty "Board 1".
 */
export function seedExampleWorkspace(workspace: WorkspaceDocument): DemoSeedSummary {
  workspace.ensureDefaultTypes();
  // Schema first, as its own batch: a type's field list is cached until a
  // commit, so values can only be written once the fields are durable.
  const fields = workspace.batch("demo:schema", () => ensureDemoSchema(workspace));
  const atlas = workspace.ensureBoard();
  const ids = boardIds(atlas.id);
  const portals = DEMO_PORTALS;

  workspace.batch("demo:seed", () => {
    workspace.renameBoard(atlas.id, "Atlas");
    workspace.createBoard({ id: ids.research, name: "Research" });
    workspace.createBoard({ id: ids.sources, name: "Sources" });

    for (const spec of DEMO_CARDS) {
      workspace.createCard({
        id: spec.id,
        boardId: ids[spec.board],
        position: { x: 0, y: 0 },
        ...(spec.typeId ? { typeId: spec.typeId } : {}),
        ...(spec.connectors ? { connectors: [...spec.connectors] } : {}),
      });
      writeTitle(workspace, spec.id, spec.title);
      writeBody(workspace, spec.id, spec.body);
      for (const name of spec.tags ?? []) {
        workspace.addCardTag(spec.id, workspace.ensureTag(name).id);
      }
      for (const [name, value] of Object.entries(spec.properties ?? {})) {
        const field = fields[name];
        if (field) workspace.setProperty(spec.id, field.id, propertyValue(field, value));
      }
      if (spec.drawing) workspace.setDrawing(spec.id, spec.drawing);
    }
  });

  workspace.batch("demo:portals", () => {
    for (const portal of portals) {
      workspace.createPortalCard({
        id: portal.id,
        boardId: ids[portal.board],
        targetBoardId: ids[portal.target],
      });
      // The card face shows the target board's name; the title is what search,
      // backlinks and the outline label the portal with.
      writeTitle(workspace, portal.id, portal.title);
    }
  });

  const plan = planFractalLayout({
    rootBoardId: ids.atlas,
    boards: layoutBoards(ids, portals),
    recipe: DEMO_RECIPE,
    maxDepth: 3,
  });
  workspace.applyLayoutPlan(layoutPlanFromScene(plan));

  const planned = plansByBoard(plan);
  workspace.batch("demo:sections", () => {
    for (const section of DEMO_SECTIONS) {
      const board = planned.get(ids[section.board]);
      if (!board) continue;
      workspace.createSection({
        id: section.id,
        boardId: ids[section.board],
        title: section.title,
        color: section.color,
        ...sectionRect(board, section.members),
      });
    }
  });

  workspace.batch("demo:links", () => {
    const edge = workspace.addEdge({
      boardId: ids.atlas,
      source: WELCOME_CARD,
      target: NESTING_CARD,
      kind: "references",
      sourceConnector: "demo-connector-welcome-right",
      targetConnector: "demo-connector-nesting-left",
    });
    if (edge) workspace.setEdgeLabel(edge.id, DEMO_EDGE_LABEL);
  });

  return {
    rootBoardId: ids.atlas,
    boards: [ids.atlas, ids.research, ids.sources],
    cards: DEMO_CARDS.length,
    portals: portals.length,
  };
}
