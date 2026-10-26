import { applyProjection, projectWorkspace, WorkspaceDocument } from "@suite/graph";
import { getType, isContainer, LoroDoc, LoroMap, LoroText } from "loro-crdt";
import { describe, expect, it } from "vitest";
import { mirrorWorkspace } from "./mirror.js";

/**
 * Pins the promise an incremental rebuild makes: writing only the difference
 * ends in exactly the document `applyProjection` would have produced, and it
 * writes only as much as the difference needs.
 *
 * The shape below is rendered here rather than imported from the module under
 * test, so equality is checked by an independent walker: a bug that made the
 * mirror and its own comparison agree would still fail against this.
 */

const BOARD_ID = "board-mirror";

type Shape = null | boolean | number | string | number[] | Shape[] | { [key: string]: Shape };

function isMapValue(value: unknown): value is LoroMap {
  return isContainer(value) && getType(value) === "Map";
}

function isTextValue(value: unknown): value is LoroText {
  return isContainer(value) && getType(value) === "Text";
}

/** Every root, rendered with text marks kept and map keys ordered. */
function shape(workspace: WorkspaceDocument): Shape {
  const out: { [key: string]: Shape } = {};
  for (const root of [...WorkspaceDocument.ROOT_KEYS].sort()) {
    out[root] = render(workspace.doc.getMap(root));
  }
  return out;
}

function render(value: unknown): Shape {
  if (isMapValue(value)) {
    const out: { [key: string]: Shape } = {};
    for (const key of [...value.keys()].map(String).sort()) out[key] = render(value.get(key));
    return out;
  }
  if (isTextValue(value)) {
    return { text: value.toString(), runs: value.toDelta().map((run) => JSON.stringify(run)) };
  }
  if (isContainer(value)) {
    const list = value as unknown as { toArray(): unknown[] };
    return list.toArray().map((item) => render(item));
  }
  if (value instanceof Uint8Array) return Array.from(value);
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  return null;
}

function appendText(container: LoroMap, text: string): void {
  const children = container.ensureMergeableList("children");
  const paragraph = children.insertContainer(children.length, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.ensureMergeableMap("attributes");
  paragraph.ensureMergeableList("children").insertContainer(0, new LoroText()).insert(0, text);
}

interface Fixture {
  source: WorkspaceDocument;
  status: ReturnType<WorkspaceDocument["addField"]>;
  tags: { id: string }[];
}

/** A board with the kinds of record a share copies: cards, text, tags, edges. */
function fixture(): Fixture {
  const source = new WorkspaceDocument(new LoroDoc());
  source.ensureDefaultTypes();
  source.markSeeded();
  source.createBoard({ id: BOARD_ID, name: "Mirror board" });
  const status = source.addField("concept", {
    name: "Status",
    kind: "select",
    options: ["Draft", "Active"],
  });
  const tags = [source.createTag({ name: "reading" }), source.createTag({ name: "idea" })];
  source.createSection({
    id: "section-a",
    boardId: BOARD_ID,
    title: "Zone",
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  });
  for (let index = 0; index < 6; index += 1) {
    const id = `card-${String(index)}`;
    source.createCard({
      id,
      typeId: "concept",
      boardId: BOARD_ID,
      position: { x: index * 10, y: index * 5 },
    });
    appendText(source.getTitle(id), `Title ${String(index)}`);
    appendText(source.getContent(id), `Body ${String(index)}`);
  }
  source.addCardTag("card-0", tags[0]?.id ?? "");
  source.addEdge({ boardId: BOARD_ID, source: "card-0", target: "card-1" });
  source.setProperty("card-0", status.id, status.options[0]?.id ?? "");
  return { source, status, tags };
}

function project(source: WorkspaceDocument): WorkspaceDocument {
  return projectWorkspace(source, { scope: "board", boardId: BOARD_ID }).workspace;
}

/** The document a from-scratch rebuild produces, as `applyProjection` builds it. */
function fromScratch(projection: WorkspaceDocument): WorkspaceDocument {
  const room = new WorkspaceDocument(new LoroDoc());
  applyProjection(room, projection);
  return room;
}

/** A live room: whatever the previous projection was, plus a different peer id. */
function liveRoom(previous: WorkspaceDocument): WorkspaceDocument {
  const room = new WorkspaceDocument(new LoroDoc());
  room.doc.setPeerId(4242n);
  applyProjection(room, previous);
  room.doc.commit();
  return room;
}

function updatesSince(workspace: WorkspaceDocument, from: ReturnType<LoroDoc["version"]>): number {
  return workspace.doc.export({ mode: "update", from }).length;
}

/** Whether the document's history moved at all; `compare` is 0 when it did not. */
function moved(workspace: WorkspaceDocument, from: ReturnType<LoroDoc["version"]>): boolean {
  return workspace.doc.version().compare(from) !== 0;
}

describe("mirrorWorkspace", () => {
  it("ends exactly where a from-scratch build ends after every kind of change", () => {
    const { source, status } = fixture();
    const room = liveRoom(project(source));

    // Every shape of change a source can make, in one save round: a move, a
    // new card, a trashed card, a retitle, a body edit, a tag, an edge, a
    // property, a removed edge and a removed section.
    source.placeCard(BOARD_ID, "card-0", { x: 500, y: 500 });
    source.createCard({
      id: "card-new",
      typeId: "concept",
      boardId: BOARD_ID,
      position: { x: 900, y: 90 },
    });
    appendText(source.getTitle("card-new"), "New title");
    appendText(source.getContent("card-new"), "New body");
    source.trashCard("card-2");
    appendText(source.getTitle("card-1"), " extended");
    appendText(source.getContent("card-3"), " plus body");
    source.addCardTag("card-1", "idea");
    source.addEdge({ boardId: BOARD_ID, source: "card-3", target: "card-4" });
    source.setProperty("card-4", status.id, status.options[1]?.id ?? "");
    source.removeEdge(
      source.listBoardEdges(BOARD_ID).find((edge) => edge.target === "card-1")?.id ?? "",
    );
    source.deleteSection("section-a");
    source.doc.commit({ origin: "test:source" });

    const next = project(source);
    mirrorWorkspace(room, next);

    expect(shape(room)).toStrictEqual(shape(fromScratch(next)));
  });

  it("writes nothing when the projection has not changed", () => {
    const { source } = fixture();
    const projection = project(source);
    const room = liveRoom(projection);
    const before = room.doc.version();

    const stats = mirrorWorkspace(room, projection);

    expect(stats).toStrictEqual({ written: 0, removed: 0, kept: expect.any(Number) });
    expect(stats.kept).toBeGreaterThan(0);
    // No ops means no update to send, no save to make and no growth.
    expect(moved(room, before)).toBe(false);
  });

  it("writes one placement for a one-card move instead of the whole board", () => {
    const { source } = fixture();
    const room = liveRoom(project(source));
    const before = room.doc.version();
    const boardBytes = project(source).doc.export({ mode: "snapshot" }).length;

    source.placeCard(BOARD_ID, "card-1", { x: 1_000, y: 2_000 });
    source.doc.commit({ origin: "test:move" });
    const stats = mirrorWorkspace(room, project(source));

    const written = updatesSince(room, before);
    expect(stats.written).toBeLessThanOrEqual(3);
    expect(written).toBeGreaterThan(0);
    // A full rewrite of this board is the whole snapshot; a move is a rounding
    // error next to it. This is the assertion the old clear-and-rewrite failed.
    expect(written).toBeLessThan(boardBytes / 100);
  });

  it("replaces a key whose container changed type", () => {
    const { source } = fixture();
    const projection = project(source);
    const room = fromScratch(projection);

    // A room can hold a key of the wrong kind — an older projection, or a
    // record that moved between a container and a scalar. One key here holds a
    // scalar where the projection has a container, another the reverse; a mirror
    // has to notice the kind changed rather than recurse into it.
    const cards = room.doc.getMap(WorkspaceDocument.CARDS_KEY);
    const first = [...cards.keys()].map(String)[0];
    if (first === undefined) throw new Error("no card to corrupt");
    const card = cards.get(first);
    if (!(card instanceof LoroMap)) throw new Error("card is not a map");
    const containerKey = [...card.entries()]
      .map(([key, value]) => [key, value] as const)
      .find(([, value]) => isContainer(value))?.[0];
    const scalarKey = [...card.entries()]
      .map(([key, value]) => [key, value] as const)
      .find(([, value]) => !isContainer(value) && value !== undefined)?.[0];
    if (containerKey === undefined || scalarKey === undefined) {
      throw new Error("the fixture card has no container and scalar key to swap");
    }
    card.set(containerKey, "a stale scalar where a container belongs");
    card.setContainer(scalarKey, new LoroMap());

    mirrorWorkspace(room, projection);

    expect(shape(room)).toStrictEqual(shape(fromScratch(projection)));
  });

  it("writes a body whose text is unchanged but whose marks are not", () => {
    const { source } = fixture();
    source.setBodyNodes("card-0", [
      { type: "paragraph", content: [{ type: "text", text: "Same words" }] },
    ]);
    source.doc.commit({ origin: "test:body" });
    const room = liveRoom(project(source));
    const before = room.doc.version();

    // The same string, one mark richer. A comparison that only reads the text
    // would see nothing to do and the reader would never see the bold.
    source.setBodyNodes("card-0", [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Same words", marks: [{ type: "bold" }] }],
      },
    ]);
    source.doc.commit({ origin: "test:bold" });
    const next = project(source);
    const stats = mirrorWorkspace(room, next);

    expect(moved(room, before)).toBe(true);
    expect(stats.written).toBeGreaterThan(0);
    expect(shape(room)).toStrictEqual(shape(fromScratch(next)));
  });

  it("removes records the projection no longer has", () => {
    const { source } = fixture();
    const room = liveRoom(project(source));

    source.trashCard("card-4");
    source.doc.commit({ origin: "test:trash" });
    const stats = mirrorWorkspace(room, project(source));

    expect(stats.removed).toBeGreaterThan(0);
    expect(shape(room)).toStrictEqual(shape(fromScratch(project(source))));
  });
});
