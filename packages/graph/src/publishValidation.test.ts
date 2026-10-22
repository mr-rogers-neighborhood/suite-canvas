import { getType, isContainer, LoroDoc, type LoroList, LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { placementKey, WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import { applyPublish, planPublish, type RichTextSnapshot } from "./merge.js";
import { projectWorkspace } from "./projection.js";
import {
  DEFAULT_PUBLISH_LIMITS,
  MAX_PUBLISH_COORDINATE,
  placementIssue,
  richTextBytes,
  validateRichTextTree,
} from "./publishValidation.js";

const BOARD = "board-1";

function commit(workspace: WorkspaceDocument): void {
  workspace.doc.commit({ origin: "test" });
}

function writeText(workspace: WorkspaceDocument, container: LoroMap, text: string): void {
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
  commit(workspace);
}

function node(parent: LoroList, name: string): LoroMap {
  const map = parent.insertContainer(parent.length, new LoroMap());
  map.set("nodeName", name);
  map.ensureMergeableMap("attributes");
  map.ensureMergeableList("children");
  return map;
}

function addText(blocks: LoroList, text: string): LoroMap {
  const paragraph = node(blocks, "paragraph");
  const inline = paragraph.ensureMergeableList("children");
  const content = inline.insertContainer(0, new LoroText());
  content.insert(0, text);
  return paragraph;
}

/** Rewrites a card body without going through `WorkspaceDocument` writers. */
function rewriteBody(
  workspace: WorkspaceDocument,
  cardId: string,
  build: (blocks: LoroList) => void,
): void {
  const root = workspace.getContent(cardId);
  root.set("nodeName", "doc");
  root.ensureMergeableMap("attributes");
  const blocks = root.ensureMergeableList("children");
  blocks.clear();
  build(blocks);
  commit(workspace);
}

function cardFields(workspace: WorkspaceDocument, cardId: string): LoroMap {
  const value = workspace.doc.getMap(WorkspaceDocument.CARDS_KEY).get(cardId);
  if (!isContainer(value) || getType(value) !== "Map") throw new Error(`no card ${cardId}`);
  return value as LoroMap;
}

function writeProperty(
  workspace: WorkspaceDocument,
  cardId: string,
  fieldId: string,
  value: string | number | boolean,
): void {
  cardFields(workspace, cardId).ensureMergeableMap("properties").set(fieldId, value);
  commit(workspace);
}

function writeMultiSelect(
  workspace: WorkspaceDocument,
  cardId: string,
  fieldId: string,
  optionIds: readonly string[],
): void {
  const values = cardFields(workspace, cardId).ensureMergeableMap("properties");
  const selected = values.ensureMergeableMap(fieldId);
  for (const optionId of optionIds) selected.set(optionId, true);
  commit(workspace);
}

function setup() {
  const source = new WorkspaceDocument();
  source.ensureDefaultTypes();
  source.ensureBoard();
  const text = source.addField("note", { name: "Owner", kind: "text" });
  const count = source.addField("note", { name: "Count", kind: "number" });
  const due = source.addField("note", { name: "Due", kind: "date" });
  const status = source.addField("note", {
    name: "Status",
    kind: "select",
    options: ["Draft", "Done"],
  });
  const labels = source.addField("note", {
    name: "Labels",
    kind: "multiSelect",
    options: ["Red", "Blue"],
  });
  const related = source.addField("note", { name: "Related", kind: "card" });
  const done = source.addField("note", { name: "Done", kind: "checkbox" });

  source.createCard({ id: "c1", boardId: BOARD, position: { x: 10, y: 20 } });
  source.createCard({ id: "c2", boardId: BOARD, position: { x: 200, y: 20 } });
  writeText(source, source.getTitle("c1"), "Alpha");
  writeText(source, source.getContent("c1"), "First body");
  const section = source.createSection({
    boardId: BOARD,
    title: "Plan",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });
  const edge = source.addEdge({ boardId: BOARD, source: "c1", target: "c2" });
  if (!edge) throw new Error("missing edge");

  const scope = { scope: "board", boardId: BOARD } as const;
  const baseline = projectWorkspace(source, scope).workspace;
  const draft = projectWorkspace(source, scope).workspace;
  return {
    source,
    baseline,
    draft,
    scope,
    text,
    count,
    due,
    status,
    labels,
    related,
    done,
    section,
    edge,
  };
}

describe("publish property validation", () => {
  it("should reject a text field holding a number", () => {
    const { source, baseline, draft, scope, text } = setup();
    writeProperty(draft, "c1", text.id, 42);

    const plan = planPublish(draft, baseline, source, scope);

    expect(plan.unsupported.map((entry) => entry.key)).toContain(`card:c1:field:${text.id}`);
    expect(plan.changes).toEqual([]);
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.getCard("c1")?.properties[text.id]).toBeUndefined();
  });

  it("should reject a number field holding a string", () => {
    const { source, baseline, draft, scope, count } = setup();
    writeProperty(draft, "c1", count.id, "12");

    const plan = planPublish(draft, baseline, source, scope);

    expect(plan.unsupported.map((entry) => entry.key)).toContain(`card:c1:field:${count.id}`);
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.getCard("c1")?.properties[count.id]).toBeUndefined();
  });

  it("should reject a checkbox holding a non-boolean", () => {
    const { source, baseline, draft, scope, done } = setup();
    writeProperty(draft, "c1", done.id, "yes");

    const plan = planPublish(draft, baseline, source, scope);

    expect(plan.unsupported.map((entry) => entry.key)).toContain(`card:c1:field:${done.id}`);
    expect(applyPublish(source, draft, plan)).toBe(0);
  });

  it("should reject an unknown select option", () => {
    const { source, baseline, draft, scope, status } = setup();
    writeProperty(draft, "c1", status.id, "ghost-option");

    const plan = planPublish(draft, baseline, source, scope);

    expect(plan.unsupported).toMatchObject([
      { key: `card:c1:field:${status.id}`, kind: "unsupported" },
    ]);
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.getCard("c1")?.properties[status.id]).toBeUndefined();
  });

  it("should reject a multi-select id that no longer exists", () => {
    const { source, baseline, draft, scope, labels } = setup();
    writeMultiSelect(draft, "c1", labels.id, ["ghost-option"]);

    const plan = planPublish(draft, baseline, source, scope);

    expect(plan.unsupported.map((entry) => entry.key)).toContain(`card:c1:field:${labels.id}`);
    expect(applyPublish(source, draft, plan)).toBe(0);
  });

  it("should reject a date that is not a real calendar day", () => {
    const { source, baseline, draft, scope, due } = setup();
    writeProperty(draft, "c1", due.id, "2025-02-30");

    const plan = planPublish(draft, baseline, source, scope);

    expect(plan.unsupported.map((entry) => entry.key)).toContain(`card:c1:field:${due.id}`);
    expect(applyPublish(source, draft, plan)).toBe(0);
  });

  it("should reject a card value pointing at a missing card", () => {
    const { source, baseline, draft, scope, related } = setup();
    writeProperty(draft, "c1", related.id, "missing-card");

    const plan = planPublish(draft, baseline, source, scope);

    expect(plan.unsupported.map((entry) => entry.key)).toContain(`card:c1:field:${related.id}`);
    expect(applyPublish(source, draft, plan)).toBe(0);
  });

  it("should reject a card value pointing at its own card", () => {
    const { source, baseline, draft, scope, related } = setup();
    writeProperty(draft, "c1", related.id, "c1");

    const plan = planPublish(draft, baseline, source, scope);

    expect(plan.unsupported.map((entry) => entry.key)).toContain(`card:c1:field:${related.id}`);
    expect(applyPublish(source, draft, plan)).toBe(0);
  });

  it("should still publish a valid property change", () => {
    const { source, baseline, draft, scope, related, status, labels } = setup();
    draft.setProperty("c1", related.id, "c2");
    draft.setProperty("c1", status.id, status.options[0]?.id ?? "");
    draft.setProperty(
      "c1",
      labels.id,
      labels.options.slice(0, 2).map((option) => option.id),
    );

    const plan = planPublish(draft, baseline, source, scope);

    expect(plan.unsupported).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(applyPublish(source, draft, plan)).toBe(3);
    expect(source.getCard("c1")?.properties[related.id]).toBe("c2");
  });
});

describe("publish rich text validation", () => {
  it("should reject an unknown node name", () => {
    const { source, baseline, draft, scope } = setup();
    rewriteBody(draft, "c1", (blocks) => {
      const paragraph = node(blocks, "paragraph");
      node(paragraph.ensureMergeableList("children"), "script");
    });

    const plan = planPublish(draft, baseline, source, scope);

    expect(plan.unsupported.map((entry) => entry.key)).toContain("card:c1:body");
    expect(plan.changes).toEqual([]);
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.cardText("c1")).toBe("First body");
  });

  it("should reject nesting deeper than the limit", () => {
    const { source, baseline, draft, scope } = setup();
    rewriteBody(draft, "c1", (blocks) => {
      let parent: LoroList = blocks;
      for (let depth = 0; depth < 70; depth += 1) {
        parent = node(parent, "blockquote").ensureMergeableList("children");
      }
      addText(parent, "deep");
    });

    const plan = planPublish(draft, baseline, source, scope);

    expect(plan.unsupported).toMatchObject([{ key: "card:c1:body", kind: "unsupported" }]);
    expect(applyPublish(source, draft, plan)).toBe(0);
  });

  it("should reject text over the byte cap", () => {
    const { source, baseline, draft, scope } = setup();
    rewriteBody(draft, "c1", (blocks) => addText(blocks, "x".repeat(200)));

    const plan = planPublish(draft, baseline, source, scope, {
      limits: { maxCardTextBytes: 64 },
    });

    expect(plan.unsupported).toMatchObject([{ key: "card:c1:body", kind: "unsupported" }]);
    expect(plan.unsupported[0]?.message).toMatch(/limit is 64/);
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.cardText("c1")).toBe("First body");
  });

  it("should keep accepting the editor's own nodes and marks", () => {
    const { source, baseline, draft, scope } = setup();
    rewriteBody(draft, "c1", (blocks) => {
      const heading = node(blocks, "heading");
      heading.ensureMergeableMap("attributes").set("level", 2);
      const inline = heading.ensureMergeableList("children");
      const text = inline.insertContainer(0, new LoroText());
      text.applyDelta([
        { insert: "Bold", attributes: { bold: true } },
        { insert: " link", attributes: { link: "https://example.com" } },
      ]);
      const paragraph = node(blocks, "paragraph");
      const mention = node(paragraph.ensureMergeableList("children"), "mention");
      mention.ensureMergeableMap("attributes").set("cardId", "c2");
    });

    const plan = planPublish(draft, baseline, source, scope);

    expect(plan.unsupported).toEqual([]);
    expect(applyPublish(source, draft, plan)).toBeGreaterThan(0);
    expect(source.cardText("c1")).toContain("Bold link");
  });
});

describe("validateRichTextTree", () => {
  function doc(children: RichTextSnapshot[]): RichTextSnapshot {
    return { nodeName: "doc", attributes: {}, children };
  }

  it("should reject an unknown mark", () => {
    const tree = doc([
      {
        nodeName: "paragraph",
        attributes: {},
        children: [{ $text: [{ insert: "m", attributes: { underline: true } }] }],
      },
    ]);
    expect(validateRichTextTree(tree)).toMatch(/unknown mark "underline"/);
  });

  it("should reject a link that is not http, https or mailto", () => {
    const tree = doc([
      {
        nodeName: "paragraph",
        attributes: {},
        children: [{ $text: [{ insert: "x", attributes: { link: "javascript:alert(1)" } }] }],
      },
    ]);
    expect(validateRichTextTree(tree)).toMatch(/not http, https or mailto/);
  });

  it("should accept a mailto link", () => {
    const tree = doc([
      {
        nodeName: "paragraph",
        attributes: {},
        children: [{ $text: [{ insert: "mail", attributes: { link: "mailto:ada@example.com" } }] }],
      },
    ]);
    expect(validateRichTextTree(tree)).toBeNull();
  });

  it("should accept a link mark bundle with unset options", () => {
    const tree = doc([
      {
        nodeName: "paragraph",
        attributes: {},
        children: [
          {
            $text: [
              {
                insert: "x",
                attributes: { link: { href: "https://example.com", target: null } },
              },
            ],
          },
        ],
      },
    ]);
    expect(validateRichTextTree(tree)).toBeNull();
  });

  it("should reject a node attribute that is not a plain value", () => {
    const tree = doc([
      { nodeName: "heading", attributes: { level: { nested: true } }, children: [] },
    ]);
    expect(validateRichTextTree(tree)).toMatch(/level is not a plain value/);
  });

  it("should reject an unknown node attribute", () => {
    const tree = doc([
      { nodeName: "paragraph", attributes: { textAlign: "center" }, children: [] },
    ]);
    expect(validateRichTextTree(tree)).toMatch(/unknown attribute "textAlign"/);
  });

  it("should accept a root without a node name as the document", () => {
    const tree: RichTextSnapshot = {
      children: [{ nodeName: "paragraph", attributes: {}, children: [{ $text: [] }] }],
    };
    expect(validateRichTextTree(tree)).toBeNull();
  });

  it("should accept an empty root and count text bytes", () => {
    expect(validateRichTextTree({})).toBeNull();
    const tree = doc([
      {
        nodeName: "paragraph",
        attributes: {},
        children: [{ $text: [{ insert: "abc" }] }],
      },
    ]);
    expect(richTextBytes(tree)).toBe(3);
    expect(validateRichTextTree(tree, { ...DEFAULT_PUBLISH_LIMITS, maxCardTextBytes: 2 })).toMatch(
      /limit is 2/,
    );
  });
});

describe("publish geometry and caps", () => {
  it("should reject a non-finite coordinate in the validator", () => {
    expect(placementIssue({ boardId: BOARD, cardId: "c1", x: Number.NaN, y: 0, z: 0 })).toMatch(
      /outside/,
    );
    expect(
      placementIssue({ boardId: BOARD, cardId: "c1", x: 0, y: Number.POSITIVE_INFINITY, z: 0 }),
    ).toMatch(/outside/);
  });

  it("should reject a placement beyond the coordinate bound", () => {
    const { source, baseline, draft, scope } = setup();
    draft.movePlacements(BOARD, [{ cardId: "c1", x: MAX_PUBLISH_COORDINATE + 1, y: 0 }]);

    const plan = planPublish(draft, baseline, source, scope);

    expect(plan.unsupported.map((entry) => entry.key)).toContain(`board:${BOARD}:card:c1`);
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.getPlacement(BOARD, "c1")?.x).toBe(10);
  });

  it("should reject a non-finite placement coordinate", () => {
    const { source, baseline, draft, scope } = setup();
    // Import into a fresh doc before wrapping it, so the corruption lands
    // without a commit event; planning still has to read the stored value.
    const raw = new LoroDoc();
    raw.import(draft.doc.export({ mode: "snapshot" }));
    const corrupted = new WorkspaceDocument(raw);
    const fields = raw.getMap(WorkspaceDocument.PLACEMENTS_KEY).get(placementKey(BOARD, "c1"));
    if (!isContainer(fields) || getType(fields) !== "Map") throw new Error("no placement");
    (fields as LoroMap).set("x", Number.NaN);

    const plan = planPublish(corrupted, baseline, source, scope);

    expect(plan.unsupported.map((entry) => entry.key)).toContain("publish:malformed");
    expect(plan.changes).toEqual([]);
    expect(applyPublish(source, corrupted, plan)).toBe(0);
    expect(source.getPlacement(BOARD, "c1")?.x).toBe(10);
  });

  it("should reject a section outside the coordinate bound", () => {
    const { source, baseline, draft, scope, section } = setup();
    draft.updateSectionGeometry(section.id, {
      x: -MAX_PUBLISH_COORDINATE - 5,
      y: 0,
      width: 400,
      height: 300,
    });

    const plan = planPublish(draft, baseline, source, scope);

    expect(plan.unsupported.map((entry) => entry.key)).toContain(`section:${section.id}`);
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.getSection(section.id)?.x).toBe(0);
  });

  it("should reject a section title over the byte cap", () => {
    const { source, baseline, draft, scope, section } = setup();
    draft.renameSection(section.id, "title".repeat(300));

    const plan = planPublish(draft, baseline, source, scope);

    expect(plan.unsupported.map((entry) => entry.key)).toContain(`section:${section.id}`);
    expect(applyPublish(source, draft, plan)).toBe(0);
  });

  it("should reject an edge label over the byte cap", () => {
    const { source, baseline, draft, scope, edge } = setup();
    draft.setEdgeLabel(edge.id, "L".repeat(600));

    const plan = planPublish(draft, baseline, source, scope);

    expect(plan.unsupported.map((entry) => entry.key)).toContain(`edge:${edge.id}`);
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.getEdge(edge.id)?.label).toBeUndefined();
  });

  it("should reject a draft bigger than the projected size cap", () => {
    const { source, baseline, draft, scope } = setup();
    writeText(draft, draft.getTitle("c1"), "Drafted title");

    const plan = planPublish(draft, baseline, source, scope, { limits: { maxDraftBytes: 8 } });

    expect(plan.unsupported.map((entry) => entry.key)).toContain("publish:size");
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.displayTitle("c1")).toBe("Alpha");
  });
});
