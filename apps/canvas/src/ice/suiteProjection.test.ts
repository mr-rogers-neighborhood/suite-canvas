import { boardColors, WorkspaceDocument } from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it, vi } from "vitest";
import { seedExampleWorkspace } from "../demo/seedExample";
import {
  buildSuiteSeed,
  type IceSuiteObject,
  type IceSuiteSpawnOptions,
  MINIMAT_VINYL_NAMES,
  projectWorkspaceToIce,
  SUITE_BODY_SNIPPET_LENGTH,
  SUITE_CARD_TYPE,
  SUITE_MAX_DEPTH,
  snippetOf,
  spawnIceSuite,
} from "./suiteProjection";

/**
 * The projection is pure: these tests build the example graph and compare the
 * plan without importing ICE at all. The spawner tests use a plain recorder,
 * which is why `spawnIceSuite` is generic over the entity type.
 */
const seed = buildSuiteSeed();

function notesOf(objects: readonly IceSuiteObject[]) {
  return objects.filter((object) => object.kind === "note");
}

function matsOf(objects: readonly IceSuiteObject[]) {
  return objects.filter((object) => object.kind === "minimat");
}

function cardsOf(objects: readonly IceSuiteObject[]) {
  return objects.filter((object) => object.kind === "card");
}

describe("suiteProjection", () => {
  it("should walk the root view's board tree", () => {
    expect(seed.rootBoardId).toBe("board-1");
    expect(seed.seedLabel).toBe("Atlas example");
    expect(seed.boards.map((board) => board.id)).toEqual([
      "board-1",
      "demo-section-atlas-start",
      "demo-section-atlas-nested",
      "demo-section-atlas-sketches",
    ]);
    expect(seed.boards.map((board) => board.depth)).toEqual([0, 1, 2, 1]);
    expect(seed.boards.map((board) => board.matId)).toEqual([
      null,
      "minimat:demo-section-atlas-start",
      "minimat:demo-section-atlas-start/minimat:demo-section-atlas-nested",
      "minimat:demo-section-atlas-sketches",
    ]);
    // A View is a camera: the other two planes are not on this walk.
    expect(seed.boards.every((board) => board.portalCardId === null)).toBe(true);
  });

  it("should map every card to a native note at its placement coordinates", () => {
    const notes = notesOf(seed.objects);
    expect(notes).toHaveLength(7);
    expect(seed.cards).toHaveLength(7);
    expect(new Set(seed.cards.map((card) => card.cardId)).size).toBe(7);

    const capture = notes.find((note) => note.cardId === "demo-card-atlas-capture");
    expect(capture).toMatchObject({
      kind: "note",
      id: "note:demo-card-atlas-capture",
      type: "desk.note",
      boardId: "board-1",
      title: "Capture first, sort later",
      x: 1040,
      y: 94,
      props: { pen: "felt", seed: 1000 },
    });
    expect(capture?.snippet.startsWith("Drop a thought on the board")).toBe(true);
    expect(capture?.snippet).toHaveLength(SUITE_BODY_SNIPPET_LENGTH + 1);
    expect(capture?.snippet.endsWith("…")).toBe(true);
    expect(capture?.props.text).toBe(`Capture first, sort later\n\n${capture?.snippet ?? ""}`);
    // A note with no stored size keeps its natural one.
    expect(capture).not.toHaveProperty("width");
  });

  it("should project real suite.card objects when asked", () => {
    const workspace = new WorkspaceDocument(new LoroDoc());
    workspace.ensureDefaultTypes();
    const summary = seedExampleWorkspace(workspace);
    const cardSeed = projectWorkspaceToIce(workspace, summary.rootBoardId, { cardKind: "card" });
    const cards = cardsOf(cardSeed.objects);

    expect(cards).toHaveLength(7);
    expect(cardSeed.cards).toHaveLength(7);
    expect(cardSeed.cards.every((card) => card.kind === "card")).toBe(true);
    expect(cards[0]).toMatchObject({
      type: SUITE_CARD_TYPE,
      boardId: "board-1",
      props: {
        cardId: "demo-card-atlas-capture",
        boardId: "board-1",
        title: "Capture first, sort later",
        // The card's own sheet and ink from the Suite palette, and the one text
        // flow the paper writes.
        paper: "card",
        pen: "card",
        text: expect.stringContaining("Capture first, sort later"),
      },
    });
    expect(cards[0]?.id).toBe("card:demo-card-atlas-capture");
  });

  it("should stand a mini mat at each board and keep child coordinates board-local", () => {
    const notes = notesOf(seed.objects);
    const mats = matsOf(seed.objects);
    expect(mats.map((mat) => mat.id)).toEqual([
      "minimat:demo-section-atlas-start",
      "minimat:demo-section-atlas-start/minimat:demo-section-atlas-nested",
      "minimat:demo-section-atlas-sketches",
    ]);

    const start = mats.find((mat) => mat.boardId === "demo-section-atlas-start");
    expect(start).toMatchObject({
      parentBoardId: "board-1",
      title: "Start here",
      depth: 1,
      x: 44,
      y: 74,
      width: 816,
      height: 280,
      props: { name: "Start here", vinyl: "slate" },
    });
    expect(start).not.toHaveProperty("parentId");

    const welcome = notes.find(
      (note) => note.id === "minimat:demo-section-atlas-start/note:demo-card-atlas-welcome",
    );
    expect(welcome).toMatchObject({
      boardId: "demo-section-atlas-start",
      x: 20,
      y: 20,
      parentId: "minimat:demo-section-atlas-start",
    });

    const nested = mats.find((mat) => mat.depth === 2);
    expect(nested).toMatchObject({
      boardId: "demo-section-atlas-nested",
      parentBoardId: "demo-section-atlas-start",
      parentId: "minimat:demo-section-atlas-start",
      title: "Nested detail",
      props: { name: "Nested detail", vinyl: "charcoal" },
    });
    // A child's rect is stored in its parent's frame, so the mat lands inside it.
    expect(nested?.x).toBeCloseTo(488, 6);
    expect(nested?.y).toBeCloseTo(0, 6);

    expect(
      notes.find(
        (note) =>
          note.id ===
          "minimat:demo-section-atlas-start/minimat:demo-section-atlas-nested/note:demo-card-atlas-nesting",
      ),
    ).toMatchObject({
      boardId: "demo-section-atlas-nested",
      x: 20,
      y: 20,
      parentId: "minimat:demo-section-atlas-start/minimat:demo-section-atlas-nested",
    });

    const sketches = mats.find((mat) => mat.boardId === "demo-section-atlas-sketches");
    expect(sketches).toMatchObject({ depth: 1, props: { vinyl: "charcoal" } });
    expect(sketches).not.toHaveProperty("parentId");
  });

  it("should skip nothing in the example, because nesting cannot cycle", () => {
    expect(seed.skipped).toEqual([]);
    expect(SUITE_MAX_DEPTH).toBe(2);
  });

  /**
   * A Board whose `vinyl` ICE does not sell fails to spawn, and every card inside
   * it is skipped with it — the whole canvas goes empty. The projection therefore
   * owns the board-colour → vinyl mapping, and this is the guard that keeps it
   * inside ICE's closed enum for every colour a Board can be.
   */
  it("should wear a vinyl that ICE sells for every board colour", () => {
    for (const color of boardColors) {
      const workspace = new WorkspaceDocument(new LoroDoc());
      const view = workspace.ensureView();
      const board = workspace.createBoard({ name: color, parentBoardId: view.id, color });
      const card = workspace.createCard({ boardId: board.id });

      const projected = projectWorkspaceToIce(workspace, view.id);
      const [mat] = matsOf(projected.objects);

      expect(mat?.boardId).toBe(board.id);
      expect(MINIMAT_VINYL_NAMES).toContain(mat?.props.vinyl);
      expect(
        projectWorkspaceToIce(workspace, view.id).cards.some((entry) => entry.cardId === card.id),
      ).toBe(true);
    }
  });

  it("should stop a board tree deeper than the cap", () => {
    const workspace = new WorkspaceDocument(new LoroDoc());
    const view = workspace.ensureView();
    let parent = view.id;
    for (let depth = 1; depth <= SUITE_MAX_DEPTH + 1; depth += 1) {
      const board = workspace.createBoard({ name: `Level ${depth}`, parentBoardId: parent });
      parent = board.id;
    }

    const deep = projectWorkspaceToIce(workspace, view.id);

    expect(deep.skipped.map((skip) => skip.reason)).toEqual(["depth"]);
    expect(deep.boards).toHaveLength(SUITE_MAX_DEPTH + 1);
  });

  it("should be deterministic across two builds", () => {
    expect(buildSuiteSeed()).toEqual(seed);
    const ids = seed.objects.map((object) => object.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("should read an existing workspace without writing to it", () => {
    const doc = new LoroDoc();
    const workspace = new WorkspaceDocument(doc);
    workspace.ensureDefaultTypes();
    const summary = seedExampleWorkspace(workspace);
    const version = doc.version();

    const projected = projectWorkspaceToIce(workspace, summary.rootBoardId);

    expect(projected).toEqual(seed);
    expect(doc.version().toJSON()).toEqual(version.toJSON());
  });

  it("should cut a snippet once and flatten its whitespace", () => {
    expect(snippetOf("  a\n\nb  ")).toBe("a b");
    const cut = snippetOf("x".repeat(SUITE_BODY_SNIPPET_LENGTH + 40));
    expect(cut).toHaveLength(SUITE_BODY_SNIPPET_LENGTH + 1);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("spawnIceSuite", () => {
  interface FakeEntity {
    readonly id: number;
  }

  function recorder(options: { refuse?: string } = {}) {
    let next = 0;
    const calls: { type: string; opts: IceSuiteSpawnOptions<FakeEntity> }[] = [];
    const project = vi.fn();
    const spawn = vi.fn((type: string, opts: IceSuiteSpawnOptions<FakeEntity>) => {
      if (type === options.refuse) throw new Error(`refused ${type}`);
      next += 1;
      calls.push({ type, opts });
      return { id: next };
    });
    return { calls, project, spawn };
  }

  it("should spawn parents before children and return id mappings", () => {
    const engine = recorder();
    const report = spawnIceSuite(seed, engine);

    expect(report.seeded).toBe(10);
    expect(report.failures).toEqual([]);
    expect(report.objects.size).toBe(10);
    expect(report.cards.size).toBe(7);
    expect(report.boards.size).toBe(3);

    // The root, then one projection per spawned mini mat.
    expect(engine.project).toHaveBeenCalledTimes(4);

    const first = engine.calls[0];
    expect(first?.type).toBe("desk.note");
    expect(first?.opts).toMatchObject({ x: 1040, y: 94, undoable: false });

    const mat = engine.calls.find((call) => call.type === "desk.minimat");
    expect(mat?.opts).toMatchObject({ undoable: false, props: { name: "Start here" } });
    expect(mat?.opts.w).toBeCloseTo(816, 6);

    const startEntity = report.boards.get("demo-section-atlas-start");
    const nested = engine.calls.find(
      (call) =>
        call.type === "desk.note" &&
        call.opts.parent !== undefined &&
        call.opts.parent.id === startEntity?.id,
    );
    expect(nested?.opts.parent).toEqual(startEntity);
    expect(report.cards.get("demo-card-atlas-capture")).toBeDefined();
  });

  it("should report a refused mat and skip its children", () => {
    const engine = recorder({ refuse: "desk.minimat" });
    const report = spawnIceSuite(seed, engine);

    // The plane's own cards still spawn; every mat and everything it held does not.
    expect(report.seeded).toBe(3);
    expect(report.objects.size).toBe(3);
    expect(report.boards.size).toBe(0);
    expect(report.failures).toHaveLength(7);
    expect(report.failures.some((failure) => failure.includes("refused desk.minimat"))).toBe(true);
    expect(report.failures.some((failure) => failure.includes("its mini mat did not spawn"))).toBe(
      true,
    );
  });
});
