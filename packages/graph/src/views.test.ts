import { LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { buildSearchText } from "./search.js";
import {
  emptyViewQuery,
  runView,
  runViewQuery,
  type SavedView,
  VIEW_UNSORTED_SECTION,
  type ViewQuery,
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
  const board = workspace.ensureView();
  const archive = workspace.createView({ name: "Archive" });
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
    const created = workspace.createSavedView({
      name: " Characters ",
      query: query({ text: "aria", typeIds: ["character"], scope: "board", groupBySection: true }),
    });

    expect(created.name).toBe("Characters");
    expect(created.position).toBe(0);
    expect(workspace.listSavedViews()).toEqual([created]);
    expect(workspace.getSavedView(created.id)).toEqual(created);

    workspace.updateSavedView(created.id, { name: "People" });
    expect(workspace.getSavedView(created.id)?.name).toBe("People");
    expect(workspace.getSavedView(created.id)?.query.typeIds).toEqual(["character"]);

    workspace.deleteSavedView(created.id);
    expect(workspace.listSavedViews()).toEqual([]);
  });

  it("should keep a view's query across a reopen", () => {
    const workspace = new WorkspaceDocument();
    const created = workspace.createSavedView({
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

    expect(reopened.listSavedViews()).toEqual([created]);
  });

  it("should sync a view through an update export", () => {
    const source = new WorkspaceDocument();
    const target = new WorkspaceDocument();
    target.importUpdate(source.exportUpdate());

    const created = source.createSavedView({ name: "Shared", query: query({ text: "timeline" }) });
    target.importUpdate(source.exportUpdate());

    expect(target.getSavedView(created.id)?.query.text).toBe("timeline");
  });

  it("should refuse an unnamed view", () => {
    const workspace = new WorkspaceDocument();
    expect(() => workspace.createSavedView({ name: "   ", query: emptyViewQuery() })).toThrow(
      "A view needs a name",
    );
    const created = workspace.createSavedView({ name: "Named", query: emptyViewQuery() });
    expect(() => workspace.updateSavedView(created.id, { name: "" })).toThrow(
      "A view needs a name",
    );
  });

  it("should refuse an invalid query", () => {
    const workspace = new WorkspaceDocument();
    const broken = { ...emptyViewQuery(), scope: "everywhere" } as unknown as ViewQuery;
    expect(() => workspace.createSavedView({ name: "Broken", query: broken })).toThrow();

    const created = workspace.createSavedView({ name: "Fine", query: emptyViewQuery() });
    const badOrder = { ...emptyViewQuery(), order: "newest" } as unknown as ViewQuery;
    expect(() => workspace.updateSavedView(created.id, { query: badOrder })).toThrow();
  });

  it("should refuse a duplicate id", () => {
    const workspace = new WorkspaceDocument();
    workspace.createSavedView({ id: "v1", name: "One", query: emptyViewQuery() });
    expect(() =>
      workspace.createSavedView({ id: "v1", name: "Two", query: emptyViewQuery() }),
    ).toThrow("View already exists: v1");
  });

  it("should move a view to a position and renumber the rest", () => {
    const workspace = new WorkspaceDocument();
    const a = workspace.createSavedView({ name: "A", query: emptyViewQuery() });
    const b = workspace.createSavedView({ name: "B", query: emptyViewQuery() });
    const c = workspace.createSavedView({ name: "C", query: emptyViewQuery() });

    workspace.moveSavedView(c.id, 0);
    expect(workspace.listSavedViews().map((entry) => entry.name)).toEqual(["C", "A", "B"]);
    expect(workspace.getSavedView(c.id)?.position).toBe(0);
    expect(workspace.getSavedView(a.id)?.position).toBe(1);
    expect(workspace.getSavedView(b.id)?.position).toBe(2);

    workspace.moveSavedView(a.id, 99);
    expect(workspace.listSavedViews().map((entry) => entry.name)).toEqual(["C", "B", "A"]);
  });

  it("should never touch a view when a card is trashed or purged", () => {
    const { workspace } = fixture();
    const saved = workspace.createSavedView({ name: "Grading", query: query({ text: "grading" }) });

    workspace.trashCard("c2");
    workspace.purgeCard("c2");

    expect(workspace.listSavedViews()).toEqual([saved]);
    expect(runView(workspace, saved).cardIds).toEqual([]);
  });

  it("should notify view listeners and bump the revision", () => {
    const workspace = new WorkspaceDocument();
    let calls = 0;
    const stop = workspace.observeSavedViews(() => {
      calls += 1;
    });
    const before = workspace.savedViewsRevision;
    workspace.createSavedView({ name: "One", query: emptyViewQuery() });

    expect(calls).toBe(1);
    expect(workspace.savedViewsRevision).toBe(before + 1);

    stop();
    workspace.createSavedView({ name: "Two", query: emptyViewQuery() });
    expect(calls).toBe(1);
  });
});
