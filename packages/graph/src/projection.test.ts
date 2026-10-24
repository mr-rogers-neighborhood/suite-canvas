import { getType, isContainer, LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import {
  applyProjection,
  PRIVATE_REFERENCE_TITLE,
  PROJECTION_APPLY_ORIGIN,
  type ProjectionReference,
  projectWorkspace,
  SHARE_BOARD_ID,
} from "./projection.js";
import { sectionMembership } from "./sections.js";

function appendText(workspace: WorkspaceDocument, container: LoroMap, text: string): void {
  const children = container.ensureMergeableList("children");
  const paragraph = children.insertContainer(children.length, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  const inline = paragraph.ensureMergeableList("children");
  const content = inline.insertContainer(0, new LoroText());
  content.insert(0, text);
  workspace.doc.commit({ origin: "text:body" });
}

function appendMention(workspace: WorkspaceDocument, container: LoroMap, cardId: string): void {
  const children = container.ensureMergeableList("children");
  const paragraph = children.insertContainer(children.length, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  const inline = paragraph.ensureMergeableList("children");
  const mention = inline.insertContainer(inline.length, new LoroMap());
  mention.set("nodeName", "mention");
  mention.ensureMergeableMap("attributes").set("cardId", cardId);
  workspace.doc.commit({ origin: "text:body" });
}

function appendPropertyBlock(
  workspace: WorkspaceDocument,
  container: LoroMap,
  fieldId: string,
): void {
  const children = container.ensureMergeableList("children");
  const paragraph = children.insertContainer(children.length, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  const inline = paragraph.ensureMergeableList("children");
  const block = inline.insertContainer(inline.length, new LoroMap());
  block.set("nodeName", "propertyBlock");
  block.ensureMergeableMap("attributes").set("fieldId", fieldId);
  workspace.doc.commit({ origin: "text:body" });
}

function fixture() {
  const source = new WorkspaceDocument();
  source.ensureDefaultTypes();
  source.markSeeded();
  const board = source.ensureView();
  source.renameView(board.id, "Research");
  const privateBoard = source.createView({ name: "Private" });

  const summary = source.addField("concept", { name: "Summary", kind: "text", required: true });
  source.updateField("concept", summary.id, { display: "{value}" });
  const status = source.addField("concept", {
    name: "Status",
    kind: "select",
    options: ["Draft", "Done"],
  });
  const link = source.addField("concept", { name: "Link", kind: "card" });
  const tag = source.createTag({ name: "reading", color: "#f00" });

  source.createCard({ id: "a", typeId: "concept", boardId: board.id, position: { x: 10, y: 20 } });
  source.createCard({ id: "b", typeId: "concept", boardId: board.id, position: { x: 300, y: 40 } });
  source.createCard({ id: "c", typeId: "note" });
  source.createCard({ id: "d", typeId: "concept", boardId: board.id, position: { x: 0, y: 400 } });
  source.trashCard("d");
  source.addCardTag("a", tag.id);

  const draft = source.getType("concept")?.fields.find((field) => field.id === status.id)
    ?.options[0];
  if (!draft) throw new Error("missing select option");
  source.setProperty("a", status.id, draft.id);
  source.setProperty("a", link.id, "b");
  source.setProperty("b", link.id, "a");

  appendText(source, source.getTitle("a"), "Alpha");
  appendText(source, source.getContent("a"), "Body of A");
  appendMention(source, source.getContent("a"), "b");
  appendPropertyBlock(source, source.getContent("a"), summary.id);
  appendText(source, source.getTitle("b"), "Beta");
  appendMention(source, source.getContent("b"), "a");
  appendText(source, source.getTitle("c"), "Gamma");
  appendMention(source, source.getContent("c"), "a");
  appendText(source, source.getTitle("d"), "Trashed");

  const section = source.createSection({
    boardId: board.id,
    title: "Goals",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });
  const otherSection = source.createSection({
    boardId: privateBoard.id,
    title: "Hidden",
    x: 0,
    y: 0,
  });
  const edge = source.addEdge({ boardId: board.id, source: "a", target: "b" });
  if (!edge) throw new Error("missing edge");
  source.setEdgeLabel(edge.id, "links to");

  return {
    source,
    board,
    privateBoard,
    summary,
    status,
    link,
    tag,
    draft,
    section,
    otherSection,
    edge,
  };
}

function isTextLike(value: unknown): value is LoroText {
  return isContainer(value) && getType(value) === "Text";
}

/** First text container anywhere inside a container, depth first. */
function findText(value: unknown): LoroText | null {
  if (isTextLike(value)) return value;
  if (!isContainer(value)) return null;
  const type = getType(value);
  if (type === "Map") {
    for (const entry of (value as LoroMap).values()) {
      const found = findText(entry);
      if (found) return found;
    }
    return null;
  }
  if (type === "List") {
    for (const entry of (value as unknown as { toArray: () => unknown[] }).toArray()) {
      const found = findText(entry);
      if (found) return found;
    }
  }
  return null;
}

const PROJECTION_ROOTS = [
  "boards",
  "cards",
  "placements",
  "edges",
  "types",
  "tags",
  "sections",
  "content",
  "titles",
  "drawings",
  "references",
  "meta",
] as const;

function rootJson(workspace: WorkspaceDocument): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const key of PROJECTION_ROOTS) snapshot[key] = workspace.doc.getMap(key).toJSON();
  return snapshot;
}

/** A source whose card body carries a mark, a mention atom and a field block. */
function markedSource() {
  const source = new WorkspaceDocument();
  source.ensureDefaultTypes();
  const board = source.ensureView();
  const field = source.addField("note", { name: "Status", kind: "select", options: ["Draft"] });
  const option = source.getType("note")?.fields.find((entry) => entry.id === field.id)?.options[0];
  if (!option) throw new Error("missing select option");
  source.createCard({ id: "a", typeId: "note", boardId: board.id, position: { x: 1, y: 2 } });
  source.setProperty("a", field.id, option.id);

  source.doc.configTextStyle({ bold: { expand: "none" } });
  const inline = source.getContent("a").ensureMergeableList("children");
  const paragraph = inline.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  const children = paragraph.ensureMergeableList("children");
  const text = children.insertContainer(0, new LoroText());
  text.insert(0, "Bold body");
  text.mark({ start: 0, end: 4 }, "bold", true);
  const mention = children.insertContainer(1, new LoroMap());
  mention.set("nodeName", "mention");
  mention.ensureMergeableMap("attributes").set("cardId", "a");
  const block = children.insertContainer(2, new LoroMap());
  block.set("nodeName", "propertyBlock");
  block.ensureMergeableMap("attributes").set("fieldId", field.id);
  source.doc.commit({ origin: "text:body" });

  return { source, board, field, option };
}

/**
 * A board whose every reference stays inside it, so the board and selection
 * copy paths can be compared with their reference rows intact.
 */
function equivalenceSource() {
  const source = new WorkspaceDocument();
  source.ensureDefaultTypes();
  const board = source.ensureView();
  const summary = source.addField("note", { name: "Summary", kind: "text" });
  const link = source.addField("note", { name: "Link", kind: "card" });
  const tag = source.createTag({ name: "reading", color: "#0f0" });

  source.createCard({ id: "a", typeId: "note", boardId: board.id, position: { x: 40, y: 40 } });
  source.createCard({ id: "b", typeId: "note", boardId: board.id, position: { x: 600, y: 40 } });
  source.createCard({ id: "c", typeId: "note", boardId: board.id, position: { x: 1200, y: 600 } });
  source.createCard({
    id: "gone",
    typeId: "note",
    boardId: board.id,
    position: { x: 1400, y: 900 },
  });
  source.trashCard("gone");
  source.addCardTag("b", tag.id);
  source.setProperty("a", summary.id, "Alpha summary");
  source.setProperty("a", link.id, "b");

  appendText(source, source.getTitle("a"), "Alpha");
  appendText(source, source.getContent("a"), "Body of A");
  appendMention(source, source.getContent("a"), "b");
  appendText(source, source.getTitle("b"), "Beta");
  appendMention(source, source.getContent("b"), "c");
  appendText(source, source.getTitle("c"), "Gamma");
  appendMention(source, source.getContent("c"), "a");

  const frame = source.createSection({
    boardId: board.id,
    title: "Frame",
    x: 0,
    y: 0,
    width: 1600,
    height: 1000,
  });
  const group = source.createSection({
    boardId: board.id,
    title: "Group",
    x: 20,
    y: 20,
    width: 400,
    height: 400,
  });

  const ab = source.addEdge({ boardId: board.id, source: "a", target: "b" });
  const bc = source.addEdge({ boardId: board.id, source: "b", target: "c" });
  if (!ab || !bc) throw new Error("missing edge");

  return { source, board, frame, group, tag, summary, link, ab, bc };
}

/** A board with nested sections and a card that sits outside every section. */
function sectionedSource() {
  const source = new WorkspaceDocument();
  source.ensureDefaultTypes();
  const board = source.ensureView();
  const outer = source.createSection({
    boardId: board.id,
    title: "Outer",
    x: 0,
    y: 0,
    width: 1000,
    height: 1000,
  });
  const inner = source.createSection({
    boardId: board.id,
    title: "Inner",
    x: 20,
    y: 20,
    width: 300,
    height: 300,
  });
  const empty = source.createSection({
    boardId: board.id,
    title: "Empty",
    x: 2000,
    y: 2000,
    width: 200,
    height: 200,
  });

  source.createCard({ id: "a", typeId: "note", boardId: board.id, position: { x: 40, y: 40 } });
  source.createCard({ id: "b", typeId: "note", boardId: board.id, position: { x: 700, y: 700 } });
  source.createCard({ id: "c", typeId: "note", boardId: board.id, position: { x: 1500, y: 1500 } });

  return { source, board, outer, inner, empty };
}

describe("projectWorkspace", () => {
  describe("board scope", () => {
    it("should copy only the selected board's cards, placements, sections and edges", () => {
      const { source, board, privateBoard, section, edge } = fixture();
      const { workspace } = projectWorkspace(source, { scope: "board", boardId: board.id });

      expect(workspace.listViews().map((entry) => entry.id)).toEqual([board.id]);
      expect(workspace.getView(privateBoard.id)).toBeUndefined();

      expect(
        workspace
          .listCards()
          .map((card) => card.id)
          .sort(),
      ).toEqual(["a", "b"]);
      expect(
        workspace
          .listBoardCards(board.id)
          .map((card) => card.id)
          .sort(),
      ).toEqual(["a", "b"]);
      expect(
        workspace
          .listPlacements()
          .map((placement) => placement.cardId)
          .sort(),
      ).toEqual(["a", "b"]);
      expect(workspace.getPlacement(board.id, "a")?.x).toBe(10);
      expect(workspace.getPlacement(board.id, "b")?.y).toBe(40);

      expect(workspace.listSections(board.id).map((entry) => entry.id)).toEqual([section.id]);
      expect(workspace.listSections(privateBoard.id)).toEqual([]);

      expect(workspace.listEdges()).toEqual(source.listEdges());
      expect(workspace.listEdges()).toEqual([expect.objectContaining({ id: edge.id })]);
      expect(workspace.listEdges()[0]?.label).toBe("links to");
    });

    it("should copy only the types and tags the board's cards use", () => {
      const { source, board, summary, status, tag } = fixture();
      const { workspace } = projectWorkspace(source, { scope: "board", boardId: board.id });

      expect(workspace.listTypes().map((type) => type.id)).toEqual(["concept"]);
      expect(workspace.getType("concept")).toEqual(source.getType("concept"));
      expect(workspace.getType("concept")?.fields.map((field) => field.id)).toEqual(
        source.getType("concept")?.fields.map((field) => field.id),
      );

      const copiedSummary = workspace
        .getType("concept")
        ?.fields.find((field) => field.id === summary.id);
      expect(copiedSummary?.required).toBe(true);
      expect(copiedSummary?.display).toBe("{value}");
      expect(copiedSummary?.order).toBe(summary.order);

      const copiedStatus = workspace
        .getType("concept")
        ?.fields.find((field) => field.id === status.id);
      expect(copiedStatus?.options).toEqual(status.options);
      expect(copiedStatus?.options.map((option) => option.order)).toEqual([0, 1]);

      expect(workspace.listTags()).toEqual([tag]);
    });

    it("should copy card content, properties and mentions", () => {
      const { source, board, status, link, summary, draft } = fixture();
      const { workspace } = projectWorkspace(source, { scope: "board", boardId: board.id });

      expect(workspace.displayTitle("a")).toBe("Alpha");
      expect(workspace.cardText("a")).toContain("Body of A");
      expect(workspace.bodyPropertyBlocks("a")).toEqual([summary.id]);
      expect(workspace.listReferences()).toEqual({ a: ["b"], b: ["a"] });
      expect(workspace.referencesFor("a")).toEqual(["b"]);
      expect(workspace.referencesFor("b")).toEqual(["a"]);

      expect(workspace.getCard("a")?.properties[status.id]).toBe(draft.id);
      expect(workspace.getCard("a")?.properties[link.id]).toBe("b");
      expect(workspace.getCard("b")?.properties[link.id]).toBe("a");
      expect(workspace.getCard("a")?.tags).toEqual(source.getCard("a")?.tags);
    });

    it("should report references to cards outside the board as private and redacted", () => {
      const { source, board } = fixture();
      const { references } = projectWorkspace(source, { scope: "board", boardId: board.id });

      const privateRows = references.filter((row) => row.private);
      expect(privateRows).toEqual<ProjectionReference[]>([
        {
          cardId: "c",
          title: PRIVATE_REFERENCE_TITLE,
          direction: "in",
          kind: "mention",
          private: true,
        },
      ]);
      expect(privateRows.every((row) => row.title !== "Gamma")).toBe(true);
      expect(references.map((row) => row.title)).not.toContain("Gamma");
      expect(
        references.filter((row) => !row.private).map((row) => `${row.cardId}:${row.kind}`),
      ).toEqual([
        "a:arrow",
        "a:mention",
        "a:property",
        "a:mention",
        "a:property",
        "b:mention",
        "b:property",
        "b:arrow",
        "b:mention",
        "b:property",
      ]);
    });

    it("should never expose an off-board title through a board share", () => {
      const { source, board } = fixture();
      const { references } = projectWorkspace(source, { scope: "board", boardId: board.id });

      const titles = new Set(references.map((row) => row.title));
      expect(titles.has("Alpha")).toBe(true);
      expect(titles.has("Beta")).toBe(true);
      expect(titles.has("Gamma")).toBe(false);
      expect(titles.has("Trashed")).toBe(false);
    });

    it("should back an off-board reference with a redacted title stub", () => {
      const { source, board } = fixture();
      const { workspace, references } = projectWorkspace(source, {
        scope: "board",
        boardId: board.id,
      });

      const privateRow = references.find((row) => row.private);
      expect(privateRow?.cardId).toBe("c");
      const stub = workspace.peekTitle("c");
      expect(stub).not.toBeNull();
      expect(workspace.displayTitle("c")).toBe(PRIVATE_REFERENCE_TITLE);
      expect(JSON.stringify(stub?.toJSON())).not.toContain("Gamma");

      // The stub stays a title only: nothing navigable or owned by a card.
      expect(workspace.getCard("c")).toBeUndefined();
      expect(workspace.peekContent("c")).toBeNull();
      expect(workspace.listCardPlacements("c")).toEqual([]);
      expect(workspace.referencesFor("c")).toEqual([]);
      expect(workspace.listCards().map((card) => card.id)).not.toContain("c");
    });

    it("should be deterministic", () => {
      const { source, board } = fixture();
      const first = projectWorkspace(source, { scope: "board", boardId: board.id });
      const second = projectWorkspace(source, { scope: "board", boardId: board.id });

      expect(second.references).toEqual(first.references);
      expect(second.workspace.listCards()).toEqual(first.workspace.listCards());
    });

    it("should reject an unknown board", () => {
      const { source } = fixture();
      expect(() => projectWorkspace(source, { scope: "board", boardId: "missing" })).toThrow(
        /Unknown board/,
      );
    });
  });

  describe("card scope", () => {
    it("should build a share board holding exactly one card", () => {
      const { source, summary, status, tag, draft } = fixture();
      const { workspace } = projectWorkspace(source, { scope: "card", cardId: "a" });

      expect(workspace.listViews()).toEqual([
        expect.objectContaining({ id: SHARE_BOARD_ID, name: "Shared card" }),
      ]);
      expect(workspace.listCards().map((card) => card.id)).toEqual(["a"]);
      expect(workspace.listEdges()).toEqual([]);
      expect(workspace.listSections()).toEqual([]);

      const placement = workspace.listBoardPlacements(SHARE_BOARD_ID)[0];
      expect(placement).toMatchObject({ boardId: SHARE_BOARD_ID, cardId: "a", x: 0, y: 0 });

      expect(workspace.listTypes().map((type) => type.id)).toEqual(["concept"]);
      expect(workspace.listTags()).toEqual([tag]);
      expect(workspace.displayTitle("a")).toBe("Alpha");
      expect(workspace.cardText("a")).toContain("Body of A");
      expect(workspace.bodyPropertyBlocks("a")).toEqual([summary.id]);
      expect(workspace.getCard("a")?.properties[status.id]).toBe(draft.id);
    });

    it("should return private references in both directions with their real titles", () => {
      const { source } = fixture();
      const { workspace, references } = projectWorkspace(source, { scope: "card", cardId: "a" });

      expect(references.length).toBeGreaterThan(0);
      expect(references.every((row) => row.private)).toBe(true);
      expect(references.every((row) => row.title !== PRIVATE_REFERENCE_TITLE)).toBe(true);
      expect(references).toContainEqual({
        cardId: "b",
        title: "Beta",
        direction: "out",
        kind: "mention",
        private: true,
      });
      expect(references).toContainEqual({
        cardId: "b",
        title: "Beta",
        direction: "in",
        kind: "mention",
        private: true,
      });
      expect(references).toContainEqual({
        cardId: "c",
        title: "Gamma",
        direction: "in",
        kind: "mention",
        private: true,
      });
      expect(references).toContainEqual({
        cardId: "b",
        title: "Beta",
        direction: "out",
        kind: "property",
        private: true,
      });
      expect(workspace.listReferences()).toEqual({ a: ["b"] });
    });

    it("should back an out-of-share reference with its real title stub", () => {
      const { source } = fixture();
      const { workspace, references } = projectWorkspace(source, { scope: "card", cardId: "a" });

      expect(references.find((row) => row.cardId === "b")?.title).toBe("Beta");
      expect(workspace.peekTitle("b")).not.toBeNull();
      expect(workspace.displayTitle("b")).toBe("Beta");

      // A stub is not a card: it cannot be opened, edited or navigated to.
      expect(workspace.getCard("b")).toBeUndefined();
      expect(workspace.peekContent("b")).toBeNull();
      expect(workspace.listCardPlacements("b")).toEqual([]);
      expect(workspace.referencesFor("b")).toEqual([]);
      expect(workspace.listCards().map((card) => card.id)).toEqual(["a"]);
    });

    it("should reject a trashed card instead of publishing an empty board", () => {
      const { source } = fixture();
      expect(() => projectWorkspace(source, { scope: "card", cardId: "d" })).toThrow(
        /in the trash/,
      );
    });

    it("should reject an unknown card", () => {
      const { source } = fixture();
      expect(() => projectWorkspace(source, { scope: "card", cardId: "missing" })).toThrow(
        /Unknown card/,
      );
    });
  });

  describe("selection scope", () => {
    it("should copy only the selected cards, their placements and internal edges", () => {
      const { source, board, ab } = equivalenceSource();
      const { workspace } = projectWorkspace(source, {
        scope: "selection",
        boardId: board.id,
        cardIds: ["a", "b"],
      });

      expect(
        workspace
          .listCards()
          .map((card) => card.id)
          .sort(),
      ).toEqual(["a", "b"]);
      expect(
        workspace
          .listBoardPlacements(board.id)
          .map((placement) => placement.cardId)
          .sort(),
      ).toEqual(["a", "b"]);
      expect(workspace.getPlacement(board.id, "a")).toMatchObject({ x: 40, y: 40 });
      expect(workspace.getPlacement(board.id, "b")).toMatchObject({ x: 600, y: 40 });
      expect(workspace.getPlacement(board.id, "c")).toBeUndefined();

      // The b -> c edge leaves the selection, so only a -> b survives.
      expect(workspace.listEdges().map((edge) => edge.id)).toEqual([ab.id]);
    });

    it("should match the board projection when every board card is selected", () => {
      const { source, board } = equivalenceSource();
      const cardIds = source.listBoardCards(board.id).map((card) => card.id);
      const boardShare = projectWorkspace(source, { scope: "board", boardId: board.id });
      const selectionShare = projectWorkspace(source, {
        scope: "selection",
        boardId: board.id,
        cardIds,
      });

      const boardJson = boardShare.workspace.doc.toJSON();
      const selectionJson = selectionShare.workspace.doc.toJSON();
      expect(Object.keys(selectionJson).sort()).toEqual(Object.keys(boardJson).sort());
      expect(selectionJson).toEqual(boardJson);
      expect(rootJson(selectionShare.workspace)).toEqual(rootJson(boardShare.workspace));

      expect(selectionShare.workspace.listCards()).toEqual(boardShare.workspace.listCards());
      expect(selectionShare.workspace.listSections(board.id)).toEqual(
        boardShare.workspace.listSections(board.id),
      );
      expect(selectionShare.workspace.listPlacements()).toEqual(
        boardShare.workspace.listPlacements(),
      );
      expect(selectionShare.workspace.listEdges()).toEqual(boardShare.workspace.listEdges());
      expect(selectionShare.references).toEqual(boardShare.references);
    });

    it("should copy the sections around a selected card and its ancestors", () => {
      const { source, board, outer, inner } = sectionedSource();
      const { workspace } = projectWorkspace(source, {
        scope: "selection",
        boardId: board.id,
        cardIds: ["a"],
      });

      expect(workspace.listSections(board.id).map((section) => section.id)).toEqual([
        outer.id,
        inner.id,
      ]);
      expect(workspace.getSection(outer.id)).toEqual(source.getSection(outer.id));
      expect(workspace.getSection(inner.id)).toEqual(source.getSection(inner.id));
      expect(sectionMembership(workspace.listPlacements(), workspace.listSections())).toEqual(
        new Map([["a", inner.id]]),
      );
    });

    it("should skip sections that hold none of the selected cards", () => {
      const { source, board, outer, inner, empty } = sectionedSource();
      const { workspace } = projectWorkspace(source, {
        scope: "selection",
        boardId: board.id,
        cardIds: ["b"],
      });

      expect(workspace.listSections(board.id).map((section) => section.id)).toEqual([outer.id]);
      expect(workspace.getSection(inner.id)).toBeUndefined();
      expect(workspace.getSection(empty.id)).toBeUndefined();
      expect(sectionMembership(workspace.listPlacements(), workspace.listSections())).toEqual(
        new Map([["b", outer.id]]),
      );

      // A card outside every section projects no section at all.
      const outside = projectWorkspace(source, {
        scope: "selection",
        boardId: board.id,
        cardIds: ["c"],
      });
      expect(outside.workspace.listSections()).toEqual([]);
    });

    it("should keep the real title of a card outside the selection", () => {
      const { source, board } = fixture();
      const { workspace, references } = projectWorkspace(source, {
        scope: "selection",
        boardId: board.id,
        cardIds: ["a"],
      });

      expect(references).toContainEqual({
        cardId: "b",
        title: "Beta",
        direction: "out",
        kind: "mention",
        private: true,
      });
      const stub = workspace.peekTitle("b");
      expect(stub).not.toBeNull();
      expect(workspace.displayTitle("b")).toBe("Beta");
      expect(JSON.stringify(stub?.toJSON())).toContain("Beta");

      // The stub stays non-navigable, exactly like a card share's.
      expect(workspace.getCard("b")).toBeUndefined();
      expect(workspace.peekContent("b")).toBeNull();
      expect(workspace.listCardPlacements("b")).toEqual([]);
      expect(workspace.referencesFor("b")).toEqual([]);
    });

    it("should ignore ids that are not on the board", () => {
      const { source, board } = fixture();
      const { workspace } = projectWorkspace(source, {
        scope: "selection",
        boardId: board.id,
        cardIds: ["a", "c", "missing"],
      });

      expect(workspace.listCards().map((card) => card.id)).toEqual(["a"]);
      expect(workspace.listPlacements()).toEqual([
        expect.objectContaining({ boardId: board.id, cardId: "a" }),
      ]);
    });

    it("should project an empty board when every selected card left the board", () => {
      const { source, board } = fixture();
      source.trashCard("a");
      source.unplaceCard(board.id, "b");

      const { workspace } = projectWorkspace(source, {
        scope: "selection",
        boardId: board.id,
        cardIds: ["a", "b"],
      });

      expect(workspace.getView(board.id)).toBeDefined();
      expect(workspace.listCards()).toEqual([]);
      expect(workspace.listPlacements()).toEqual([]);
      expect(workspace.listEdges()).toEqual([]);
      expect(workspace.listSections()).toEqual([]);
    });

    it("should reject an empty selection", () => {
      const { source, board } = fixture();
      expect(() =>
        projectWorkspace(source, { scope: "selection", boardId: board.id, cardIds: [] }),
      ).toThrow(/at least one card/);
    });
  });

  describe("deletion", () => {
    it("should omit a card that is no longer placed on the board", () => {
      const { source, board } = fixture();
      source.unplaceCard(board.id, "b");

      const { workspace } = projectWorkspace(source, { scope: "board", boardId: board.id });
      expect(workspace.getCard("b")).toBeUndefined();
      expect(workspace.getPlacement(board.id, "b")).toBeUndefined();
      expect(workspace.listEdges()).toEqual([]);
      expect(workspace.listCards().map((card) => card.id)).toEqual(["a"]);
    });

    it("should omit a trashed card and its placement", () => {
      const { source, board } = fixture();
      const { workspace } = projectWorkspace(source, { scope: "board", boardId: board.id });

      expect(workspace.getCard("d")).toBeUndefined();
      expect(workspace.getPlacement(board.id, "d")).toBeUndefined();
      expect(workspace.listCards().map((card) => card.id)).not.toContain("d");
    });
  });

  describe("snapshot", () => {
    it("should read the same after a snapshot round trip", () => {
      const { source, board } = fixture();
      const { workspace } = projectWorkspace(source, { scope: "board", boardId: board.id });
      const bytes = workspace.doc.export({ mode: "snapshot" });

      const restored = new WorkspaceDocument(new LoroDoc());
      restored.doc.import(bytes);

      expect(restored.listViews()).toEqual(workspace.listViews());
      expect(restored.listPlacements()).toEqual(workspace.listPlacements());
      expect(restored.listSections(board.id)).toEqual(workspace.listSections(board.id));
      expect(restored.listEdges()).toEqual(workspace.listEdges());
      expect(restored.listTypes()).toEqual(workspace.listTypes());
      expect(restored.listTags()).toEqual(workspace.listTags());
      expect(restored.listCards().sort((a, b) => a.id.localeCompare(b.id))).toEqual(
        workspace.listCards().sort((a, b) => a.id.localeCompare(b.id)),
      );
      expect(restored.displayTitle("a")).toBe("Alpha");
      expect(restored.cardText("a")).toBe(workspace.cardText("a"));
      expect(restored.referencesFor("a")).toEqual(["b"]);
      expect(restored.hasSeeded()).toBe(true);
      expect(restored.doc.getMap("meta").get("schemaVersion")).toBe(SCHEMA_VERSION);
    });

    it("should round-trip a card projection", () => {
      const { source } = fixture();
      const { workspace } = projectWorkspace(source, { scope: "card", cardId: "a" });
      const bytes = workspace.doc.export({ mode: "snapshot" });

      const restored = new WorkspaceDocument(new LoroDoc());
      restored.doc.import(bytes);

      expect(restored.listViews()).toEqual(workspace.listViews());
      expect(restored.listCards()).toEqual(workspace.listCards());
      expect(restored.listBoardPlacements(SHARE_BOARD_ID)).toEqual(
        workspace.listBoardPlacements(SHARE_BOARD_ID),
      );
      expect(restored.displayTitle("a")).toBe("Alpha");
      expect(restored.getType("concept")).toEqual(workspace.getType("concept"));
    });
  });
});

describe("applyProjection", () => {
  it("should replace every root so the latest projection wins", () => {
    const { source, board } = fixture();
    const first = projectWorkspace(source, { scope: "board", boardId: board.id });
    const target = new WorkspaceDocument(new LoroDoc());
    applyProjection(target, first.workspace);

    expect(
      target
        .listCards()
        .map((card) => card.id)
        .sort(),
    ).toEqual(["a", "b"]);
    expect(
      target
        .listBoardCards(board.id)
        .map((card) => card.id)
        .sort(),
    ).toEqual(["a", "b"]);

    source.placeCard(board.id, "a", { x: 500, y: 600 });
    source.unplaceCard(board.id, "b");
    source.createCard({ id: "e", typeId: "note", boardId: board.id, position: { x: 7, y: 8 } });
    const second = projectWorkspace(source, { scope: "board", boardId: board.id });
    applyProjection(target, second.workspace);

    expect(rootJson(target)).toEqual(rootJson(second.workspace));
    expect(
      target
        .listCards()
        .map((card) => card.id)
        .sort(),
    ).toEqual(["a", "e"]);
    expect(target.getPlacement(board.id, "b")).toBeUndefined();
    expect(target.getPlacement(board.id, "a")).toMatchObject({ x: 500, y: 600 });
    expect(target.listEdges()).toEqual([]);
  });

  it("should keep rich text, mention atoms and field ids across a rebuild", () => {
    const { source, board, field, option } = markedSource();
    const projection = projectWorkspace(source, { scope: "board", boardId: board.id });
    const target = new WorkspaceDocument(new LoroDoc());
    applyProjection(target, projection.workspace);

    const expected = findText(source.peekContent("a"));
    const actual = findText(target.peekContent("a"));
    expect(expected?.toDelta()).toEqual([
      { insert: "Bold", attributes: { bold: true } },
      { insert: " body" },
    ]);
    expect(actual?.toDelta()).toEqual(expected?.toDelta());
    expect(target.getCard("a")?.properties[field.id]).toBe(option.id);
    expect(
      target.getType("note")?.fields.find((entry) => entry.id === field.id)?.options[0]?.id,
    ).toBe(option.id);
    expect(JSON.stringify(rootJson(target).content)).toContain('"cardId":"a"');
    expect(rootJson(target).content).toEqual(rootJson(projection.workspace).content);

    // Rebuilding again must not duplicate the nested containers.
    applyProjection(target, projection.workspace);
    expect(rootJson(target)).toEqual(rootJson(projection.workspace));
    expect(findText(target.peekContent("a"))?.toDelta()).toEqual(expected?.toDelta());
  });

  it("should not mutate the projection it copies from", () => {
    const { source, board } = fixture();
    const projection = projectWorkspace(source, { scope: "board", boardId: board.id });
    const before = rootJson(projection.workspace);
    const version = projection.workspace.doc.version().toJSON();

    const target = new WorkspaceDocument(new LoroDoc());
    applyProjection(target, projection.workspace);
    applyProjection(target, projection.workspace);

    expect(rootJson(projection.workspace)).toEqual(before);
    expect(projection.workspace.doc.version().toJSON()).toEqual(version);
  });

  it("should drop cards the new projection no longer has", () => {
    const { source, board } = fixture();
    const target = new WorkspaceDocument(new LoroDoc());
    applyProjection(
      target,
      projectWorkspace(source, { scope: "board", boardId: board.id }).workspace,
    );
    expect(target.getCard("b")).toBeDefined();

    source.purgeCard("b");
    applyProjection(
      target,
      projectWorkspace(source, { scope: "board", boardId: board.id }).workspace,
    );

    expect(target.getCard("b")).toBeUndefined();
    expect(target.peekContent("b")).toBeNull();
    // A's dangling mention still names b, so only the redacted title stub stays.
    expect(target.displayTitle("b")).toBe(PRIVATE_REFERENCE_TITLE);
    expect(target.getPlacement(board.id, "b")).toBeUndefined();
    // The mention in A's body keeps its dangling target, as in the projection.
    expect(target.referencesFor("a")).toEqual(["b"]);
  });

  it("should commit the rebuild once, under the projection origin", () => {
    const { source, board } = fixture();
    const target = new WorkspaceDocument(new LoroDoc());
    const origins: string[] = [];
    target.doc.subscribe((batch) => {
      if (batch.origin) origins.push(batch.origin);
    });

    applyProjection(
      target,
      projectWorkspace(source, { scope: "board", boardId: board.id }).workspace,
    );

    expect(origins).toEqual([PROJECTION_APPLY_ORIGIN]);
  });

  it("should replace reference title stubs on rebuild without stale titles", () => {
    const first = new WorkspaceDocument();
    first.createCard({ id: "shared" });
    first.createCard({ id: "x" });
    appendText(first, first.getTitle("shared"), "Shared");
    appendMention(first, first.getContent("shared"), "x");
    appendText(first, first.getTitle("x"), "X-ray");

    const target = new WorkspaceDocument(new LoroDoc());
    applyProjection(target, projectWorkspace(first, { scope: "card", cardId: "shared" }).workspace);
    expect(target.peekTitle("x")).not.toBeNull();
    expect(target.displayTitle("x")).toBe("X-ray");
    expect(target.getCard("x")).toBeUndefined();

    const second = new WorkspaceDocument();
    second.createCard({ id: "shared" });
    second.createCard({ id: "y" });
    appendText(second, second.getTitle("shared"), "Shared");
    appendMention(second, second.getContent("shared"), "y");
    appendText(second, second.getTitle("y"), "Yankee");

    applyProjection(
      target,
      projectWorkspace(second, { scope: "card", cardId: "shared" }).workspace,
    );

    expect(target.peekTitle("y")).not.toBeNull();
    expect(target.displayTitle("y")).toBe("Yankee");
    expect(target.peekTitle("x")).toBeNull();
    expect(target.displayTitle("x")).toBe("Untitled");
    expect(target.getCard("x")).toBeUndefined();
    expect(target.referencesFor("shared")).toEqual(["y"]);
  });

  it("should switch a live room from a board projection to a card projection", () => {
    const { source, board } = fixture();
    const target = new WorkspaceDocument(new LoroDoc());
    applyProjection(
      target,
      projectWorkspace(source, { scope: "board", boardId: board.id }).workspace,
    );

    const card = projectWorkspace(source, { scope: "card", cardId: "c" });
    applyProjection(target, card.workspace);

    expect(rootJson(target)).toEqual(rootJson(card.workspace));
    expect(target.listCards().map((entry) => entry.id)).toEqual(["c"]);
    expect(rootJson(target).content).toEqual(rootJson(card.workspace).content);
  });
});
