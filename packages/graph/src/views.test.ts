import { LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { buildSearchText } from "./search.js";
import {
  emptyViewQuery,
  runView,
  runViewQuery,
  type SavedView,
  savedViewSchema,
  VIEW_UNSORTED_SECTION,
  type ViewQuery,
  viewKindOf,
  viewKinds,
} from "./views.js";

function addNode(parent: LoroMap, name: string): LoroMap {
  const children = parent.ensureMergeableList("children");
  const node = children.insertContainer(children.length, new LoroMap());
  node.set("nodeName", name);
  return node;
}

function addText(parent: LoroMap, text: string): void {
  const children = parent.ensureMergeableList("children");
  const value = children.insertContainer(children.length, new LoroText());
  value.insert(0, text);
}

function addParagraphs(body: LoroMap, ...paragraphs: string[]): void {
  for (const paragraph of paragraphs) addText(addNode(body, "paragraph"), paragraph);
}

interface Fixture {
  workspace: WorkspaceDocument;
  boardId: string;
  archiveId: string;
  tagId: string;
}

/**
 * One board with an outer/inner section pair, a second board with no sections,
 * and an unplaced card:
 *
 * | card | board    | section | title      | body                 |
 * | c1   | board    | outer   | Timeline   | pacing notes         |
 * | c2   | board    | inner   | Interview  | colour grading       |
 * | c3   | archive  | none    | Résumé     | timeline of releases |
 * | c4   | unplaced | none    | Loose idea | no board             |
 *
 * Title order is c2, c4, c3, c1; that is also the fallback order of a view
 * without text (relevance has nothing to rank, so it reads like title).
 */
function fixture(): Fixture {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const archive = workspace.createBoard({ name: "Archive" });
  workspace.createType({ id: "character", name: "Character" });
  const tag = workspace.createTag({ name: "draft" });

  workspace.createSection({
    id: "outer",
    boardId: board.id,
    title: "Act one",
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  });
  workspace.createSection({
    id: "inner",
    boardId: board.id,
    title: "Scene",
    x: 100,
    y: 100,
    width: 300,
    height: 300,
  });

  workspace.createCard({
    id: "c1",
    typeId: "character",
    boardId: board.id,
    position: { x: 0, y: 0 },
  });
  addText(workspace.getTitle("c1"), "Timeline");
  addParagraphs(workspace.getContent("c1"), "pacing notes");
  workspace.addCardTag("c1", tag.id);

  workspace.createCard({ id: "c2", boardId: board.id, position: { x: 150, y: 150 } });
  addText(workspace.getTitle("c2"), "Interview");
  addParagraphs(workspace.getContent("c2"), "colour grading");

  workspace.createCard({ id: "c3", boardId: archive.id, position: { x: 0, y: 0 } });
  addText(workspace.getTitle("c3"), "Résumé");
  addParagraphs(workspace.getContent("c3"), "timeline of releases");

  workspace.createCard({ id: "c4" });
  addText(workspace.getTitle("c4"), "Loose idea");
  addParagraphs(workspace.getContent("c4"), "no board");

  workspace.doc.commit({ origin: "test" });
  return { workspace, boardId: board.id, archiveId: archive.id, tagId: tag.id };
}

function query(patch: Partial<ViewQuery>): ViewQuery {
  return { ...emptyViewQuery(), ...patch };
}

function view(patch: Partial<ViewQuery>): SavedView {
  return { id: "v1", name: "Saved", position: 0, query: query(patch) };
}

/** Sorted ids, for tests about membership rather than order. */
function membership(
  workspace: WorkspaceDocument,
  patch: Partial<ViewQuery>,
  context: { boardId?: string | null } = {},
): string[] {
  return [...runView(workspace, view(patch), context).cardIds].sort();
}

describe("runViewQuery text", () => {
  it("should rank title hits above body hits", () => {
    const { workspace } = fixture();
    const result = runView(workspace, view({ text: "timeline" }));
    expect(result.cardIds).toEqual(["c1", "c3"]);
    expect(result.hits.get("c1")?.field).toBe("title");
    expect(result.hits.get("c3")?.field).toBe("body");
  });

  it("should follow a body edit without the view being edited", () => {
    const { workspace } = fixture();
    const saved = view({ text: "grading" });
    expect(runView(workspace, saved).cardIds).toEqual(["c2"]);

    addParagraphs(workspace.getContent("c1"), "a second pass of grading");
    workspace.doc.commit({ origin: "test" });

    // Both are body hits; c2's match sits earlier in its body, so it ranks first.
    expect(runView(workspace, saved).cardIds).toEqual(["c2", "c1"]);
  });

  it("should drop a trashed card and bring it back on restore", () => {
    const { workspace } = fixture();
    const saved = view({ text: "grading" });
    workspace.trashCard("c2");
    expect(runView(workspace, saved).cardIds).toEqual([]);

    workspace.restoreCard("c2");
    expect(runView(workspace, saved).cardIds).toEqual(["c2"]);
  });

  it("should accept a prebuilt index", () => {
    const { workspace } = fixture();
    const index = buildSearchText(workspace);
    const result = runViewQuery(workspace, query({ text: "grading" }), { index });
    expect(result.cardIds).toEqual(["c2"]);
  });

  it("should return hits only for the cards it returns", () => {
    const { workspace } = fixture();
    const result = runView(workspace, view({ text: "grading", typeIds: ["character"] }));
    expect(result.cardIds).toEqual([]);
    expect(result.hits.size).toBe(0);
  });
});

describe("runViewQuery facets", () => {
  it("should OR within a facet group", () => {
    const { workspace, tagId } = fixture();
    expect(membership(workspace, { tagIds: ["missing", tagId] })).toEqual(["c1"]);
  });

  it("should AND across facet groups", () => {
    const { workspace, tagId } = fixture();
    expect(membership(workspace, { typeIds: ["character"], tagIds: [tagId] })).toEqual(["c1"]);
    expect(membership(workspace, { typeIds: ["note"], tagIds: [tagId] })).toEqual([]);
  });

  it("should include a section's subtree", () => {
    const { workspace } = fixture();
    // c1 sits in `outer`, c2 in `inner`, which is contained by `outer`.
    expect(membership(workspace, { sectionIds: ["outer"] })).toEqual(["c1", "c2"]);
    expect(membership(workspace, { sectionIds: ["inner"] })).toEqual(["c2"]);
  });

  it("should treat cards in no section as unsorted", () => {
    const { workspace, boardId } = fixture();
    expect(membership(workspace, { sectionIds: [VIEW_UNSORTED_SECTION] })).toEqual(["c3", "c4"]);
    expect(
      membership(workspace, { sectionIds: [VIEW_UNSORTED_SECTION], scope: "board" }, { boardId }),
    ).toEqual([]);
  });

  it("should ignore a facet id whose record was deleted", () => {
    const { workspace } = fixture();
    const saved = view({ typeIds: ["character"] });
    expect(runView(workspace, saved).cardIds).toEqual(["c1"]);

    // The type is gone: the facet is dropped instead of stranding the view.
    workspace.deleteType("character");
    expect(() => runView(workspace, saved)).not.toThrow();
    expect(runView(workspace, saved).cardIds).toEqual(["c2", "c4", "c3", "c1"]);
  });

  it("should ignore an unknown facet id without throwing", () => {
    const { workspace } = fixture();
    const saved = view({
      typeIds: ["ghost"],
      tagIds: ["ghost-tag"],
      sectionIds: ["ghost-section"],
    });
    expect(runView(workspace, saved).cardIds).toEqual(["c2", "c4", "c3", "c1"]);
  });
});

describe("runViewQuery scope and order", () => {
  it("should limit a board-scoped view to the active board", () => {
    const { workspace, boardId, archiveId } = fixture();
    const saved = view({ scope: "board" });
    expect(runView(workspace, saved, { boardId }).cardIds).toEqual(["c2", "c1"]);
    expect(runView(workspace, saved, { boardId: archiveId }).cardIds).toEqual(["c3"]);
  });

  it("should return nothing for board scope without an active board", () => {
    const { workspace } = fixture();
    expect(runView(workspace, view({ scope: "board" })).cardIds).toEqual([]);
  });

  it("should order by title", () => {
    const { workspace } = fixture();
    expect(runView(workspace, view({ order: "title" })).cardIds).toEqual(["c2", "c4", "c3", "c1"]);
  });

  it("should order by updated, newest first", () => {
    const { workspace } = fixture();
    const stamps: Record<string, number> = { c1: 10, c2: 40, c3: 20, c4: 30 };
    for (const [id, updatedAt] of Object.entries(stamps)) {
      const card = workspace.getCard(id);
      if (card) workspace.setCard({ ...card, updatedAt });
    }
    expect(runView(workspace, view({ order: "updated" })).cardIds).toEqual([
      "c2",
      "c4",
      "c3",
      "c1",
    ]);
  });

  it("should fall back to title order for a relevance view without text", () => {
    const { workspace } = fixture();
    expect(runView(workspace, view({ order: "relevance" })).cardIds).toEqual([
      "c2",
      "c4",
      "c3",
      "c1",
    ]);
  });
});

describe("WorkspaceDocument views", () => {
  it("should round-trip a view", () => {
    const workspace = new WorkspaceDocument();
    const created = workspace.createView({
      name: " Characters ",
      query: query({ text: "aria", typeIds: ["character"], scope: "board", groupBySection: true }),
    });

    expect(created.name).toBe("Characters");
    expect(created.position).toBe(0);
    expect(workspace.listViews()).toEqual([created]);
    expect(workspace.getView(created.id)).toEqual(created);

    workspace.updateView(created.id, { name: "People" });
    expect(workspace.getView(created.id)?.name).toBe("People");
    expect(workspace.getView(created.id)?.query.typeIds).toEqual(["character"]);

    workspace.deleteView(created.id);
    expect(workspace.listViews()).toEqual([]);
  });

  it("should keep a view's query across a reopen", () => {
    const workspace = new WorkspaceDocument();
    const created = workspace.createView({
      name: "Drafts",
      query: query({
        text: "grading",
        tagIds: ["draft"],
        sectionIds: ["inner"],
        scope: "board",
        groupBySection: true,
        order: "updated",
      }),
    });

    const reopened = new WorkspaceDocument();
    reopened.importSnapshot(workspace.exportSnapshot());

    expect(reopened.listViews()).toEqual([created]);
  });

  it("should sync a view through an update export", () => {
    const source = new WorkspaceDocument();
    const target = new WorkspaceDocument();
    target.importUpdate(source.exportUpdate());

    const created = source.createView({ name: "Shared", query: query({ text: "timeline" }) });
    target.importUpdate(source.exportUpdate());

    expect(target.getView(created.id)?.query.text).toBe("timeline");
  });

  it("should refuse an unnamed view", () => {
    const workspace = new WorkspaceDocument();
    expect(() => workspace.createView({ name: "   ", query: emptyViewQuery() })).toThrow(
      "A view needs a name",
    );
    const created = workspace.createView({ name: "Named", query: emptyViewQuery() });
    expect(() => workspace.updateView(created.id, { name: "" })).toThrow("A view needs a name");
  });

  it("should refuse an invalid query", () => {
    const workspace = new WorkspaceDocument();
    const broken = { ...emptyViewQuery(), scope: "everywhere" } as unknown as ViewQuery;
    expect(() => workspace.createView({ name: "Broken", query: broken })).toThrow();

    const created = workspace.createView({ name: "Fine", query: emptyViewQuery() });
    const badOrder = { ...emptyViewQuery(), order: "newest" } as unknown as ViewQuery;
    expect(() => workspace.updateView(created.id, { query: badOrder })).toThrow();
  });

  it("should refuse a duplicate id", () => {
    const workspace = new WorkspaceDocument();
    workspace.createView({ id: "v1", name: "One", query: emptyViewQuery() });
    expect(() => workspace.createView({ id: "v1", name: "Two", query: emptyViewQuery() })).toThrow(
      "View already exists: v1",
    );
  });

  it("should move a view to a position and renumber the rest", () => {
    const workspace = new WorkspaceDocument();
    const a = workspace.createView({ name: "A", query: emptyViewQuery() });
    const b = workspace.createView({ name: "B", query: emptyViewQuery() });
    const c = workspace.createView({ name: "C", query: emptyViewQuery() });

    workspace.moveView(c.id, 0);
    expect(workspace.listViews().map((entry) => entry.name)).toEqual(["C", "A", "B"]);
    expect(workspace.getView(c.id)?.position).toBe(0);
    expect(workspace.getView(a.id)?.position).toBe(1);
    expect(workspace.getView(b.id)?.position).toBe(2);

    workspace.moveView(a.id, 99);
    expect(workspace.listViews().map((entry) => entry.name)).toEqual(["C", "B", "A"]);
  });

  it("should never touch a view when a card is trashed or purged", () => {
    const { workspace } = fixture();
    const saved = workspace.createView({ name: "Grading", query: query({ text: "grading" }) });

    workspace.trashCard("c2");
    workspace.purgeCard("c2");

    expect(workspace.listViews()).toEqual([saved]);
    expect(runView(workspace, saved).cardIds).toEqual([]);
  });

  it("should notify view listeners and bump the revision", () => {
    const workspace = new WorkspaceDocument();
    let calls = 0;
    const stop = workspace.observeViews(() => {
      calls += 1;
    });
    const before = workspace.viewsRevision;
    workspace.createView({ name: "One", query: emptyViewQuery() });

    expect(calls).toBe(1);
    expect(workspace.viewsRevision).toBe(before + 1);

    stop();
    workspace.createView({ name: "Two", query: emptyViewQuery() });
    expect(calls).toBe(1);
  });
});

/**
 * A kind is presentation, so these tests check two things: that the payload
 * survives a round trip, and that it never reaches the selection.
 */
describe("savedViewSchema kind", () => {
  it("should read a view with no kind as a lens", () => {
    const saved = savedViewSchema.parse(view({ text: "grading" }));

    expect(saved.kind).toBeUndefined();
    expect(viewKindOf(saved)).toBe("lens");
  });

  it("should round-trip every kind", () => {
    for (const kind of viewKinds) {
      const saved = savedViewSchema.parse({ ...view({}), kind });

      expect(saved.kind).toBe(kind);
      expect(savedViewSchema.parse(saved)).toEqual(saved);
    }
  });

  it("should keep a lens board and viewport", () => {
    const lens = { boardId: "board", viewport: { x: 12.5, y: -40, zoom: 1.25 } };
    const saved = savedViewSchema.parse({ ...view({}), kind: "lens", lens });

    expect(savedViewSchema.parse(saved)).toEqual(saved);
    expect(saved.lens?.boardId).toBe("board");
    expect(saved.lens?.viewport).toEqual({ x: 12.5, y: -40, zoom: 1.25 });
  });

  it("should keep a collection mode", () => {
    const saved = savedViewSchema.parse({
      ...view({}),
      kind: "collection",
      collection: { mode: "grid" },
    });

    expect(saved.collection?.mode).toBe("grid");
    expect(savedViewSchema.parse(saved)).toEqual(saved);
  });

  it("should reject a mode, a layout or a kind outside the enum", () => {
    expect(savedViewSchema.safeParse({ ...view({}), collection: { mode: "kanban" } }).success).toBe(
      false,
    );
    expect(savedViewSchema.safeParse({ ...view({}), render: { layout: "graph-3d" } }).success).toBe(
      false,
    );
    expect(savedViewSchema.safeParse({ ...view({}), kind: "table" }).success).toBe(false);
  });

  it("should not let a kind change what a query selects", () => {
    const { workspace } = fixture();
    const bare = savedViewSchema.parse(view({ text: "grading" }));
    const lensed = savedViewSchema.parse({
      ...view({ text: "grading" }),
      kind: "lens",
      lens: { boardId: "board", viewport: { x: 240, y: 120, zoom: 0.8 } },
    });

    const without = runViewQuery(workspace, bare.query);
    const withLens = runViewQuery(workspace, lensed.query);

    expect(withLens.cardIds).toEqual(without.cardIds);
    expect(withLens.hits.size).toBe(without.hits.size);
    expect(withLens.cardIds).toEqual(["c2"]);
  });
});
