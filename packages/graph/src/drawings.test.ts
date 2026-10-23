import type { LoroDoc } from "loro-crdt";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import type { DrawingElement } from "./drawings.js";
import { normalizeDrawingOrder, sameDrawingValue } from "./drawings.js";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { applyProjection, projectWorkspace } from "./projection.js";

function sync(a: LoroDoc, b: LoroDoc): void {
  const fromA = a.export({ mode: "update" });
  const fromB = b.export({ mode: "update" });
  b.import(fromA);
  a.import(fromB);
}

/** Counts commits, because one commit is the unit undo and history care about. */
function countCommits(workspace: WorkspaceDocument): () => number {
  let commits = 0;
  workspace.doc.subscribe(() => {
    commits += 1;
  });
  return () => commits;
}

function element(id: string, patch: Partial<DrawingElement> = {}): DrawingElement {
  return { id, type: "rectangle", x: 0, y: 0, width: 100, height: 60, ...patch };
}

function seeded(): WorkspaceDocument {
  const workspace = new WorkspaceDocument();
  workspace.setDrawing("card-1", [element("a"), element("b", { x: 120 })]);
  return workspace;
}

function boardWithDrawing() {
  const source = new WorkspaceDocument();
  const board = source.ensureBoard();
  source.createCard({ id: "w", boardId: board.id, position: { x: 0, y: 0 } });
  source.createCard({ id: "plain", boardId: board.id, position: { x: 200, y: 0 } });
  source.createCard({ id: "hidden" });
  source.setDrawing(
    "w",
    [element("a", { strokeColor: "#f00" }), element("b", { x: 40 })],
    ["b", "a"],
  );
  source.setDrawing("hidden", [element("z")]);
  return { source, board };
}

describe("drawings", () => {
  it("should return null for a card that has no scene", () => {
    const workspace = new WorkspaceDocument();
    expect(workspace.drawing("missing")).toBeNull();
  });

  it("should seed a scene with its order and keep every Excalidraw field", () => {
    const workspace = new WorkspaceDocument();
    const drawing = workspace.setDrawing(
      "card-1",
      [
        element("a", {
          x: 10,
          strokeColor: "#123",
          roundness: { type: 3 },
          groupIds: ["g1", "g2"],
          boundElements: [{ id: "arrow-1", type: "arrow" }],
        }),
        element("b", { y: 20, frameId: null }),
      ],
      ["b", "a"],
    );

    expect(drawing.order).toEqual(["b", "a"]);
    expect(drawing.elements.map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(drawing.elements[1]).toMatchObject({
      id: "a",
      x: 10,
      strokeColor: "#123",
      roundness: { type: 3 },
      groupIds: ["g1", "g2"],
      boundElements: [{ id: "arrow-1", type: "arrow" }],
    });
    expect(drawing.version).toBe(1);
    expect(workspace.drawing("card-1")).toEqual(drawing);
  });

  it("should append a new element to the top of the order and update in place", () => {
    const workspace = seeded();
    workspace.upsertDrawingElement("card-1", element("c"));

    expect(workspace.drawing("card-1")?.order).toEqual(["a", "b", "c"]);

    workspace.upsertDrawingElement("card-1", element("a", { x: 55 }));
    const drawing = workspace.drawing("card-1");
    expect(drawing?.elements.find((entry) => entry.id === "a")).toMatchObject({ x: 55 });
    expect(drawing?.order).toEqual(["a", "b", "c"]);
    expect(drawing?.version).toBe(3);
  });

  it("should drop fields an update no longer carries", () => {
    const workspace = new WorkspaceDocument();
    workspace.setDrawing("card-1", [element("a", { strokeColor: "#123" })]);
    workspace.upsertDrawingElement("card-1", element("a"));

    const stored = workspace.drawing("card-1")?.elements[0];
    expect(stored).not.toHaveProperty("strokeColor");
    expect(stored).toMatchObject({ id: "a", x: 0, y: 0, width: 100, height: 60 });
  });

  it("should merge concurrent edits to different fields of one element", () => {
    const left = seeded();
    const right = new WorkspaceDocument();
    right.importSnapshot(left.exportSnapshot());

    left.upsertDrawingElement("card-1", element("a", { x: 40 }));
    right.upsertDrawingElement("card-1", element("a", { y: 70 }));
    sync(left.doc, right.doc);

    const fromLeft = left.drawing("card-1")?.elements.find((entry) => entry.id === "a");
    const fromRight = right.drawing("card-1")?.elements.find((entry) => entry.id === "a");
    expect(fromLeft).toMatchObject({ x: 40, y: 70 });
    expect(fromRight).toEqual(fromLeft);
  });

  it("should keep a stable order when two peers append concurrently", () => {
    const left = seeded();
    const right = new WorkspaceDocument();
    right.importSnapshot(left.exportSnapshot());

    left.upsertDrawingElement("card-1", element("c"));
    right.upsertDrawingElement("card-1", element("d"));
    sync(left.doc, right.doc);

    const leftOrder = left.drawing("card-1")?.order;
    expect(leftOrder).toHaveLength(4);
    expect(leftOrder?.slice(0, 2)).toEqual(["a", "b"]);
    expect(new Set(leftOrder)).toEqual(new Set(["a", "b", "c", "d"]));
    expect(right.drawing("card-1")?.order).toEqual(leftOrder);
  });

  it("should tombstone a deleted element and keep a concurrent field edit", () => {
    const left = seeded();
    const right = new WorkspaceDocument();
    right.importSnapshot(left.exportSnapshot());

    left.removeDrawingElement("card-1", "a");
    right.upsertDrawingElement("card-1", element("a", { x: 90 }));
    sync(left.doc, right.doc);

    for (const workspace of [left, right]) {
      const drawing = workspace.drawing("card-1");
      expect(drawing?.order).toEqual(["b"]);
      expect(drawing?.elements.map((entry) => entry.id)).toEqual(["b"]);
    }
    // The tombstone, not the delete, is what readers filter on.
    const raw = JSON.stringify(left.toJSON().drawings);
    expect(raw).toContain('"deletedAt"');
    expect(raw).toContain('"x":90');
  });

  it("should revive a tombstoned element through an upsert", () => {
    const workspace = seeded();
    workspace.removeDrawingElement("card-1", "a");
    workspace.upsertDrawingElement("card-1", element("a", { x: 5 }));

    const drawing = workspace.drawing("card-1");
    expect(drawing?.order).toEqual(["b", "a"]);
    expect(drawing?.elements[0]).toMatchObject({ id: "b" });
    expect(drawing?.elements[1]).toMatchObject({ id: "a", x: 5 });
    expect(JSON.stringify(workspace.toJSON().drawings)).not.toContain("deletedAt");
  });

  it("should purge a tombstone for good and leave the order alone", () => {
    const workspace = seeded();
    workspace.removeDrawingElement("card-1", "a");
    workspace.purgeDrawingElement("card-1", "a");

    expect(workspace.drawing("card-1")?.order).toEqual(["b"]);
    const raw = JSON.stringify(workspace.toJSON().drawings);
    expect(raw).not.toContain('"a"');
    expect(raw).not.toContain("deletedAt");
  });

  it("should set the whole z-order with move operations", () => {
    const workspace = new WorkspaceDocument();
    workspace.setDrawing("card-1", [element("a"), element("b"), element("c")]);
    workspace.setDrawingOrder("card-1", ["c", "a", "b"]);

    expect(workspace.drawing("card-1")?.order).toEqual(["c", "a", "b"]);
    expect(workspace.drawing("card-1")?.elements.map((entry) => entry.id)).toEqual(["c", "a", "b"]);
  });

  it("should ignore unknown order ids and append elements the order forgot", () => {
    const workspace = new WorkspaceDocument();
    workspace.setDrawing("card-1", [element("a"), element("b")], ["a", "b"]);
    workspace.setDrawingOrder("card-1", ["ghost", "b"]);

    expect(workspace.drawing("card-1")?.order).toEqual(["b", "a"]);
  });

  it("should clear a scene without touching the card", () => {
    const workspace = seeded();
    workspace.createCard({ id: "card-1" });

    workspace.clearDrawing("card-1");

    expect(workspace.drawing("card-1")).toBeNull();
    expect(workspace.getCard("card-1")).toBeDefined();
    expect(workspace.toJSON().drawings).toEqual({});
  });

  it("should drop a card's scene when the card is purged", () => {
    const workspace = seeded();
    workspace.createCard({ id: "card-1" });

    workspace.purgeCard("card-1");

    expect(workspace.drawing("card-1")).toBeNull();
  });

  it("should commit once per call and never for a no-op", () => {
    const workspace = new WorkspaceDocument();
    const commits = countCommits(workspace);

    workspace.setDrawing("card-1", [element("a")]);
    expect(commits()).toBe(1);

    workspace.upsertDrawingElement("card-1", element("a", { x: 10 }));
    expect(commits()).toBe(2);

    // An identical upsert writes nothing, so it must not create an empty commit.
    workspace.upsertDrawingElement("card-1", element("a", { x: 10 }));
    expect(commits()).toBe(2);

    workspace.upsertDrawingElement("card-1", element("b"));
    expect(commits()).toBe(3);

    workspace.setDrawingOrder("card-1", ["b", "a"]);
    expect(commits()).toBe(4);

    workspace.setDrawingOrder("card-1", ["b", "a"]);
    expect(commits()).toBe(4);

    workspace.removeDrawingElement("card-1", "b");
    expect(commits()).toBe(5);

    workspace.removeDrawingElement("card-1", "b");
    expect(commits()).toBe(5);

    workspace.purgeDrawingElement("card-1", "b");
    expect(commits()).toBe(6);

    workspace.purgeDrawingElement("card-1", "b");
    expect(commits()).toBe(6);

    workspace.clearDrawing("card-1");
    expect(commits()).toBe(7);

    workspace.clearDrawing("card-1");
    expect(commits()).toBe(7);
  });

  it("should reject malformed elements before touching the document", () => {
    const workspace = new WorkspaceDocument();
    const commits = countCommits(workspace);
    let deep: unknown = 1;
    for (let depth = 0; depth < 20; depth += 1) deep = { deep };

    const malformed: unknown[] = [
      { ...element("a"), x: Number.NaN },
      { ...element("a"), width: "100" },
      { ...element("a"), type: "" },
      { ...element("a"), id: "" },
      { ...element("a"), opacity: undefined },
      { ...element("a"), seed: () => 1 },
      { ...element("a"), boundElements: [{ id: "a", type: "arrow", fn: () => 0 }] },
      { ...element("a"), created: new Date() },
      { ...element("a"), custom: deep },
      { id: "a", type: "rectangle", x: 0, y: 0 },
    ];

    for (const candidate of malformed) {
      expect(() => workspace.upsertDrawingElement("card-1", candidate as DrawingElement)).toThrow();
      expect(workspace.drawing("card-1")).toBeNull();
    }
    expect(commits()).toBe(0);
  });

  it("should reject duplicate ids when seeding", () => {
    const workspace = new WorkspaceDocument();

    expect(() => workspace.setDrawing("card-1", [element("a"), element("a")])).toThrow(
      /Duplicate drawing element/,
    );
    expect(workspace.drawing("card-1")).toBeNull();
  });

  it("should reject a tombstoned element as seed input", () => {
    const workspace = new WorkspaceDocument();

    expect(() => workspace.setDrawing("card-1", [element("a", { deletedAt: 1 })])).toThrow(
      /tombstone/,
    );
    expect(workspace.drawing("card-1")).toBeNull();
  });

  it("should ignore drawing writes for a card that has no scene", () => {
    const workspace = new WorkspaceDocument();
    const commits = countCommits(workspace);

    workspace.removeDrawingElement("missing", "a");
    workspace.purgeDrawingElement("missing", "a");
    workspace.setDrawingOrder("missing", ["a"]);

    expect(commits()).toBe(0);
    expect(workspace.drawing("missing")).toBeNull();
  });

  it("should not let an upsert write a tombstone", () => {
    const workspace = seeded();
    expect(() => workspace.upsertDrawingElement("card-1", element("a", { deletedAt: 10 }))).toThrow(
      /removeDrawingElement/,
    );
  });

  it("should compare stored values structurally", () => {
    expect(sameDrawingValue({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(sameDrawingValue({ a: [1, 2] }, { a: [2, 1] })).toBe(false);
    expect(sameDrawingValue([1, { a: true }], [1, { a: true }])).toBe(true);
    expect(sameDrawingValue([1], { 0: 1 })).toBe(false);
    expect(sameDrawingValue(null, null)).toBe(true);
    expect(sameDrawingValue(1, "1")).toBe(false);
    expect(normalizeDrawingOrder(["b", "b", "ghost"], ["a", "b"])).toEqual(["b", "a"]);
  });
});

describe("drawing share projections", () => {
  it("should carry a board's scenes into a board share and redact off-board ones", () => {
    const { source, board } = boardWithDrawing();
    const projection = projectWorkspace(source, { scope: "board", boardId: board.id });

    expect(projection.workspace.drawing("w")).toEqual(source.drawing("w"));
    expect(projection.workspace.drawing("plain")).toBeNull();
    expect(projection.workspace.drawing("hidden")).toBeNull();
  });

  it("should carry a single card's scene into a card share", () => {
    const { source } = boardWithDrawing();
    const projection = projectWorkspace(source, { scope: "card", cardId: "w" });

    expect(projection.workspace.drawing("w")).toMatchObject({
      cardId: "w",
      order: ["b", "a"],
      version: 1,
    });
    expect(projection.workspace.drawing("w")?.elements[1]).toMatchObject({
      id: "a",
      strokeColor: "#f00",
    });
  });

  it("should copy scenes for a selection only", () => {
    const { source, board } = boardWithDrawing();
    const projection = projectWorkspace(source, {
      scope: "selection",
      boardId: board.id,
      cardIds: ["w"],
    });

    expect(projection.workspace.drawing("w")).toEqual(source.drawing("w"));
    expect(projection.workspace.drawing("plain")).toBeNull();
  });

  it("should round-trip scenes through applyProjection, order included", () => {
    const { source, board } = boardWithDrawing();
    const first = projectWorkspace(source, { scope: "board", boardId: board.id });
    const target = new WorkspaceDocument();
    applyProjection(target, first.workspace);

    expect(target.drawing("w")).toEqual(source.drawing("w"));

    source.setDrawingOrder("w", ["a", "b"]);
    source.upsertDrawingElement("w", element("c", { x: 300 }));
    source.removeDrawingElement("w", "b");
    const second = projectWorkspace(source, { scope: "board", boardId: board.id });
    applyProjection(target, second.workspace);

    expect(target.drawing("w")).toEqual(source.drawing("w"));
    expect(target.drawing("w")?.order).toEqual(["a", "c"]);
    // A deleted element is not copied at all, so its geometry stays private.
    expect(JSON.stringify(target.toJSON().drawings)).not.toContain('"b"');
  });

  it("should remove a scene a rebuild no longer projects", () => {
    const { source } = boardWithDrawing();
    const first = projectWorkspace(source, { scope: "card", cardId: "w" });
    const target = new WorkspaceDocument();
    applyProjection(target, first.workspace);

    const plainOnly = projectWorkspace(source, { scope: "card", cardId: "plain" });
    applyProjection(target, plainOnly.workspace);

    expect(target.drawing("w")).toBeNull();
  });
});

/**
 * The root belongs to `WorkspaceDocument`: a feature module that reached for
 * `doc.getMap("drawings")` would bypass validation and batching. `projection.ts`
 * is the one other writer, because a share copies documents rather than
 * replaying commands.
 */
describe("drawings boundary", () => {
  const ROOT = ts.sys.getCurrentDirectory();
  const SRC =
    ["packages/graph/src", "src"]
      .map((candidate) => `${ROOT}/${candidate}`)
      .find((candidate) => ts.sys.fileExists(`${candidate}/index.ts`)) ?? `${ROOT}/src`;
  const ALLOWED = ["loro/WorkspaceDocument.ts", "projection.ts"];

  it("should not let another module touch the drawings root directly", () => {
    const files = ts.sys
      .readDirectory(SRC, [".ts"])
      .filter((file) => !file.endsWith(".test.ts"))
      .sort();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      if (ALLOWED.some((allowed) => file.endsWith(allowed))) continue;
      const source = ts.sys.readFile(file) ?? "";
      expect(source, file).not.toContain("DRAWINGS_KEY");
      expect(source, file).not.toContain('"drawings"');
    }
  });
});
