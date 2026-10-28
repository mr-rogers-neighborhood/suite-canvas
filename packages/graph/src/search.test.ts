import { LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import {
  buildSearchText,
  cardSearchText,
  highlightRanges,
  normalizeSearchText,
  searchCards,
  searchTerms,
} from "./search.js";

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
  otherBoardId: string;
}

/** One board with three cards, plus a second board holding a card of its own. */
function fixture(): Fixture {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const otherBoard = workspace.createBoard({ name: "Archive" });

  workspace.createCard({ id: "c1", boardId: board.id, position: { x: 0, y: 0 } });
  addText(workspace.getTitle("c1"), "Mastering the timeline");
  addParagraphs(workspace.getContent("c1"), "A short note about pacing.");

  workspace.createCard({ id: "c2", boardId: board.id, position: { x: 320, y: 0 } });
  addText(workspace.getTitle("c2"), "Interview notes");
  addParagraphs(
    workspace.getContent("c2"),
    "The editor talked about mastering colour grading in the second pass.",
  );

  workspace.createCard({ id: "c3", boardId: otherBoard.id, position: { x: 0, y: 0 } });
  addText(workspace.getTitle("c3"), "Résumé draft");
  addParagraphs(workspace.getContent("c3"), "Café meetings and a long timeline of releases.");

  workspace.doc.commit({ origin: "test" });
  return { workspace, otherBoardId: otherBoard.id };
}

describe("normalizeSearchText", () => {
  it("should lowercase, strip diacritics and collapse whitespace", () => {
    expect(normalizeSearchText("  Café   RÉSUMÉ\n\tnotes ")).toBe("cafe resume notes");
  });
});

describe("searchTerms", () => {
  it("should split on whitespace, normalize and dedupe", () => {
    expect(searchTerms("  Timeline   TIMELINE résumé ")).toEqual(["timeline", "resume"]);
  });

  it("should return nothing for a blank query", () => {
    expect(searchTerms("   ")).toEqual([]);
    expect(searchTerms("")).toEqual([]);
  });
});

describe("a card with a link image", () => {
  it("should be findable by the image's URL and by its alt text", () => {
    const { workspace } = fixture();
    workspace.createCard({
      id: "link",
      boardId: workspace.ensureBoard().id,
      position: { x: 0, y: 0 },
    });
    addText(workspace.getTitle("link"), "Wiring plan");
    const image = addNode(workspace.getContent("link"), "image");
    const attributes = image.ensureMergeableMap("attributes");
    attributes.set("src", "https://cdn.example.com/photos/relay-rack.png");
    attributes.set("alt", "Rack elevation");
    workspace.doc.commit({ origin: "test" });

    const index = buildSearchText(workspace);
    expect(searchCards(index, "rack elevation").map((hit) => hit.id)).toEqual(["link"]);
    expect(searchCards(index, "photos/relay-rack").map((hit) => hit.id)).toEqual(["link"]);
  });
});

describe("buildSearchText", () => {
  it("should index title and body per card in normalized form", () => {
    const { workspace } = fixture();
    const index = buildSearchText(workspace);

    expect(index.get("c1")).toBe("mastering the timeline\na short note about pacing.");
    expect(index.get("c3")).toBe("resume draft\ncafe meetings and a long timeline of releases.");
    expect([...index.keys()].sort()).toEqual(["c1", "c2", "c3"]);
  });

  it("should not index the untitled placeholder", () => {
    const { workspace } = fixture();
    workspace.createCard({ id: "empty" });
    workspace.createCard({ id: "body-only" });
    addParagraphs(workspace.getContent("body-only"), "Kept body");

    // The separator stays even when a half is empty, so the other half keeps its
    // side of the split.
    expect(cardSearchText(workspace, "empty")).toBe("\n");
    expect(cardSearchText(workspace, "body-only")).toBe("\nkept body");
  });
});

describe("searchCards", () => {
  it("should rank a title match above a body match", () => {
    const { workspace } = fixture();
    const hits = searchCards(buildSearchText(workspace), "mastering");

    expect(hits.map((hit) => hit.id)).toEqual(["c1", "c2"]);
    expect(hits[0]?.field).toBe("title");
    expect(hits[1]?.field).toBe("body");
  });

  it("should ignore case and diacritics on both sides", () => {
    const { workspace } = fixture();
    const index = buildSearchText(workspace);

    expect(searchCards(index, "CAFÉ").map((hit) => hit.id)).toEqual(["c3"]);
    expect(searchCards(index, "resume").map((hit) => hit.id)).toEqual(["c3"]);
    expect(searchCards(index, "RÉSUMÉ")[0]?.field).toBe("title");
  });

  it("should require every term, in any field", () => {
    const { workspace } = fixture();
    const index = buildSearchText(workspace);

    // "timeline" is a title word on c1 and a body word on c3.
    expect(searchCards(index, "timeline").map((hit) => hit.id)).toEqual(["c1", "c3"]);
    // Both terms only co-occur on c2.
    expect(searchCards(index, "colour grading").map((hit) => hit.id)).toEqual(["c2"]);
    // One term is missing everywhere, so nothing matches.
    expect(searchCards(index, "colour timeline")).toEqual([]);
  });

  it("should find a card whose body lives on another board", () => {
    const { workspace, otherBoardId } = fixture();
    const index = buildSearchText(workspace);
    const hits = searchCards(index, "cafe");

    expect(hits.map((hit) => hit.id)).toEqual(["c3"]);
    // Board scope stays a facet: the index itself is workspace-wide.
    expect(workspace.listBoardCards(otherBoardId).map((card) => card.id)).toEqual(["c3"]);
  });

  it("should return a snippet window around a body match", () => {
    const { workspace } = fixture();
    const body = workspace.getContent("c1");
    addParagraphs(
      body,
      "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    );
    workspace.doc.commit({ origin: "test" });

    const hit = searchCards(buildSearchText(workspace), "veniam", { snippetRadius: 20 })[0];
    expect(hit?.field).toBe("body");
    expect(hit?.snippet.startsWith("\u2026")).toBe(true);
    expect(hit?.snippet.endsWith("\u2026")).toBe(true);
    expect(hit?.snippet.length).toBeLessThan(20 * 2 + "veniam".length + 3);
    expect(hit?.highlights).toHaveLength(1);
    const range = hit?.highlights[0];
    expect(hit?.snippet.slice(range?.start ?? 0, range?.end ?? 0)).toBe("veniam");
  });

  it("should report the title as the snippet for a title hit", () => {
    const { workspace } = fixture();
    const hit = searchCards(buildSearchText(workspace), "interview")[0];

    expect(hit?.snippet).toBe("interview notes");
    expect(hit?.highlights).toEqual([{ start: 0, end: "interview".length }]);
  });

  it("should return nothing for an empty query", () => {
    const { workspace } = fixture();
    expect(searchCards(buildSearchText(workspace), "")).toEqual([]);
    expect(searchCards(buildSearchText(workspace), "   ")).toEqual([]);
  });

  it("should honour the limit", () => {
    const { workspace } = fixture();
    expect(searchCards(buildSearchText(workspace), "timeline", { limit: 1 })).toHaveLength(1);
  });
});

/**
 * Title-only cards used to index as a bare title with no separator, so
 * `searchCards` read that title as the body: wrong field, body-shaped snippet,
 * empty sort key.
 */
function titleOnlyWorkspace(): WorkspaceDocument {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  for (const [id, title] of [
    ["a-zebra", "Chart zebra"],
    ["b-anchor", "Chart anchor"],
  ] as const) {
    workspace.createCard({ id, boardId: board.id, position: { x: 0, y: 0 } });
    addText(workspace.getTitle(id), title);
  }
  workspace.createCard({ id: "body-only", boardId: board.id, position: { x: 0, y: 0 } });
  addParagraphs(workspace.getContent("body-only"), "Kept body");
  workspace.createCard({ id: "blank", boardId: board.id, position: { x: 0, y: 0 } });
  workspace.doc.commit({ origin: "test" });
  return workspace;
}

describe("a card without a body", () => {
  it("should report a title match as a title hit", () => {
    const hit = searchCards(buildSearchText(titleOnlyWorkspace()), "chart")[0];

    expect(hit?.id).toBe("b-anchor");
    expect(hit?.field).toBe("title");
    expect(hit?.position).toBe(0);
  });

  it("should use the title as the snippet", () => {
    const hit = searchCards(buildSearchText(titleOnlyWorkspace()), "zebra")[0];

    expect(hit?.field).toBe("title");
    expect(hit?.snippet).toBe("chart zebra");
    expect(hit?.highlights).toEqual([{ start: 6, end: 6 + "zebra".length }]);
  });

  it("should sort title-only cards by title, not by an empty key", () => {
    const index = buildSearchText(titleOnlyWorkspace());

    // The ids sort the other way round, so an empty sort key would flip these.
    expect(searchCards(index, "chart").map((hit) => hit.id)).toEqual(["b-anchor", "a-zebra"]);
  });

  it("should keep the empty body beside the separator", () => {
    expect(cardSearchText(titleOnlyWorkspace(), "a-zebra")).toBe("chart zebra\n");
  });
});

describe("a card without a title", () => {
  it("should still report a body match as a body hit", () => {
    const hit = searchCards(buildSearchText(titleOnlyWorkspace()), "kept")[0];

    expect(hit?.id).toBe("body-only");
    expect(hit?.field).toBe("body");
    expect(hit?.snippet).toBe("kept body");
  });

  it("should not surface a card with neither title nor body", () => {
    const index = buildSearchText(titleOnlyWorkspace());

    expect(index.has("blank")).toBe(true);
    for (const term of ["chart", "kept", "blank"]) {
      expect(searchCards(index, term).map((hit) => hit.id)).not.toContain("blank");
    }
  });
});

describe("highlightRanges", () => {
  it("should map matches back to the original spelling", () => {
    const text = "Café RÉSUMÉ notes";
    expect(highlightRanges(text, ["resume"])).toEqual([{ start: 5, end: 11 }]);
    expect(text.slice(5, 11)).toBe("RÉSUMÉ");
    expect(highlightRanges(text, ["cafe", "notes"])).toEqual([
      { start: 0, end: 4 },
      { start: 12, end: 17 },
    ]);
  });

  it("should return no ranges without a match", () => {
    expect(highlightRanges("Timeline", ["grading"])).toEqual([]);
    expect(highlightRanges("Timeline", [])).toEqual([]);
  });
});
