import { WorkspaceDocument } from "@suite/graph";
import { LoroDoc } from "loro-crdt";
import { describe, expect, it, vi } from "vitest";
import { seedExampleWorkspace } from "../demo/seedExample";
import {
  buildSuiteSeed,
  type IceSuiteObject,
  type IceSuiteSpawnOptions,
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
  it("should walk the example workspace's three boards", () => {
    expect(seed.rootBoardId).toBe("board-1");
    expect(seed.seedLabel).toBe("Atlas example");
    expect(seed.boards.map((board) => board.id)).toEqual([
      "board-1",
      "demo-board-research",
      "demo-board-sources",
      "demo-board-sources",
    ]);
    expect(seed.boards.map((board) => board.depth)).toEqual([0, 1, 2, 1]);
    expect(seed.boards.map((board) => board.matId)).toEqual([
      null,
      "minimat:demo-portal-atlas-research",
      "minimat:demo-portal-atlas-research/minimat:demo-portal-research-sources",
      "minimat:demo-portal-atlas-sources",
    ]);
  });

  it("should map every card to a native note at its placement coordinates", () => {
    const notes = notesOf(seed.objects);
    expect(notes).toHaveLength(17);
    expect(seed.cards).toHaveLength(17);
    expect(new Set(seed.cards.map((card) => card.cardId)).size).toBe(14);

    const welcome = notes.find((note) => note.cardId === "demo-card-atlas-welcome");
    expect(welcome).toMatchObject({
      kind: "note",
      id: "note:demo-card-atlas-welcome",
      type: "desk.note",
      boardId: "board-1",
      title: "Welcome to Atlas",
      x: 64,
      y: 94,
      props: { pen: "felt", seed: 1000 },
    });
    expect(welcome?.snippet.startsWith("Atlas is the home board")).toBe(true);
    expect(welcome?.snippet).toHaveLength(SUITE_BODY_SNIPPET_LENGTH + 1);
    expect(welcome?.snippet.endsWith("…")).toBe(true);
    expect(welcome?.props.text).toBe(`Welcome to Atlas\n\n${welcome?.snippet ?? ""}`);
    // The seed's portal cards keep their stored size; plain notes have none.
    expect(welcome).not.toHaveProperty("width");
  });

  it("should project real suite.card objects when asked", () => {
    const workspace = new WorkspaceDocument(new LoroDoc());
    workspace.ensureDefaultTypes();
    const summary = seedExampleWorkspace(workspace);
    const cardSeed = projectWorkspaceToIce(workspace, summary.rootBoardId, { cardKind: "card" });
    const cards = cardsOf(cardSeed.objects);

    expect(cards).toHaveLength(17);
    expect(cardSeed.cards).toHaveLength(17);
    expect(cardSeed.cards.every((card) => card.kind === "card")).toBe(true);
    expect(cards[0]).toMatchObject({
      type: SUITE_CARD_TYPE,
      boardId: "board-1",
      props: {
        cardId: "demo-card-atlas-welcome",
        boardId: "board-1",
        title: "Welcome to Atlas",
        // The card's own sheet and ink from the Suite palette, and the one text
        // flow the paper writes.
        paper: "card",
        pen: "card",
        text: expect.stringContaining("Welcome to Atlas"),
      },
    });
    expect(cards[0]?.id).toBe("card:demo-card-atlas-welcome");
  });

  it("should stand a mini mat at each portal and keep child coordinates board-local", () => {
    const notes = notesOf(seed.objects);
    const mats = matsOf(seed.objects);
    expect(mats.map((mat) => mat.id)).toEqual([
      "minimat:demo-portal-atlas-research",
      "minimat:demo-portal-atlas-research/minimat:demo-portal-research-sources",
      "minimat:demo-portal-atlas-sources",
    ]);

    const research = mats.find((mat) => mat.portalCardId === "demo-portal-atlas-research");
    expect(research).toMatchObject({
      boardId: "demo-board-research",
      parentBoardId: "board-1",
      title: "Research",
      depth: 1,
      x: 552,
      props: { name: "Research", vinyl: "charcoal" },
    });
    expect(research?.y).toBeCloseTo(821.8, 6);
    expect(research?.width).toBeCloseTo(319.2, 6);
    expect(research).not.toHaveProperty("parentId");

    const depthNote = notes.find(
      (note) => note.id === "minimat:demo-portal-atlas-research/note:demo-card-research-depth",
    );
    expect(depthNote).toMatchObject({
      boardId: "demo-board-research",
      x: 64,
      y: 64,
      parentId: "minimat:demo-portal-atlas-research",
    });

    const nested = mats.find((mat) => mat.depth === 2);
    expect(nested?.id).toBe(
      "minimat:demo-portal-atlas-research/minimat:demo-portal-research-sources",
    );
    expect(nested).toMatchObject({
      boardId: "demo-board-sources",
      parentBoardId: "demo-board-research",
      parentId: "minimat:demo-portal-atlas-research",
      props: { name: "Sources", vinyl: "slate" },
    });
    expect(
      notes.find(
        (note) =>
          note.id ===
          "minimat:demo-portal-atlas-research/minimat:demo-portal-research-sources/note:demo-card-sources-layout",
      ),
    ).toMatchObject({
      boardId: "demo-board-sources",
      x: 64,
      y: 72,
      parentId: "minimat:demo-portal-atlas-research/minimat:demo-portal-research-sources",
    });
  });

  it("should skip cycle portals and sections instead of inventing objects", () => {
    const cycles = seed.skipped.filter((skip) => skip.reason === "cycle");
    expect(cycles).toHaveLength(2);
    expect(cycles.map((skip) => skip.id)).toEqual([
      "demo-portal-sources-atlas",
      "demo-portal-sources-atlas",
    ]);
    expect(cycles[0]?.detail).toContain("board-1");

    const sections = seed.skipped.filter((skip) => skip.reason === "section");
    expect(sections.map((skip) => skip.id)).toEqual([
      "demo-section-atlas-start",
      "demo-section-atlas-sketches",
      "demo-section-research-questions",
      "demo-section-sources-reading",
      // The Sources board opens twice, so its section is refused twice too.
      "demo-section-sources-reading",
    ]);
    expect(seed.skipped.filter((skip) => skip.reason === "depth")).toHaveLength(0);
    expect(SUITE_MAX_DEPTH).toBe(2);
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

    expect(report.seeded).toBe(20);
    expect(report.failures).toEqual([]);
    expect(report.objects.size).toBe(20);
    expect(report.cards.size).toBe(14);
    expect(report.boards.size).toBe(2);

    // Root frame, then one projection per spawned mini mat.
    expect(engine.project).toHaveBeenCalledTimes(4);

    const first = engine.calls[0];
    expect(first?.type).toBe("desk.note");
    expect(first?.opts).toMatchObject({ x: 64, y: 94, undoable: false });

    const mat = engine.calls.find((call) => call.type === "desk.minimat");
    expect(mat?.opts).toMatchObject({ undoable: false, props: { name: "Research" } });
    expect(mat?.opts.w).toBeCloseTo(319.2, 6);

    const researchEntity = report.boards.get("demo-board-research");
    const nested = engine.calls.find(
      (call) =>
        call.type === "desk.note" &&
        call.opts.parent !== undefined &&
        call.opts.parent.id === researchEntity?.id,
    );
    expect(nested?.opts.parent).toEqual(researchEntity);
    expect(report.cards.get("demo-card-atlas-welcome")).toBeDefined();
  });

  it("should report a refused mat and skip its children", () => {
    const engine = recorder({ refuse: "desk.minimat" });
    const report = spawnIceSuite(seed, engine);

    expect(report.seeded).toBe(7);
    expect(report.objects.size).toBe(7);
    expect(report.boards.size).toBe(0);
    expect(report.failures).toHaveLength(13);
    expect(report.failures.some((failure) => failure.includes("refused desk.minimat"))).toBe(true);
    expect(report.failures.some((failure) => failure.includes("its mini mat did not spawn"))).toBe(
      true,
    );
  });
});
