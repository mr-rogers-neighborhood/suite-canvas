import { LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { INDEX_ORIGIN, WorkspaceDocument } from "./WorkspaceDocument.js";

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

/** Lets the coalescing microtask run. */
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function setup(cardIds: string[] = ["a", "b"]) {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureView();
  for (const cardId of cardIds) workspace.createCard({ id: cardId, boardId: board.id });
  return { workspace, board };
}

describe("reference index", () => {
  it("should write one entry per changed card", async () => {
    const { workspace } = setup();
    const changes: Array<{ action: string; key: string }> = [];
    workspace.observe((change) => {
      if (change.section === "references") changes.push({ action: change.action, key: change.key });
    });

    appendMention(workspace, workspace.getContent("a"), "b");
    await flush();

    expect(workspace.referencesFor("a")).toEqual(["b"]);
    expect(changes).toEqual([{ action: "add", key: "a" }]);
    expect(workspace.listReferences()).toEqual({ a: ["b"] });
  });

  it("should coalesce several edits into one index write", async () => {
    const { workspace } = setup();
    const commits: string[] = [];
    workspace.doc.subscribe((batch) => {
      if (batch.origin === INDEX_ORIGIN) commits.push(batch.origin);
    });
    const content = workspace.getContent("a");

    appendMention(workspace, content, "b");
    appendMention(workspace, content, "c");
    await flush();

    expect(commits).toHaveLength(1);
    expect(workspace.referencesFor("a")).toEqual(["b", "c"]);
  });

  it("should be idempotent and never schedule itself again", async () => {
    const { workspace } = setup();
    appendMention(workspace, workspace.getContent("a"), "b");
    await flush();

    let indexWrites = 0;
    workspace.doc.subscribe((batch) => {
      if (batch.origin === INDEX_ORIGIN) indexWrites += 1;
    });
    await flush();
    await flush();

    expect(indexWrites).toBe(0);
    expect(workspace.ensureReferences()).toBe(0);
    expect(workspace.ensureReferences()).toBe(0);
  });

  it("should keep reference arrays identity-stable per card", async () => {
    const { workspace } = setup(["a", "b", "c"]);
    appendMention(workspace, workspace.getContent("a"), "b");
    await flush();
    const first = workspace.referencesFor("a");

    appendMention(workspace, workspace.getContent("b"), "c");
    await flush();

    expect(workspace.referencesFor("a")).toBe(first);
    expect(workspace.referencesFor("b")).toEqual(["c"]);
  });

  it("should drop the entry when the last mention is removed", async () => {
    const { workspace } = setup();
    const changes: string[] = [];
    workspace.observe((change) => {
      if (change.section === "references") changes.push(`${change.action}:${change.key}`);
    });
    const content = workspace.getContent("a");
    appendMention(workspace, content, "b");
    await flush();
    expect(workspace.listReferences()).toEqual({ a: ["b"] });

    content.get("children")?.toString();
    const children = content.ensureMergeableList("children");
    children.delete(0, children.length);
    workspace.doc.commit({ origin: "text:body" });
    await flush();

    expect(workspace.referencesFor("a")).toEqual([]);
    expect(workspace.listReferences()).toEqual({});
    expect(changes).toEqual(["add:a", "delete:a"]);
  });

  it("should keep the index out of the structural undo stack", async () => {
    const doc = new LoroDoc();
    doc.getMap("cards").ensureMergeableMap("a");
    doc.getMap("cards").ensureMergeableMap("b");
    doc.getMap("content").ensureMergeableMap("a");
    doc.commit({ origin: "sys:init" });
    const workspace = new WorkspaceDocument(doc);
    expect(workspace.canUndo()).toBe(false);

    appendMention(workspace, workspace.getContent("a"), "b");
    await flush();

    expect(workspace.referencesFor("a")).toEqual(["b"]);
    expect(workspace.canUndo()).toBe(false);
  });

  it("should converge when two clients mention different cards at once", async () => {
    const a = new WorkspaceDocument();
    const board = a.ensureView();
    for (const id of ["hub", "left", "right"]) a.createCard({ id, boardId: board.id });
    const b = new WorkspaceDocument();
    b.importSnapshot(a.exportSnapshot());

    appendMention(a, a.getContent("hub"), "left");
    appendMention(b, b.getContent("hub"), "right");
    await flush();

    const fromA = a.exportUpdate();
    const fromB = b.exportUpdate();
    a.importUpdate(fromB);
    b.importUpdate(fromA);
    await flush();
    a.importUpdate(b.exportUpdate());
    b.importUpdate(a.exportUpdate());
    await flush();

    expect(a.referencesFor("hub")).toEqual(["left", "right"]);
    expect(b.referencesFor("hub")).toEqual(["left", "right"]);
    expect(a.listReferences()).toEqual(b.listReferences());
  });

  it("should repair a corrupted index with ensureReferences", async () => {
    const { workspace } = setup();
    appendMention(workspace, workspace.getContent("a"), "b");
    await flush();

    const index = workspace.doc.getMap("references");
    index.ensureMergeableMap("a").set("ghost", true);
    index.delete("b");
    workspace.doc.commit({ origin: "struct:test" });

    expect(workspace.referencesFor("a")).toEqual(["b", "ghost"]);
    expect(workspace.ensureReferences()).toBe(1);
    expect(workspace.referencesFor("a")).toEqual(["b"]);
    expect(workspace.ensureReferences()).toBe(0);
  });

  it("should rewrite every card with rebuildReferences", async () => {
    const { workspace } = setup();
    appendMention(workspace, workspace.getContent("a"), "b");
    await flush();
    workspace.doc.getMap("references").ensureMergeableMap("a").set("ghost", true);
    workspace.doc.getMap("references").ensureMergeableMap("gone").set("b", true);
    workspace.doc.commit({ origin: "struct:test" });

    expect(workspace.rebuildReferences()).toBe(2);
    expect(workspace.listReferences()).toEqual({ a: ["b"] });
  });

  it("should keep dangling ids and drop the purged card's own entry", async () => {
    const { workspace } = setup();
    appendMention(workspace, workspace.getContent("a"), "b");
    appendMention(workspace, workspace.getContent("b"), "a");
    await flush();

    workspace.purgeCard("b");
    await flush();

    expect(workspace.getCard("b")).toBeUndefined();
    expect(workspace.referencesFor("a")).toEqual(["b"]);
    expect(workspace.referencesFor("b")).toEqual([]);
    expect(workspace.listReferences()).toEqual({ a: ["b"] });
  });

  it("should return plain body text for snippets", () => {
    const { workspace } = setup();
    appendText(workspace, workspace.getContent("a"), "Hello snippet");

    expect(workspace.cardText("a")).toBe("Hello snippet");
    expect(workspace.cardText("missing")).toBe("");
  });

  it("should index mentions in the title as well as the body", async () => {
    const { workspace } = setup();
    const title = workspace.getTitle("a");
    const children = title.ensureMergeableList("children");
    const paragraph = children.insertContainer(children.length, new LoroMap());
    paragraph.set("nodeName", "paragraph");
    paragraph.ensureMergeableMap("attributes");
    const mention = paragraph.ensureMergeableList("children").insertContainer(0, new LoroMap());
    mention.set("nodeName", "mention");
    mention.ensureMergeableMap("attributes").set("cardId", "b");
    workspace.doc.commit({ origin: "text:title" });
    await flush();

    expect(workspace.referencesFor("a")).toEqual(["b"]);
  });
});

describe("card field kind", () => {
  it("should accept an existing id, tolerate a missing one, and clear on null", () => {
    const { workspace } = setup(["a", "b", "target"]);
    const type = workspace.createType({ name: "Relation" });
    const field = workspace.addField(type.id, { name: "Contradicts", kind: "card" });
    workspace.addCardType("a", type.id);

    workspace.setProperty("a", field.id, "target");
    expect(workspace.getCard("a")?.properties[field.id]).toBe("target");

    workspace.setProperty("a", field.id, "purged-card");
    expect(workspace.getCard("a")?.properties[field.id]).toBe("purged-card");

    workspace.setProperty("a", field.id, null);
    expect(workspace.getCard("a")?.properties[field.id]).toBeUndefined();

    expect(() => workspace.setProperty("a", field.id, "")).toThrow();
    expect(() => workspace.setProperty("a", field.id, 7)).toThrow();
  });

  it("should expose card fields through viewCardFields", () => {
    const { workspace } = setup(["a"]);
    const type = workspace.createType({ name: "Relation" });
    const field = workspace.addField(type.id, { name: "Contradicts", kind: "card" });
    workspace.addCardType("a", type.id);
    const card = workspace.getCard("a");
    expect(card).toBeDefined();

    const view = workspace.viewCardFields(card as NonNullable<typeof card>);
    expect(view.some((entry) => entry.field.id === field.id && entry.field.kind === "card")).toBe(
      true,
    );
  });
});
