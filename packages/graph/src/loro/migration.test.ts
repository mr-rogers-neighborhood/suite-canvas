import type { LoroDoc, LoroMap } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

/** The version this build migrates *from*: Sections, portal cards, tab boards. */
const LEGACY_VERSION = 4;

function mapIn(doc: LoroDoc, key: string, id: string): LoroMap {
  return doc.getMap(key).ensureMergeableMap(id);
}

/** A View as schema 4 stored it: a name and two timestamps, and nothing else. */
function legacyView(doc: LoroDoc, id: string, name: string): void {
  const fields = mapIn(doc, WorkspaceDocument.BOARDS_KEY, id);
  fields.set("name", name);
  fields.set("createdAt", 1);
  fields.set("updatedAt", 1);
}

/** A Section as schema 4 stored it: geometry on a View, owning no cards. */
function legacySection(
  doc: LoroDoc,
  input: {
    id: string;
    boardId: string;
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
    z?: number;
    color?: string;
  },
): void {
  const fields = mapIn(doc, WorkspaceDocument.SECTIONS_KEY, input.id);
  fields.set("boardId", input.boardId);
  fields.set("title", input.title);
  fields.set("x", input.x);
  fields.set("y", input.y);
  fields.set("width", input.width);
  fields.set("height", input.height);
  fields.set("z", input.z ?? 0);
  fields.set("createdAt", 10);
  fields.set("updatedAt", 10);
  if (input.color !== undefined) fields.set("color", input.color);
}

function legacyPortalCard(
  doc: LoroDoc,
  input: { id: string; target: string; properties: Record<string, string> },
): void {
  const fields = mapIn(doc, WorkspaceDocument.CARDS_KEY, input.id);
  fields.set("createdAt", 1);
  fields.set("updatedAt", 1);
  fields.set("primaryTypeId", "portal");
  const types = fields.ensureMergeableMap("types");
  types.set("portal", true);
  const properties = fields.ensureMergeableMap("properties");
  for (const [key, value] of Object.entries(input.properties)) properties.set(key, value);
}

function markLegacy(doc: LoroDoc): void {
  doc.getMap(WorkspaceDocument.META_KEY).set("schemaVersion", LEGACY_VERSION);
}

/** Builds a schema-4 document, then opens it with the current build. */
function openLegacy(build: (doc: LoroDoc) => void): {
  workspace: WorkspaceDocument;
  report: NonNullable<ReturnType<WorkspaceDocument["migrate"]>>;
} {
  const seed = new WorkspaceDocument();
  seed.ensureDefaultTypes();
  build(seed.doc);
  markLegacy(seed.doc);
  const workspace = new WorkspaceDocument(seed.doc);
  const report = workspace.lastMigrationReport;
  if (report === null) throw new Error("expected a migration report");
  return { workspace, report };
}

describe("schema migration", () => {
  it("should turn every Section into a Board with its rect, title and colour intact", () => {
    let doc!: LoroDoc;
    const { workspace, report } = openLegacy((target) => {
      doc = target;
      legacyView(doc, "v1", "Home");
      legacySection(doc, {
        id: "s1",
        boardId: "v1",
        title: "Research",
        x: 40,
        y: 60,
        width: 420,
        height: 300,
        z: 2,
        color: "blue",
      });
    });

    expect(report.fromVersion).toBe(LEGACY_VERSION);
    expect(report.toVersion).toBe(5);
    expect(report.boards).toBe(1);
    expect(workspace.getBoard("s1")).toMatchObject({
      id: "s1",
      name: "Research",
      color: "blue",
      rect: { x: 40, y: 60, width: 420, height: 300 },
      z: 2,
      parentBoardId: "v1",
    });
    // The View keeps its id, so `?board=v1` still selects it.
    expect(workspace.getView("v1")?.name).toBe("Home");
    // The legacy map is emptied, never left behind.
    expect(doc.getMap(WorkspaceDocument.SECTIONS_KEY).size).toBe(0);
  });

  it("should nest a Portal card's View into a Board at the portal's placement", () => {
    const { workspace, report } = openLegacy((doc) => {
      legacyView(doc, "home", "Atlas");
      legacyView(doc, "goal", "Goals");
      legacySection(doc, {
        id: "g1",
        boardId: "goal",
        title: "This year",
        x: 10,
        y: 20,
        width: 200,
        height: 200,
      });
      legacyPortalCard(doc, {
        id: "p1",
        target: "goal",
        properties: { "portal-board": "goal" },
      });
      const placement = mapIn(doc, WorkspaceDocument.PLACEMENTS_KEY, "home/p1");
      placement.set("boardId", "home");
      placement.set("cardId", "p1");
      placement.set("x", 300);
      placement.set("y", 400);
      placement.set("z", 0);
      placement.set("createdAt", 1);
      placement.set("width", 288);
      placement.set("height", 256);
    });

    expect(report.portals).toBe(1);
    // The portal card is gone; its frame stands in its place.
    expect(workspace.getCard("p1")).toBeUndefined();
    expect(workspace.getPlacement("home", "p1")).toBeUndefined();

    const frames = workspace.listBoards("home").filter((board) => board.parentBoardId === "home");
    expect(frames).toHaveLength(1);
    const frame = frames[0];
    expect(frame).toMatchObject({
      name: "Goals",
      rect: { x: 300, y: 400, width: 288, height: 256 },
    });

    // The target View's Section was re-parented into the frame, translated
    // into the frame's own coordinates so it keeps its place on screen.
    expect(workspace.getBoard("g1")).toMatchObject({
      parentBoardId: frame?.id,
      rect: { x: -290, y: -380, width: 200, height: 200 },
    });
    expect(workspace.boardWorldRect("g1")).toEqual({
      x: 10,
      y: 20,
      width: 200,
      height: 200,
    });
  });

  it("should re-home a placement into the Board that contains it", () => {
    const { workspace, report } = openLegacy((doc) => {
      legacyView(doc, "v1", "Home");
      legacySection(doc, {
        id: "s1",
        boardId: "v1",
        title: "Inside",
        x: 100,
        y: 100,
        width: 400,
        height: 400,
      });
      const card = mapIn(doc, WorkspaceDocument.CARDS_KEY, "c1");
      card.set("createdAt", 1);
      card.set("updatedAt", 1);
      card.set("primaryTypeId", "note");
      card.ensureMergeableMap("types").set("note", true);
      const placement = mapIn(doc, WorkspaceDocument.PLACEMENTS_KEY, "v1/c1");
      placement.set("boardId", "v1");
      placement.set("cardId", "c1");
      placement.set("x", 150);
      placement.set("y", 150);
      placement.set("z", 0);
      placement.set("createdAt", 2);
    });

    expect(report.placements).toBe(1);
    const [placement] = workspace.listCardPlacements("c1");
    expect(placement?.boardId).toBe("s1");
    // Frame-local: the card keeps its view-space position of (150, 150).
    expect(placement?.x).toBe(50);
    expect(placement?.y).toBe(50);
    expect(workspace.listBoardPlacements("v1")[0]).toMatchObject({ x: 150, y: 150 });
  });

  it("should fall back to the root and report a placement whose Board is missing", () => {
    const { workspace, report } = openLegacy((doc) => {
      legacyView(doc, "v1", "Home");
      const card = mapIn(doc, WorkspaceDocument.CARDS_KEY, "c1");
      card.set("createdAt", 1);
      card.set("updatedAt", 1);
      card.set("primaryTypeId", "note");
      card.ensureMergeableMap("types").set("note", true);
      const placement = mapIn(doc, WorkspaceDocument.PLACEMENTS_KEY, "ghost/c1");
      placement.set("boardId", "ghost");
      placement.set("cardId", "c1");
      placement.set("x", 5);
      placement.set("y", 6);
      placement.set("z", 0);
      placement.set("createdAt", 1);
    });

    expect(report.fallbacks).toEqual([{ cardId: "c1", boardId: "ghost", reason: "missing-board" }]);
    expect(workspace.listCardPlacements("c1")[0]?.boardId).toBe("v1");
    expect(workspace.listBoardPlacements("v1")[0]).toMatchObject({ cardId: "c1", x: 5, y: 6 });
  });

  it("should keep one position per card and report the dropped duplicates", () => {
    const { workspace, report } = openLegacy((doc) => {
      legacyView(doc, "v1", "Home");
      legacySection(doc, {
        id: "s1",
        boardId: "v1",
        title: "Inside",
        x: 0,
        y: 0,
        width: 400,
        height: 400,
      });
      const card = mapIn(doc, WorkspaceDocument.CARDS_KEY, "c1");
      card.set("createdAt", 1);
      card.set("updatedAt", 1);
      card.set("primaryTypeId", "note");
      card.ensureMergeableMap("types").set("note", true);
      for (const [key, x] of [
        ["v1/c1", 10],
        ["s1/c1", 20],
      ] as const) {
        const placement = mapIn(doc, WorkspaceDocument.PLACEMENTS_KEY, key);
        placement.set("boardId", key.split("/")[0]);
        placement.set("cardId", "c1");
        placement.set("x", x);
        placement.set("y", 0);
        placement.set("z", 0);
        placement.set("createdAt", 1);
      }
    });

    expect(workspace.listCardPlacements("c1")).toHaveLength(1);
    expect(report.droppedPlacements).toBe(1);
    expect(report.fallbacks.some((entry) => entry.reason === "duplicate-placement")).toBe(true);
  });

  it("should be idempotent: a second open migrates nothing", () => {
    const seed = new WorkspaceDocument();
    seed.ensureDefaultTypes();
    legacyView(seed.doc, "v1", "Home");
    markLegacy(seed.doc);

    const first = new WorkspaceDocument(seed.doc);
    expect(first.lastMigrationReport).not.toBeNull();
    const second = new WorkspaceDocument(seed.doc);
    expect(second.lastMigrationReport).toBeNull();
  });

  it("should drop the retired portal type", () => {
    const { workspace } = openLegacy(() => {});
    expect(workspace.getType("portal")).toBeUndefined();
    expect(workspace.listTypes().map((type) => type.id)).not.toContain("portal");
  });

  it("should round-trip a View camera set before the migration", () => {
    const { workspace } = openLegacy((doc) => {
      legacyView(doc, "v1", "Home");
      const fields = mapIn(doc, WorkspaceDocument.BOARDS_KEY, "v1");
      fields.set("cameraX", -120);
      fields.set("cameraY", 48);
      fields.set("cameraZoom", 2);
    });

    expect(workspace.getView("v1")?.camera).toEqual({ x: -120, y: 48, zoom: 2 });
  });
});
