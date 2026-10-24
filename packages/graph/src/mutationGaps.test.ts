import { LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { planPublish } from "./merge.js";
import { projectWorkspace } from "./projection.js";
import { highlightRanges, searchCards } from "./search.js";
import { rectContainsPoint, unionRect } from "./sections.js";
import { emptyViewQuery } from "./views.js";

/**
 * Tests written from surviving mutants in the Stryker report. Each one pins a
 * behaviour the suite only exercised indirectly, so it is listed with the
 * mutation it kills. See "Mutation testing" in docs/testing.md.
 */

describe("search snippet windows", () => {
  it("should not add an ellipsis when the body fits the window", () => {
    // Kills the "always an ellipsis" mutants of the prefix/suffix conditions.
    const [hit] = searchCards(new Map([["c1", "pacing notes"]]), "pacing");

    expect(hit?.snippet).toBe("pacing notes");
    expect(hit?.highlights).toEqual([{ start: 0, end: "pacing".length }]);
  });

  it("should size the window from the longest matched term", () => {
    // Kills Math.max -> Math.min in `longestTerm` and the `position + longest`
    // arithmetic: both shrink the window so the snippet ends too early.
    const [hit] = searchCards(new Map([["c1", "xx alpha alphabet yy"]]), "alpha alphabet", {
      snippetRadius: 1,
    });

    expect(hit?.snippet).toBe("\u2026 alpha alp\u2026");
    expect(hit?.highlights).toEqual([{ start: 2, end: 7 }]);
  });
});

describe("highlightRanges merging", () => {
  it("should merge a nested match into the range that contains it", () => {
    // Kills Math.max -> Math.min in `mergeRanges`: the shorter end would cut
    // the surrounding range down to the nested one.
    expect(highlightRanges("abc", ["abc", "b"])).toEqual([{ start: 0, end: 3 }]);
  });

  it("should fold whitespace the same way the index does", () => {
    // Kills the whitespace-collapsing mutants in `foldWithOffsets` and the
    // /\s+/ -> /\s/ mutant in `normalizeSearchText`: the term is normalized to
    // one space, so the original text has to be folded to one space too.
    expect(highlightRanges("alpha   beta", ["alpha   beta"])).toEqual([{ start: 0, end: 12 }]);
  });
});

describe("section geometry boundaries", () => {
  it("should include the rectangle's own edges", () => {
    // Kills >= -> > and <= -> < in `rectContainsPoint`: unrelated sections
    // start at zero, so only a card exactly on an edge can tell them apart.
    const rect = { x: 0, y: 0, width: 10, height: 10 };

    expect(rectContainsPoint(rect, { x: 0, y: 0 })).toBe(true);
    expect(rectContainsPoint(rect, { x: 10, y: 10 })).toBe(true);
    expect(rectContainsPoint(rect, { x: 10.5, y: 5 })).toBe(false);
  });

  it("should return the input rectangle when there is nothing to union", () => {
    // Kills the maxX/maxY arithmetic mutants: without other rectangles the
    // bounds have to come from the input alone.
    expect(unionRect({ x: 10, y: 20, width: 30, height: 40 }, [])).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40,
    });
  });
});

describe("emptyViewQuery", () => {
  it("should start with no facets selected", () => {
    // Kills the array-literal mutants: a non-empty facet list would filter
    // every new view down to nothing.
    expect(emptyViewQuery()).toEqual({
      typeIds: [],
      tagIds: [],
      sectionIds: [],
      scope: "all",
      groupBySection: false,
      order: "relevance",
    });
  });
});

function writeRich(workspace: WorkspaceDocument, container: LoroMap, text: string): void {
  container.set("nodeName", "doc");
  container.ensureMergeableMap("attributes");
  const blocks = container.ensureMergeableList("children");
  blocks.clear();
  const paragraph = blocks.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  const inline = paragraph.ensureMergeableList("children");
  const content = inline.insertContainer(0, new LoroText());
  content.insert(0, text);
  workspace.doc.commit({ origin: "test" });
}

describe("planPublish card text limit", () => {
  it("should reject a draft whose title and body together exceed the per-card cap", () => {
    // Kills `textChanged = true -> false` and the `title + body -> title - body`
    // bytes mutant: both skip or shrink the per-card cap, so an oversized
    // draft would publish. Each half is under the cap alone: only the combined
    // check can catch this draft.
    const source = new WorkspaceDocument();
    source.ensureDefaultTypes();
    const board = source.ensureView();
    source.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
    writeRich(source, source.getTitle("c1"), "aaaaaa");
    writeRich(source, source.getContent("c1"), "bbbbbb");

    const scope = { scope: "board" as const, boardId: board.id };
    const baseline = projectWorkspace(source, scope).workspace;
    const draft = projectWorkspace(source, scope).workspace;
    writeRich(draft, draft.getTitle("c1"), "dddddd");
    writeRich(draft, draft.getContent("c1"), "cccccc");

    const plan = planPublish(draft, baseline, source, scope, {
      limits: { maxCardTextBytes: 10 },
    });

    expect(plan.unsupported).toMatchObject([{ key: "card:c1:text" }]);
  });

  it("should reject a title-only change that pushes the card over the cap", () => {
    // Kills the title branch's `textChanged = true -> false`: the body is
    // unchanged and under the cap, so only the title branch can flag it.
    const source = new WorkspaceDocument();
    source.ensureDefaultTypes();
    const board = source.ensureView();
    source.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
    writeRich(source, source.getTitle("c1"), "aaaaaaa");
    writeRich(source, source.getContent("c1"), "bbbb");

    const scope = { scope: "board" as const, boardId: board.id };
    const baseline = projectWorkspace(source, scope).workspace;
    const draft = projectWorkspace(source, scope).workspace;
    writeRich(draft, draft.getTitle("c1"), "ccccccc");

    const plan = planPublish(draft, baseline, source, scope, {
      limits: { maxCardTextBytes: 10 },
    });

    expect(plan.unsupported).toMatchObject([{ key: "card:c1:text" }]);
  });

  it("should allow a draft whose card text is exactly at the cap", () => {
    // Kills `bytes > cap -> bytes >= cap`: the boundary itself is publishable.
    const source = new WorkspaceDocument();
    source.ensureDefaultTypes();
    const board = source.ensureView();
    source.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
    writeRich(source, source.getTitle("c1"), "aaaaa");
    writeRich(source, source.getContent("c1"), "bbbbb");

    const scope = { scope: "board" as const, boardId: board.id };
    const baseline = projectWorkspace(source, scope).workspace;
    const draft = projectWorkspace(source, scope).workspace;
    writeRich(draft, draft.getContent("c1"), "ccccc");

    const plan = planPublish(draft, baseline, source, scope, {
      limits: { maxCardTextBytes: 10 },
    });

    expect(plan.unsupported).toEqual([]);
    expect(plan.changes).toMatchObject([{ key: "card:c1:body", kind: "body" }]);
  });
});
