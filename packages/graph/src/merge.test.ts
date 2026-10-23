import { getType, isContainer, type LoroList, LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { placementKey, WorkspaceDocument } from "./loro/WorkspaceDocument.js";
import {
  applyPublish,
  PUBLISH_ORIGIN,
  type PublishScope,
  planPublish,
  readBodyBlocks,
} from "./merge.js";
import { projectWorkspace } from "./projection.js";
import { mentionTargets } from "./references.js";

const BOARD = "board-1";

function commit(workspace: WorkspaceDocument): void {
  workspace.doc.commit({ origin: "test" });
}

/** Replaces a rich text root with a single paragraph of plain text. */
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

/** A body with a bold run, a mention and a property block, all of which must survive. */
function writeRichBody(workspace: WorkspaceDocument, cardId: string, fieldId: string): void {
  const root = workspace.getContent(cardId);
  root.set("nodeName", "doc");
  root.ensureMergeableMap("attributes");
  const blocks = root.ensureMergeableList("children");
  blocks.clear();

  const paragraph = blocks.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  const inline = paragraph.ensureMergeableList("children");
  const bold = inline.insertContainer(0, new LoroText());
  bold.applyDelta([{ insert: "Bold", attributes: { bold: true } }, { insert: " then plain" }]);
  const mention = inline.insertContainer(inline.length, new LoroMap());
  mention.set("nodeName", "mention");
  mention.ensureMergeableMap("attributes").set("cardId", "c2");
  commit(workspace);

  workspace.appendPropertyBlock(cardId, fieldId);
}

function containerChildren(container: LoroMap | null): LoroList | null {
  const children = container?.get("children");
  return isContainer(children) && getType(children) === "List" ? (children as LoroList) : null;
}

/** Every text delta and every named node in a body, for structure assertions. */
function scanBody(
  workspace: WorkspaceDocument,
  cardId: string,
): {
  deltas: unknown[];
  nodes: string[];
} {
  const deltas: unknown[] = [];
  const nodes: string[] = [];
  const walk = (value: unknown): void => {
    if (!isContainer(value)) return;
    const type = getType(value);
    if (type === "Text") {
      deltas.push((value as LoroText).toDelta());
      return;
    }
    if (type === "List") {
      (value as LoroList).toArray().forEach(walk);
      return;
    }
    if (type !== "Map") return;
    const map = value as LoroMap;
    const name = map.get("nodeName");
    if (typeof name === "string") nodes.push(name);
    for (const [, child] of map.entries()) walk(child);
  };
  walk(workspace.peekContent(cardId));
  return { deltas, nodes };
}

function setup(scope: "board" | "card" = "board") {
  const source = new WorkspaceDocument();
  source.ensureDefaultTypes();
  source.ensureBoard();
  const owner = source.addField("note", { name: "Owner", kind: "text" });
  const tag = source.createTag({ name: "Important" });
  const section = source.createSection({
    boardId: BOARD,
    title: "Plan",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    color: "blue",
  });

  source.createCard({ id: "c1", boardId: BOARD, position: { x: 10, y: 20 } });
  source.createCard({ id: "c2", boardId: BOARD, position: { x: 200, y: 20 } });
  source.createCard({ id: "c3", boardId: BOARD, position: { x: 400, y: 20 } });
  source.createCard({ id: "inbox" });
  source.addCardTag("c1", tag.id);
  source.setProperty("c1", owner.id, "Ada");
  source.updatePlacementSize(BOARD, "c2", { width: 260, height: 180 });
  writeText(source, source.getTitle("c1"), "Alpha");
  writeText(source, source.getContent("c1"), "First body");

  const edge = source.addEdge({ boardId: BOARD, source: "c1", target: "c2" });
  if (!edge) throw new Error("missing edge");

  const options: PublishScope =
    scope === "board" ? { scope: "board", boardId: BOARD } : { scope: "card", cardId: "c1" };
  const baseline = projectWorkspace(source, options).workspace;
  const draft = projectWorkspace(source, options).workspace;

  return { source, baseline, draft, options, owner, tag, section, edge };
}

describe("planPublish", () => {
  it("should plan nothing when the draft matches the baseline", () => {
    const { source, baseline, draft, options } = setup();

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.unsupported).toEqual([]);
    expect(applyPublish(source, draft, plan)).toBe(0);
  });

  it("should keep a source-only title change", () => {
    const { source, baseline, draft, options } = setup();
    writeText(source, source.getTitle("c1"), "Owner version");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.displayTitle("c1")).toBe("Owner version");
  });

  it("should plan a draft title change", () => {
    const { source, baseline, draft, options } = setup();
    writeText(draft, draft.getTitle("c1"), "Drafted");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes).toMatchObject([{ key: "card:c1:title", kind: "title", cardId: "c1" }]);
    expect(plan.values["card:c1:title"]).toMatchObject({ kind: "text" });
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.displayTitle("c1")).toBe("Drafted");
  });

  it("should plan a draft body change", () => {
    const { source, baseline, draft, options } = setup();
    writeText(draft, draft.getContent("c1"), "Drafted body");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes).toMatchObject([{ key: "card:c1:body", kind: "body" }]);
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.cardText("c1")).toContain("Drafted body");
  });

  it("should plan a property change by field id", () => {
    const { source, baseline, draft, options, owner } = setup();
    draft.setProperty("c1", owner.id, "Grace");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes).toMatchObject([
      { key: `card:c1:field:${owner.id}`, kind: "property", fieldId: owner.id },
    ]);
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.getCard("c1")?.properties[owner.id]).toBe("Grace");
  });

  it("should plan clearing a property", () => {
    const { source, baseline, draft, options, owner } = setup();
    draft.setProperty("c1", owner.id, null);

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.values[`card:c1:field:${owner.id}`]).toEqual({ kind: "property", value: null });
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.getCard("c1")?.properties[owner.id]).toBeUndefined();
  });

  it("should plan adding and removing existing tags", () => {
    const { source, baseline, draft, options, tag } = setup();
    draft.addCardTag("c2", tag.id);
    draft.removeCardTag("c1", tag.id);

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes).toMatchObject([
      { key: `card:c1:tag:${tag.id}`, kind: "tag", tagId: tag.id },
      { key: `card:c2:tag:${tag.id}`, kind: "tag", tagId: tag.id },
    ]);
    expect(applyPublish(source, draft, plan)).toBe(2);
    expect(source.getCard("c1")?.tags).toEqual([]);
    expect(source.getCard("c2")?.tags).toEqual([tag.id]);
  });

  it("should plan a placement move, resize and layer change", () => {
    const { source, baseline, draft, options } = setup();
    draft.movePlacements(BOARD, [{ cardId: "c1", x: 60, y: 70 }]);
    draft.updatePlacementSize(BOARD, "c1", { width: 220, height: 140 });
    draft.moveLayer(BOARD, "c1", "front");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes).toMatchObject([{ key: `board:${BOARD}:card:c1`, kind: "placement" }]);
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.getPlacement(BOARD, "c1")).toMatchObject({
      x: 60,
      y: 70,
      width: 220,
      height: 140,
    });
    expect(source.getPlacement(BOARD, "c1")?.z).toBe(draft.getPlacement(BOARD, "c1")?.z);
  });

  it("should plan an unplace that removes only the placement", () => {
    const { source, baseline, draft, options } = setup();
    draft.unplaceCard(BOARD, "c1");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes).toMatchObject([{ key: `board:${BOARD}:card:c1`, kind: "unplace" }]);
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.getPlacement(BOARD, "c1")).toBeUndefined();
    expect(source.getCard("c1")).toBeDefined();
    expect(source.listInboxCards().map((card) => card.id)).toContain("c1");
  });

  it("should plan section title, color and geometry", () => {
    const { source, baseline, draft, options, section } = setup();
    draft.renameSection(section.id, "Renamed");
    draft.setSectionColor(section.id, "rose");
    draft.updateSectionGeometry(section.id, { x: 20, y: 30, width: 500, height: 400 });

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes).toMatchObject([{ key: `section:${section.id}`, kind: "section" }]);
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.getSection(section.id)).toMatchObject({
      title: "Renamed",
      color: "rose",
      x: 20,
      y: 30,
      width: 500,
      height: 400,
    });
  });

  it("should plan edge path, label, direction and endpoint changes", () => {
    const { source, baseline, draft, options, edge } = setup();
    draft.setEdgePath(edge.id, "step");
    draft.setEdgeLabel(edge.id, "see also");
    draft.setEdgeBidirectional(edge.id, true);
    draft.reconnectEdge(edge.id, "target", "c3", undefined);

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes).toMatchObject([{ key: `edge:${edge.id}`, kind: "edge" }]);
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.getEdge(edge.id)).toMatchObject({
      target: "c3",
      path: "step",
      label: "see also",
      bidirectional: true,
    });
  });

  it("should plan removing a baseline edge", () => {
    const { source, baseline, draft, options, edge } = setup();
    draft.removeEdge(edge.id);

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes).toMatchObject([{ key: `edge:${edge.id}`, kind: "edge" }]);
    expect(plan.values[`edge:${edge.id}`]).toEqual({ kind: "remove-edge", edgeId: edge.id });
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.getEdge(edge.id)).toBeUndefined();
  });

  it("should plan clearing a placement size", () => {
    const { source, baseline, draft, options } = setup();
    const fields = draft.doc
      .getMap(WorkspaceDocument.PLACEMENTS_KEY)
      .get(placementKey(BOARD, "c2"));
    if (!fields || !isContainer(fields) || getType(fields) !== "Map")
      throw new Error("no placement");
    (fields as LoroMap).delete("width");
    (fields as LoroMap).delete("height");
    commit(draft);

    const plan = planPublish(draft, baseline, source, options);
    expect(plan.changes).toMatchObject([{ key: `board:${BOARD}:card:c2`, kind: "placement" }]);

    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.getPlacement(BOARD, "c2")).toMatchObject({ x: 200, y: 20 });
    expect(source.getPlacement(BOARD, "c2")?.width).toBeUndefined();
    expect(source.getPlacement(BOARD, "c2")?.height).toBeUndefined();
  });
});

describe("planPublish conflicts", () => {
  it("should reject when the workspace and the draft changed the same title", () => {
    const { source, baseline, draft, options } = setup();
    writeText(draft, draft.getTitle("c1"), "Draft title");
    writeText(source, source.getTitle("c1"), "Owner title");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes).toEqual([]);
    expect(plan.conflicts).toMatchObject([{ key: "card:c1:title", kind: "title" }]);
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.displayTitle("c1")).toBe("Owner title");
  });

  it("should reject when the workspace and the draft changed the same body, property, tag, placement, section or edge", () => {
    const { source, baseline, draft, options, owner, tag, section, edge } = setup();
    writeText(draft, draft.getContent("c1"), "Draft body");
    writeText(source, source.getContent("c1"), "Owner body");
    draft.setProperty("c1", owner.id, "Grace");
    source.setProperty("c1", owner.id, "Hopper");
    draft.removeCardTag("c1", tag.id);
    source.removeCardTag("c1", tag.id);
    draft.movePlacements(BOARD, [{ cardId: "c2", x: 1, y: 1 }]);
    source.movePlacements(BOARD, [{ cardId: "c2", x: 2, y: 2 }]);
    draft.renameSection(section.id, "Draft section");
    source.renameSection(section.id, "Owner section");
    draft.setEdgePath(edge.id, "step");
    source.setEdgePath(edge.id, "smoothstep");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.conflicts.map((conflict) => conflict.key).sort()).toEqual(
      [
        "card:c1:body",
        `card:c1:field:${owner.id}`,
        // Both sides removed the tag: the source is no longer the baseline, and
        // the publish policy rejects any key the source touched.
        `card:c1:tag:${tag.id}`,
        `board:${BOARD}:card:c2`,
        `section:${section.id}`,
        `edge:${edge.id}`,
      ].sort(),
    );
    expect(plan.changes).toEqual([]);
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.cardText("c1")).toContain("Owner body");
    expect(source.getCard("c1")?.properties[owner.id]).toBe("Hopper");
  });

  it("should reject when the workspace removed a placement the draft moved", () => {
    const { source, baseline, draft, options } = setup();
    draft.movePlacements(BOARD, [{ cardId: "c1", x: 5, y: 5 }]);
    source.unplaceCard(BOARD, "c1");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.conflicts).toMatchObject([{ key: `board:${BOARD}:card:c1`, kind: "placement" }]);
  });

  it("should reject when the workspace deleted a card the draft edited", () => {
    const { source, baseline, draft, options } = setup();
    writeText(draft, draft.getTitle("c2"), "Draft title");
    source.purgeCard("c2");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.conflicts).toMatchObject([{ key: "card:c2:title", kind: "title" }]);
    expect(applyPublish(source, draft, plan)).toBe(0);
  });
});

describe("planPublish overwrite", () => {
  it("should publish only the selected title and keep the workspace body", () => {
    const { source, baseline, draft, options } = setup();
    writeText(draft, draft.getTitle("c1"), "Draft title");
    writeText(draft, draft.getContent("c1"), "Draft body");
    writeText(source, source.getTitle("c1"), "Owner title");
    writeText(source, source.getContent("c1"), "Owner body");

    const plan = planPublish(draft, baseline, source, options, {
      overwrite: new Set(["card:c1:title"]),
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.unsupported).toEqual([]);
    expect(plan.changes).toMatchObject([{ key: "card:c1:title", kind: "title" }]);
    // The unselected conflict still captures its draft value, deterministically.
    expect(plan.values["card:c1:body"]).toMatchObject({ kind: "text" });

    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.displayTitle("c1")).toBe("Draft title");
    expect(source.cardText("c1")).toContain("Owner body");
    expect(source.cardText("c1")).not.toContain("Draft body");
  });

  it("should publish a selected property and skip an unselected one", () => {
    const { source, baseline, draft, options, owner } = setup();
    draft.setProperty("c1", owner.id, "Grace");
    source.setProperty("c1", owner.id, "Hopper");

    const plan = planPublish(draft, baseline, source, options, {
      overwrite: new Set([`card:c1:field:${owner.id}`]),
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.changes).toMatchObject([
      { key: `card:c1:field:${owner.id}`, kind: "property", fieldId: owner.id },
    ]);
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.getCard("c1")?.properties[owner.id]).toBe("Grace");
  });

  it("should clear a tag conflict that both sides resolved the same way", () => {
    const { source, baseline, draft, options, tag } = setup();
    draft.removeCardTag("c1", tag.id);
    source.removeCardTag("c1", tag.id);

    const plan = planPublish(draft, baseline, source, options, {
      overwrite: new Set([`card:c1:tag:${tag.id}`]),
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.changes).toMatchObject([{ key: `card:c1:tag:${tag.id}`, kind: "tag" }]);
    expect(plan.values[`card:c1:tag:${tag.id}`]).toEqual({ kind: "tag", present: false });
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.getCard("c1")?.tags).toEqual([]);
  });

  it("should publish a selected placement", () => {
    const { source, baseline, draft, options } = setup();
    draft.movePlacements(BOARD, [{ cardId: "c2", x: 1, y: 1 }]);
    source.movePlacements(BOARD, [{ cardId: "c2", x: 2, y: 2 }]);

    const plan = planPublish(draft, baseline, source, options, {
      overwrite: new Set([`board:${BOARD}:card:c2`]),
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.changes).toMatchObject([{ key: `board:${BOARD}:card:c2`, kind: "placement" }]);
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.getPlacement(BOARD, "c2")).toMatchObject({ x: 1, y: 1 });
  });

  it("should restore a placement the workspace removed when selected", () => {
    const { source, baseline, draft, options } = setup();
    draft.movePlacements(BOARD, [{ cardId: "c1", x: 5, y: 6 }]);
    source.unplaceCard(BOARD, "c1");

    const plan = planPublish(draft, baseline, source, options, {
      overwrite: new Set([`board:${BOARD}:card:c1`]),
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.values[`board:${BOARD}:card:c1`]).toMatchObject({ kind: "placement" });
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.getPlacement(BOARD, "c1")).toMatchObject({ x: 5, y: 6 });
  });

  it("should publish a selected section", () => {
    const { source, baseline, draft, options, section } = setup();
    draft.renameSection(section.id, "Draft section");
    source.renameSection(section.id, "Owner section");

    const plan = planPublish(draft, baseline, source, options, {
      overwrite: new Set([`section:${section.id}`]),
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.changes).toMatchObject([{ key: `section:${section.id}`, kind: "section" }]);
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.getSection(section.id)?.title).toBe("Draft section");
  });

  it("should publish a selected edge", () => {
    const { source, baseline, draft, options, edge } = setup();
    draft.setEdgePath(edge.id, "step");
    source.setEdgePath(edge.id, "smoothstep");

    const plan = planPublish(draft, baseline, source, options, {
      overwrite: new Set([`edge:${edge.id}`]),
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.changes).toMatchObject([{ key: `edge:${edge.id}`, kind: "edge" }]);
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.getEdge(edge.id)?.path).toBe("step");
  });

  it("should keep every workspace value with an empty overwrite set", () => {
    const { source, baseline, draft, options } = setup();
    writeText(draft, draft.getTitle("c1"), "Draft title");
    writeText(source, source.getTitle("c1"), "Owner title");

    const plan = planPublish(draft, baseline, source, options, { overwrite: new Set() });

    expect(plan.conflicts).toEqual([]);
    expect(plan.changes).toEqual([]);
    expect(plan.values["card:c1:title"]).toMatchObject({ kind: "text" });
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.displayTitle("c1")).toBe("Owner title");
  });

  it("should still reject a draft with unsupported changes", () => {
    const { source, baseline, draft, options } = setup();
    writeText(draft, draft.getTitle("c1"), "Draft title");
    writeText(source, source.getTitle("c1"), "Owner title");
    // A non-structural unsupported change: the plan still has a change to make.
    draft.addCardTag("c1", "ghost-tag");

    const plan = planPublish(draft, baseline, source, options, {
      overwrite: new Set(["card:c1:title"]),
    });

    expect(plan.unsupported.map((entry) => entry.key)).toContain("card:c1:tag:ghost-tag");
    expect(plan.conflicts).toEqual([]);
    expect(plan.changes).toMatchObject([{ key: "card:c1:title" }]);
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.displayTitle("c1")).toBe("Owner title");
  });
});

describe("planPublish unsupported", () => {
  it("should reject a draft schema change", () => {
    const { source, baseline, draft, options } = setup();
    draft.addField("note", { name: "Extra", kind: "text" });

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.unsupported).toMatchObject([{ key: "types", kind: "unsupported" }]);
    expect(plan.changes).toEqual([]);
    expect(applyPublish(source, draft, plan)).toBe(0);
  });

  it("should reject a draft tag definition change", () => {
    const { source, baseline, draft, options, tag } = setup();
    draft.renameTag(tag.id, "Urgent");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.unsupported).toMatchObject([{ key: "tags", kind: "unsupported" }]);
  });

  it("should plan a card created in the draft", () => {
    const { source, baseline, draft, options } = setup();
    const created = draft.createCard({ boardId: BOARD, position: { x: 1, y: 1 } });

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.unsupported).toEqual([]);
    expect(plan.changes.map((entry) => entry.key)).toContain(`card:${created.id}:create`);
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.getCard(created.id)).toBeDefined();
  });

  it("should reject a placement the baseline did not have", () => {
    const { source, baseline, draft, options } = setup();
    // A card the projection shows, but which the baseline snapshot says was not
    // on the board: placing it is a board edit the publish cannot replay.
    baseline.unplaceCard(BOARD, "c2");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.unsupported.map((entry) => entry.key)).toContain(`board:${BOARD}:card:c2`);
    expect(applyPublish(source, draft, plan)).toBe(0);
  });

  it("should reject a trashed card", () => {
    const { source, baseline, draft, options } = setup();
    draft.trashCard("c2");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.unsupported.map((entry) => entry.key)).toContain("card:c2");
    expect(applyPublish(source, draft, plan)).toBe(0);
  });

  it("should reject a tag id the shared workspace does not have", () => {
    const { source, baseline, draft, options } = setup();
    draft.addCardTag("c1", "ghost-tag");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.unsupported).toMatchObject([{ key: "card:c1:tag:ghost-tag", kind: "unsupported" }]);
    expect(plan.changes).toEqual([]);
  });

  it("should reject a property field the shared schema does not have", () => {
    const { source, baseline, draft, options } = setup();
    const cards = draft.doc.getMap(WorkspaceDocument.CARDS_KEY);
    const fields = cards.get("c1");
    if (!fields || !isContainer(fields) || getType(fields) !== "Map") throw new Error("no card");
    (fields as LoroMap).ensureMergeableMap("properties").set("ghost-field", "x");
    commit(draft);

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.unsupported).toMatchObject([
      { key: "card:c1:field:ghost-field", kind: "unsupported" },
    ]);
    expect(plan.changes).toEqual([]);
  });

  it("should reject a card-scope draft whose card is trashed", () => {
    const { source, baseline, draft, options } = setup("card");
    draft.trashCard("c1");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.unsupported).toMatchObject([{ key: "card:c1", kind: "unsupported" }]);
    expect(applyPublish(source, draft, plan)).toBe(0);
  });
});

describe("applyPublish", () => {
  it("should apply the values captured when the plan was made", () => {
    const { source, baseline, draft, options } = setup();
    writeText(draft, draft.getTitle("c1"), "Planned");
    const plan = planPublish(draft, baseline, source, options);
    writeText(draft, draft.getTitle("c1"), "Changed after planning");

    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.displayTitle("c1")).toBe("Planned");
  });

  it("should write one commit with the publish origin", () => {
    const { source, baseline, draft, options, owner, section } = setup();
    writeText(draft, draft.getTitle("c1"), "Drafted");
    draft.setProperty("c1", owner.id, "Grace");
    draft.movePlacements(BOARD, [{ cardId: "c1", x: 30, y: 40 }]);
    draft.renameSection(section.id, "Renamed");
    const plan = planPublish(draft, baseline, source, options);

    const origins: string[] = [];
    source.doc.subscribe((batch) => origins.push(batch.origin ?? "none"));

    expect(applyPublish(source, draft, plan)).toBe(4);
    expect(origins).toEqual([PUBLISH_ORIGIN]);
    expect(source.canUndo()).toBe(true);
  });

  it("should preserve mentions, property blocks and marks, and not duplicate containers", () => {
    const { source, baseline, draft, options, owner } = setup();
    writeRichBody(draft, "c1", owner.id);
    const plan = planPublish(draft, baseline, source, options);
    // The draft replaced one block with three, so the changes are per block.
    expect(
      plan.changes.map((change) => change.key).every((key) => key.startsWith("card:c1:body:")),
    ).toBe(true);
    expect(plan.changes.length).toBeGreaterThan(0);
    expect(applyPublish(source, draft, plan)).toBeGreaterThan(0);

    const first = scanBody(source, "c1");
    expect(first.nodes).toEqual([
      "doc",
      "paragraph",
      "mention",
      "paragraph",
      "propertyBlock",
      "paragraph",
    ]);
    expect(first.deltas).toEqual([
      [{ insert: "Bold", attributes: { bold: true } }, { insert: " then plain" }],
    ]);
    expect(mentionTargets([source.peekTitle("c1"), source.peekContent("c1")])).toContain("c2");
    expect(source.bodyPropertyBlocks("c1")).toEqual([owner.id]);

    // The plan's captured values make a second apply a no-op, not a duplicate.
    expect(applyPublish(source, draft, plan)).toBe(0);
    const second = scanBody(source, "c1");
    expect(second.nodes).toEqual(first.nodes);
    expect(second.deltas).toEqual(first.deltas);
    expect(containerChildren(source.peekContent("c1"))?.length).toBe(3);
  });

  it("should ignore off-board cards in a board publish", () => {
    const { source, baseline, draft, options } = setup();
    expect(draft.getCard("inbox")).toBeUndefined();

    writeText(source, source.getTitle("inbox"), "Owner inbox title");
    draft.movePlacements(BOARD, [{ cardId: "c1", x: 11, y: 12 }]);

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes).toMatchObject([{ key: `board:${BOARD}:card:c1` }]);
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.displayTitle("inbox")).toBe("Owner inbox title");
    expect(source.getCard("inbox")).toBeDefined();
  });

  it("should publish only the scoped card for a card share", () => {
    const { source, baseline, draft, options, owner } = setup("card");
    expect(draft.getCard("c2")).toBeUndefined();

    writeText(draft, draft.getTitle("c1"), "Card draft");
    draft.setProperty("c1", owner.id, "Grace");
    writeText(source, source.getTitle("c2"), "Owner c2");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes.map((change) => change.key).sort()).toEqual(
      ["card:c1:title", `card:c1:field:${owner.id}`].sort(),
    );
    expect(plan.conflicts).toEqual([]);

    expect(applyPublish(source, draft, plan)).toBe(2);
    expect(source.displayTitle("c1")).toBe("Card draft");
    expect(source.displayTitle("c2")).toBe("Owner c2");
    expect(source.getPlacement("share-board", "c1")).toBeUndefined();
  });

  it("should write nothing when the plan has conflicts", () => {
    const { source, baseline, draft, options } = setup();
    writeText(draft, draft.getTitle("c1"), "Draft title");
    writeText(source, source.getTitle("c1"), "Owner title");

    const plan = planPublish(draft, baseline, source, options);
    expect(plan.conflicts).not.toEqual([]);

    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.displayTitle("c1")).toBe("Owner title");
  });
});

describe("planPublish creations", () => {
  it("plans and applies a new card with title, body, property, tag and placement", () => {
    const { source, baseline, draft, options, owner, tag } = setup();
    const id = crypto.randomUUID();
    draft.createCard({ id, boardId: BOARD, position: { x: 700, y: 80 } });
    draft.setProperty(id, owner.id, "New value");
    draft.addCardTag(id, tag.id);
    writeText(draft, draft.getTitle(id), "New note");
    writeText(draft, draft.getContent(id), "New body");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.unsupported).toEqual([]);
    expect(plan.changes.map((change) => change.key)).toContain(`card:${id}:create`);
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(source.getCard(id)).toMatchObject({ id, tags: [tag.id] });
    expect(source.getCard(id)?.properties[owner.id]).toBe("New value");
    expect(source.getPlacement(BOARD, id)).toMatchObject({ x: 700, y: 80 });
    expect(source.displayTitle(id)).toBe("New note");
    expect(source.cardText(id)).toContain("New body");
  });

  it("preserves a mention from a new card to another new card", () => {
    const { source, baseline, draft, options } = setup();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    draft.createCard({ id: first, boardId: BOARD, position: { x: 700, y: 80 } });
    draft.createCard({ id: second, boardId: BOARD, position: { x: 900, y: 80 } });
    const root = draft.getContent(first);
    root.set("nodeName", "doc");
    root.ensureMergeableMap("attributes");
    const blocks = root.ensureMergeableList("children");
    const paragraph = blocks.insertContainer(0, new LoroMap());
    paragraph.set("nodeName", "paragraph");
    paragraph.ensureMergeableMap("attributes");
    const inline = paragraph.ensureMergeableList("children");
    const mention = inline.insertContainer(0, new LoroMap());
    mention.set("nodeName", "mention");
    mention.ensureMergeableMap("attributes").set("cardId", second);
    commit(draft);

    const plan = planPublish(draft, baseline, source, options);
    expect(plan.unsupported).toEqual([]);
    expect(applyPublish(source, draft, plan)).toBe(2);
    expect(mentionTargets([source.peekTitle(first), source.peekContent(first)])).toContain(second);
    expect(source.getCard(second)).toBeDefined();
  });

  it("plans a new section and an edge to a new card", () => {
    const { source, baseline, draft, options } = setup();
    const id = crypto.randomUUID();
    draft.createCard({ id, boardId: BOARD, position: { x: 700, y: 80 } });
    const section = draft.createSection({
      boardId: BOARD,
      title: "New section",
      x: 600,
      y: 0,
      width: 300,
      height: 220,
    });
    const edge = draft.addEdge({ boardId: BOARD, source: id, target: "c1" });
    if (!edge) throw new Error("missing draft edge");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.unsupported).toEqual([]);
    expect(plan.changes.map((change) => change.key)).toEqual(
      expect.arrayContaining([
        `card:${id}:create`,
        `section:${section.id}:create`,
        `edge:${edge.id}:create`,
      ]),
    );
    expect(applyPublish(source, draft, plan)).toBe(3);
    expect(source.getSection(section.id)).toBeDefined();
    expect(source.getEdge(edge.id)).toMatchObject({ source: id, target: "c1" });
    expect(source.listBoardEdges(BOARD).map((item) => item.id)).toContain(edge.id);
  });

  it("rejects all creations when one new card is unplaced", () => {
    const { source, baseline, draft, options } = setup();
    const placed = crypto.randomUUID();
    const unplaced = crypto.randomUUID();
    draft.createCard({ id: placed, boardId: BOARD, position: { x: 700, y: 80 } });
    draft.createCard({ id: unplaced });
    writeText(draft, draft.getTitle(unplaced), "Unplaced note");

    const plan = planPublish(draft, baseline, source, options);

    const blocked = plan.unsupported.find((entry) => entry.key === `card:${unplaced}:create`);
    expect(blocked?.label).toBe('Card "Unplaced note"');
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(source.getCard(placed)).toBeUndefined();
  });

  it("rejects a collision with a source-only card id", () => {
    const { source, baseline, draft, options } = setup();
    const id = crypto.randomUUID();
    source.createCard({ id });
    commit(source);
    draft.createCard({ id, boardId: BOARD, position: { x: 700, y: 80 } });

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.unsupported.map((entry) => entry.key)).toContain(`card:${id}:create`);
    expect(applyPublish(source, draft, plan)).toBe(0);
  });

  it("rejects a new card whose tag was removed from the workspace", () => {
    const { source, baseline, draft, options, tag } = setup();
    const id = crypto.randomUUID();
    draft.createCard({ id, boardId: BOARD, position: { x: 700, y: 80 } });
    draft.addCardTag(id, tag.id);
    source.deleteTag(tag.id);
    commit(source);

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.unsupported.map((entry) => entry.key)).toContain(`card:${id}:create`);
    expect(applyPublish(source, draft, plan)).toBe(0);
  });

  it("rejects a new card with a dangling card property", () => {
    const { source, options } = setup();
    const link = source.addField("note", { name: "Link", kind: "card" });
    const baseline = projectWorkspace(source, options).workspace;
    const draft = projectWorkspace(source, options).workspace;
    const id = crypto.randomUUID();
    draft.createCard({ id, boardId: BOARD, position: { x: 700, y: 80 } });
    draft.setProperty(id, link.id, "missing-card");
    commit(draft);

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.unsupported.map((entry) => entry.key)).toContain(`card:${id}:create`);
    expect(applyPublish(source, draft, plan)).toBe(0);
  });
});

// --------------------------------------------------------------- body blocks

/** The body's block list, without creating anything. */
function bodyBlocksOf(workspace: WorkspaceDocument, cardId: string): LoroList {
  const children = containerChildren(workspace.peekContent(cardId));
  if (!children) throw new Error(`no body for ${cardId}`);
  return children;
}

function plainText(value: unknown): string {
  if (!isContainer(value)) return "";
  const type = getType(value);
  if (type === "Text") {
    return (value as LoroText)
      .toDelta()
      .map((op) => (typeof op.insert === "string" ? op.insert : ""))
      .join("");
  }
  if (type === "List") return (value as LoroList).toArray().map(plainText).join("");
  if (type === "Map") {
    return [...(value as LoroMap).entries()]
      .filter(([key]) => key !== "nodeName")
      .map(([, child]) => plainText(child))
      .join("");
  }
  return "";
}

/** One string per top-level block, in document order. */
function bodyTexts(workspace: WorkspaceDocument, cardId: string): string[] {
  return bodyBlocksOf(workspace, cardId)
    .toArray()
    .map((block) => plainText(block).trim());
}

/** Replaces a card's body with one paragraph per entry. */
function writeBlocks(
  workspace: WorkspaceDocument,
  cardId: string,
  paragraphs: readonly string[],
): void {
  const root = workspace.getContent(cardId);
  root.set("nodeName", "doc");
  root.ensureMergeableMap("attributes");
  const blocks = root.ensureMergeableList("children");
  blocks.clear();
  paragraphs.forEach((text, index) => {
    const paragraph = blocks.insertContainer(index, new LoroMap());
    paragraph.set("nodeName", "paragraph");
    paragraph.ensureMergeableMap("attributes");
    const inline = paragraph.ensureMergeableList("children");
    inline.insertContainer(0, new LoroText()).insert(0, text);
  });
  commit(workspace);
}

function blockAt(workspace: WorkspaceDocument, cardId: string, index: number): LoroMap {
  const block = bodyBlocksOf(workspace, cardId).get(index);
  if (!isContainer(block) || getType(block) !== "Map") throw new Error(`no block ${index}`);
  return block as LoroMap;
}

/** Edits one paragraph's text in place, like a keystroke in that block. */
function editBlock(
  workspace: WorkspaceDocument,
  cardId: string,
  index: number,
  text: string,
): void {
  const inline = blockAt(workspace, cardId, index).ensureMergeableList("children");
  inline.clear();
  inline.insertContainer(0, new LoroText()).insert(0, text);
  commit(workspace);
}

function insertBlock(
  workspace: WorkspaceDocument,
  cardId: string,
  index: number,
  text: string,
): void {
  const paragraph = bodyBlocksOf(workspace, cardId).insertContainer(index, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  paragraph.ensureMergeableList("children").insertContainer(0, new LoroText()).insert(0, text);
  commit(workspace);
}

function removeBlock(workspace: WorkspaceDocument, cardId: string, index: number): void {
  bodyBlocksOf(workspace, cardId).delete(index, 1);
  commit(workspace);
}

/** Moves a block by rewriting it elsewhere, which is what an editor's drag does. */
function moveBlock(workspace: WorkspaceDocument, cardId: string, from: number, to: number): void {
  const text = bodyTexts(workspace, cardId)[from] ?? "";
  removeBlock(workspace, cardId, from);
  insertBlock(workspace, cardId, to, text);
}

/** A workspace whose card `c1` has several blocks, plus matching projections. */
function multiBlock(paragraphs: readonly string[]) {
  const { source, options } = setup();
  writeBlocks(source, "c1", paragraphs);
  const baseline = projectWorkspace(source, options).workspace;
  const draft = projectWorkspace(source, options).workspace;
  return { source, baseline, draft, options };
}

describe("readBodyBlocks", () => {
  it("should key a block structurally when two projections copy it", () => {
    const { source, options } = multiBlock(["Intro", "Body"]);
    const other = projectWorkspace(source, options).workspace;

    const left = readBodyBlocks(source, "c1");
    const right = readBodyBlocks(other, "c1");

    // A projection copies the body into fresh containers, so the Loro ids
    // differ; the structural key is the only identity both sides share.
    expect(left.map((block) => block.id)).not.toEqual(right.map((block) => block.id));
    expect(left.map((block) => block.key)).toEqual(right.map((block) => block.key));
    expect(left.map((block) => block.nodeName)).toEqual(["paragraph", "paragraph"]);
  });

  it("should change a block's key when its text changes and keep duplicates apart", () => {
    const { source } = multiBlock(["Same", "Same"]);

    const before = readBodyBlocks(source, "c1");
    expect(before[0]?.key).not.toBe(before[1]?.key);

    editBlock(source, "c1", 1, "Different");

    const after = readBodyBlocks(source, "c1");
    expect(after[0]?.key).toBe(before[0]?.key);
    expect(after[1]?.key).not.toBe(before[1]?.key);
  });
});

describe("planPublish body blocks", () => {
  it("should publish two editors' changes to different paragraphs", () => {
    const { source, baseline, draft, options } = multiBlock(["Intro", "Body", "Outro"]);
    editBlock(draft, "c1", 1, "Editor middle");
    editBlock(source, "c1", 2, "Owner outro");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.conflicts).toEqual([]);
    expect(plan.unsupported).toEqual([]);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0]?.key).toMatch(/^card:c1:body:paragraph:/);
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(bodyTexts(source, "c1")).toEqual(["Intro", "Editor middle", "Owner outro"]);
  });

  it("should conflict on the same paragraph and label the block", () => {
    const { source, baseline, draft, options } = multiBlock([
      "Intro",
      "the deadline slipped twice",
      "Outro",
    ]);
    editBlock(draft, "c1", 1, "Draft deadline");
    editBlock(source, "c1", 1, "Owner deadline");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    const conflict = plan.conflicts[0];
    expect(conflict?.key).toMatch(/^card:c1:body:paragraph:/);
    expect(conflict?.kind).toBe("body");
    expect(conflict?.label).toContain("Alpha");
    expect(conflict?.label).toContain("paragraph: the deadline slipped twice");
    expect(conflict?.label).not.toContain(conflict?.key ?? "");
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(bodyTexts(source, "c1")[1]).toBe("Owner deadline");
  });

  it("should shorten a long block label without losing the start", () => {
    const long = "Launch plan. ".repeat(8);
    const { source, baseline, draft, options } = multiBlock(["Intro", long, "Outro"]);
    editBlock(draft, "c1", 1, "Draft plan");
    editBlock(source, "c1", 1, "Owner plan");

    const plan = planPublish(draft, baseline, source, options);

    const label = plan.conflicts[0]?.label ?? "";
    expect(label).toContain("\u2026");
    expect(label).toContain("Launch plan. Launch plan.");
    expect(label.length).toBeLessThan(80);
  });

  it("should publish a block the draft inserted above an untouched source", () => {
    const { source, baseline, draft, options } = multiBlock(["Intro", "Body", "Outro"]);
    insertBlock(draft, "c1", 1, "Inserted");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.conflicts).toEqual([]);
    expect(plan.changes).toHaveLength(1);
    expect(plan.values[plan.changes[0]?.key ?? ""]).toMatchObject({
      kind: "body-block",
      op: "insert",
    });
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(bodyTexts(source, "c1")).toEqual(["Intro", "Inserted", "Body", "Outro"]);
    // A second apply is a no-op, not a duplicate block.
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(bodyTexts(source, "c1")).toHaveLength(4);
  });

  it("should publish a block only the draft removed", () => {
    const { source, baseline, draft, options } = multiBlock(["Intro", "Body", "Outro"]);
    removeBlock(draft, "c1", 1);

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.conflicts).toEqual([]);
    expect(plan.values[plan.changes[0]?.key ?? ""]).toEqual({
      kind: "body-block",
      op: "remove",
    });
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(bodyTexts(source, "c1")).toEqual(["Intro", "Outro"]);
  });

  it("should conflict when one side removed the block the other edited", () => {
    const { source, baseline, draft, options } = multiBlock(["Intro", "Body", "Outro"]);
    removeBlock(draft, "c1", 1);
    editBlock(source, "c1", 1, "Owner kept this");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]?.label).toContain("paragraph: Body");
    expect(applyPublish(source, draft, plan)).toBe(0);
    expect(bodyTexts(source, "c1")).toEqual(["Intro", "Owner kept this", "Outro"]);
  });

  it("should degrade a reordered draft to one whole-body conflict", () => {
    const { source, baseline, draft, options } = multiBlock(["Intro", "Body", "Outro"]);
    moveBlock(draft, "c1", 0, 1);
    editBlock(source, "c1", 2, "Owner outro");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes).toEqual([]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({ key: "card:c1:body", kind: "body" });
    expect(plan.conflicts[0]?.label).toContain("body");
    expect(plan.values["card:c1:body"]).toMatchObject({ kind: "text" });
    expect(applyPublish(source, draft, plan)).toBe(0);
    // Nothing was guessed: the workspace keeps every paragraph and its order.
    expect(bodyTexts(source, "c1")).toEqual(["Intro", "Body", "Owner outro"]);
  });

  it("should keep the legacy whole-body key for a one-block body", () => {
    const { source, baseline, draft, options } = setup();
    editBlock(draft, "c1", 0, "Drafted body");

    const plan = planPublish(draft, baseline, source, options);

    expect(plan.changes).toMatchObject([{ key: "card:c1:body", kind: "body" }]);
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(bodyTexts(source, "c1")).toEqual(["Drafted body"]);

    editBlock(draft, "c1", 0, "Drafted again");
    editBlock(source, "c1", 0, "Owner body");
    const conflicted = planPublish(draft, baseline, source, options);
    expect(conflicted.conflicts).toMatchObject([{ key: "card:c1:body", kind: "body" }]);
  });

  it("should still let the legacy whole-body key overwrite every block", () => {
    const { source, baseline, draft, options } = multiBlock(["Intro", "Body", "Outro"]);
    editBlock(draft, "c1", 1, "Draft middle");
    editBlock(source, "c1", 1, "Owner middle");
    editBlock(draft, "c1", 2, "Draft outro");
    editBlock(source, "c1", 2, "Owner outro");

    const plan = planPublish(draft, baseline, source, options, {
      overwrite: new Set(["card:c1:body"]),
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.changes).toHaveLength(2);
    expect(applyPublish(source, draft, plan)).toBe(2);
    expect(bodyTexts(source, "c1")).toEqual(["Intro", "Draft middle", "Draft outro"]);
  });

  it("should overwrite one block by its own key and keep the rest of the workspace", () => {
    const { source, baseline, draft, options } = multiBlock(["Intro", "Body", "Outro"]);
    editBlock(draft, "c1", 1, "Draft middle");
    editBlock(source, "c1", 1, "Owner middle");
    editBlock(draft, "c1", 2, "Draft outro");
    editBlock(source, "c1", 2, "Owner outro");

    const first = planPublish(draft, baseline, source, options);
    expect(first.conflicts).toHaveLength(2);
    const selected = first.conflicts.map((conflict) => conflict.key)[0] ?? "";

    const plan = planPublish(draft, baseline, source, options, {
      overwrite: new Set([selected]),
    });

    expect(plan.conflicts).toEqual([]);
    expect(plan.changes).toHaveLength(1);
    expect(applyPublish(source, draft, plan)).toBe(1);
    expect(bodyTexts(source, "c1")).toEqual(["Intro", "Draft middle", "Owner outro"]);
  });

  it("should leave untouched blocks and their containers alone", () => {
    const { source, baseline, draft, options } = multiBlock(["Intro", "Body", "Outro"]);
    editBlock(draft, "c1", 1, "Editor middle");

    const keptBlock = blockAt(source, "c1", 2);
    const keptText = keptBlock.ensureMergeableList("children").get(0);
    if (!isContainer(keptText)) throw new Error("no text container");
    const keptBlockId = String(keptBlock.id);
    const keptTextId = String(keptText.id);
    const introId = String(blockAt(source, "c1", 0).id);

    const touched = new Set<string>();
    const unsubscribe = source.doc.subscribe((batch) => {
      for (const event of batch.events) touched.add(String(event.target));
    });
    const plan = planPublish(draft, baseline, source, options);
    expect(applyPublish(source, draft, plan)).toBe(1);
    unsubscribe();

    // The peer's caret lives in a container, so an unchanged block must keep
    // its own container and see no op at all.
    expect(String(blockAt(source, "c1", 2).id)).toBe(keptBlockId);
    expect(touched.has(keptBlockId)).toBe(false);
    expect(touched.has(keptTextId)).toBe(false);
    expect(touched.has(introId)).toBe(false);
    expect(bodyTexts(source, "c1")).toEqual(["Intro", "Editor middle", "Outro"]);
  });
});
