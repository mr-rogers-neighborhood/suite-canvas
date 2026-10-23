import { LoroDoc, LoroMap, type Value } from "loro-crdt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PIN_LABEL_MAX_LENGTH } from "../pins.js";
import { emptyViewQuery, type ViewQuery } from "../views.js";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureBoard();
  return { workspace, board };
}

function sync(a: LoroDoc, b: LoroDoc): void {
  const fromA = a.export({ mode: "update" });
  const fromB = b.export({ mode: "update" });
  b.import(fromA);
  a.import(fromB);
}

function emptyQuery(): ViewQuery {
  return emptyViewQuery();
}

/** Writes raw pin fields, standing in for a hand-edited or older client. */
function writeRawPin(workspace: WorkspaceDocument, id: string, fields: Record<string, unknown>) {
  const map = workspace.doc.getMap(WorkspaceDocument.PINS_KEY).ensureMergeableMap(id);
  for (const [key, value] of Object.entries(fields)) map.set(key, value as Value);
  workspace.doc.commit({ origin: "test" });
}

describe("pins", () => {
  it("round-trips a pin through the document", () => {
    const { workspace, board } = setup();
    const pin = workspace.createPin({
      id: "pin-1",
      boardId: board.id,
      x: 120,
      y: 240,
      label: "  Chapter two  ",
      color: "blue",
      createdBy: "user-1",
    });

    expect(pin).toEqual({
      id: "pin-1",
      boardId: board.id,
      x: 120,
      y: 240,
      label: "Chapter two",
      color: "blue",
      createdBy: "user-1",
      createdAt: expect.any(Number),
    });
    expect(workspace.getPin("pin-1")).toEqual(pin);
    expect(workspace.listPins()).toEqual([pin]);
    expect(workspace.doc.toJSON()).toHaveProperty([WorkspaceDocument.PINS_KEY, "pin-1"]);
  });

  it("defaults the colour and lists pins per board", () => {
    const { workspace, board } = setup();
    const other = workspace.createBoard({ name: "Other" });
    workspace.createPin({
      id: "here",
      boardId: board.id,
      x: 0,
      y: 0,
      label: "Here",
      createdBy: "u",
    });
    workspace.createPin({
      id: "there",
      boardId: other.id,
      x: 0,
      y: 0,
      label: "There",
      color: "rose",
      createdBy: "u",
    });

    expect(workspace.getPin("here")?.color).toBe("amber");
    expect(workspace.listPins(board.id).map((pin) => pin.id)).toEqual(["here"]);
    expect(workspace.listPins().map((pin) => pin.id)).toEqual(["here", "there"]);
  });

  it("orders pins by creation time, then id", () => {
    const { workspace, board } = setup();
    vi.useFakeTimers();

    vi.setSystemTime(2_000);
    workspace.createPin({ id: "b", boardId: board.id, x: 0, y: 0, label: "B", createdBy: "u" });
    vi.setSystemTime(1_000);
    workspace.createPin({ id: "a", boardId: board.id, x: 0, y: 0, label: "A", createdBy: "u" });
    vi.setSystemTime(1_000);
    workspace.createPin({ id: "c", boardId: board.id, x: 0, y: 0, label: "C", createdBy: "u" });

    expect(workspace.listPins().map((pin) => pin.id)).toEqual(["a", "c", "b"]);
    expect(workspace.listPins().map((pin) => pin.createdAt)).toEqual([1_000, 1_000, 2_000]);
  });

  it("refuses an unknown board", () => {
    const { workspace } = setup();

    expect(() =>
      workspace.createPin({ boardId: "nope", x: 0, y: 0, label: "Lost", createdBy: "u" }),
    ).toThrow(/Unknown board/);
    expect(workspace.listPins()).toEqual([]);
  });

  it("enforces the label bounds", () => {
    const { workspace, board } = setup();
    const base = { boardId: board.id, x: 0, y: 0, createdBy: "u" };

    expect(() => workspace.createPin({ ...base, label: "   " })).toThrow();
    expect(() =>
      workspace.createPin({ ...base, label: "x".repeat(PIN_LABEL_MAX_LENGTH + 1) }),
    ).toThrow();

    const pin = workspace.createPin({ ...base, label: "x".repeat(PIN_LABEL_MAX_LENGTH) });
    expect(pin.label).toHaveLength(PIN_LABEL_MAX_LENGTH);
    expect(() => workspace.updatePin(pin.id, { label: "" })).toThrow();
    expect(workspace.getPin(pin.id)?.label).toHaveLength(PIN_LABEL_MAX_LENGTH);
  });

  it("keeps each target variant, retargets and clears it", () => {
    const { workspace, board } = setup();
    const card = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    const section = workspace.createSection({ boardId: board.id, x: 0, y: 0 });
    const view = workspace.createView({ name: "Timeline", query: emptyQuery() });

    for (const [kind, id] of [
      ["card", card.id],
      ["section", section.id],
      ["view", view.id],
    ] as const) {
      const pin = workspace.createPin({
        id: `pin-${kind}`,
        boardId: board.id,
        x: 10,
        y: 20,
        label: `To the ${kind}`,
        createdBy: "u",
        target: { kind, id },
      });

      expect(workspace.getPin(pin.id)?.target).toEqual({ kind, id });
    }

    workspace.updatePin("pin-card", { target: { kind: "view", id: view.id } });
    expect(workspace.getPin("pin-card")?.target).toEqual({ kind: "view", id: view.id });

    const moved = workspace.updatePin("pin-card", { target: null });
    expect(moved?.target).toBeUndefined();
    expect(workspace.getPin("pin-card")).toMatchObject({ x: 10, y: 20, label: "To the card" });
  });

  it("renames, recolours, moves and deletes without touching the target", () => {
    const { workspace, board } = setup();
    const card = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    const pin = workspace.createPin({
      id: "pin-1",
      boardId: board.id,
      x: 0,
      y: 0,
      label: "Start",
      createdBy: "u",
      target: { kind: "card", id: card.id },
    });

    const renamed = workspace.updatePin("pin-1", { label: "Finish", color: "violet" });
    expect(renamed).toMatchObject({
      label: "Finish",
      color: "violet",
      x: 0,
      y: 0,
      target: { kind: "card", id: card.id },
    });

    expect(workspace.movePin("pin-1", { x: 300, y: 400 })).toMatchObject({ x: 300, y: 400 });
    expect(workspace.getPin("pin-1")).toMatchObject({
      label: "Finish",
      color: "violet",
      x: 300,
      y: 400,
    });

    workspace.deletePin("pin-1");
    expect(workspace.getPin("pin-1")).toBeUndefined();
    expect(workspace.listPins()).toEqual([]);
    expect(pin.id).toBe("pin-1");
  });

  it("undoes a move as one step and keeps the pin's place in the list", () => {
    const { workspace, board } = setup();
    const pin = workspace.createPin({
      boardId: board.id,
      x: 10,
      y: 10,
      label: "Spot",
      createdBy: "u",
    });

    workspace.movePin(pin.id, { x: 50, y: 60 });
    workspace.undo();

    expect(workspace.getPin(pin.id)).toMatchObject({ x: 10, y: 10 });
    expect(workspace.listPins().map((entry) => entry.id)).toEqual([pin.id]);
  });

  it("ignores a non-finite move", () => {
    const { workspace, board } = setup();
    const pin = workspace.createPin({
      boardId: board.id,
      x: 10,
      y: 10,
      label: "Spot",
      createdBy: "u",
    });

    expect(workspace.movePin(pin.id, { x: Number.NaN, y: 0 })).toEqual(pin);
    expect(workspace.getPin(pin.id)).toEqual(pin);
  });

  it("notifies pin observers for every write and stops after unsubscribe", () => {
    const { workspace, board } = setup();
    const listener = vi.fn();
    const stop = workspace.observePins(listener);
    const before = workspace.pinsRevision;

    const pin = workspace.createPin({
      boardId: board.id,
      x: 0,
      y: 0,
      label: "Watch",
      createdBy: "u",
    });
    expect(listener).toHaveBeenCalledTimes(1);

    workspace.updatePin(pin.id, { label: "Watched" });
    workspace.movePin(pin.id, { x: 1, y: 2 });
    workspace.deletePin(pin.id);

    expect(listener).toHaveBeenCalledTimes(4);
    expect(workspace.pinsRevision).toBe(before + 4);

    stop();
    workspace.createPin({ boardId: board.id, x: 0, y: 0, label: "After", createdBy: "u" });
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("creates no card, placement, reference or section for a targeted pin", () => {
    const { workspace, board } = setup();
    const card = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    workspace.ensureReferences();
    const cards = workspace.listCards().length;
    const placements = workspace.listPlacements().length;

    workspace.createPin({
      boardId: board.id,
      x: 5,
      y: 5,
      label: "Remember this",
      createdBy: "u",
      target: { kind: "card", id: card.id },
    });

    expect(workspace.listCards()).toHaveLength(cards);
    expect(workspace.listPlacements()).toHaveLength(placements);
    expect(workspace.listSections()).toEqual([]);
    expect(workspace.referencesFor(card.id)).toEqual([]);
    expect(workspace.getCard(card.id)?.tags).toEqual([]);
  });

  it("removes a board's pins with the board", () => {
    const { workspace, board } = setup();
    workspace.createPin({
      id: "gone",
      boardId: board.id,
      x: 0,
      y: 0,
      label: "Here",
      createdBy: "u",
    });

    workspace.deleteBoard(board.id);

    expect(workspace.getPin("gone")).toBeUndefined();
    expect(workspace.listPins()).toEqual([]);
  });

  it("skips hand-edited pins instead of throwing", () => {
    const { workspace, board } = setup();
    const valid = workspace.createPin({
      id: "good",
      boardId: board.id,
      x: 1,
      y: 2,
      label: "Good",
      createdBy: "u",
    });

    writeRawPin(workspace, "empty-label", {
      boardId: board.id,
      x: 0,
      y: 0,
      label: "",
      color: "amber",
      createdBy: "u",
      createdAt: 1,
    });
    writeRawPin(workspace, "missing-board", {
      boardId: "no-such-board",
      x: 0,
      y: 0,
      label: "Nowhere",
      color: "amber",
      createdBy: "u",
      createdAt: 2,
    });
    writeRawPin(workspace, "bad-coordinate", {
      boardId: board.id,
      x: "left",
      y: 0,
      label: "Floating",
      color: "amber",
      createdBy: "u",
      createdAt: 3,
    });
    writeRawPin(workspace, "bad-color", {
      boardId: board.id,
      x: 0,
      y: 0,
      label: "Loud",
      color: "chartreuse",
      createdBy: "u",
      createdAt: 4,
    });
    writeRawPin(workspace, "bad-target", {
      boardId: board.id,
      x: 0,
      y: 0,
      label: "Dangling",
      color: "amber",
      createdBy: "u",
      createdAt: 5,
    });
    const badTarget = workspace.doc.getMap(WorkspaceDocument.PINS_KEY).get("bad-target");
    if (!(badTarget instanceof LoroMap)) throw new Error("expected the raw pin map");
    badTarget.ensureMergeableMap("target").set("kind", "portal");
    workspace.doc.commit({ origin: "test" });

    expect(workspace.listPins().map((pin) => pin.id)).toEqual([valid.id]);
    expect(workspace.getPin("empty-label")).toBeUndefined();
    expect(workspace.getPin("missing-board")).toBeUndefined();
    expect(workspace.getPin("bad-target")).toBeUndefined();
  });

  it("opens a document written before pins existed", () => {
    const old = new LoroDoc();
    const boards = old.getMap(WorkspaceDocument.BOARDS_KEY).ensureMergeableMap("board-1");
    boards.set("name", "Old board");
    boards.set("createdAt", 1);
    boards.set("updatedAt", 1);
    old.commit({ origin: "test" });

    const workspace = new WorkspaceDocument(old);

    expect(workspace.getBoard("board-1")?.name).toBe("Old board");
    expect(workspace.listPins()).toEqual([]);
    expect(workspace.getPin("anything")).toBeUndefined();

    // No schema bump: the same old document accepts a pin additively.
    const pin = workspace.createPin({
      boardId: "board-1",
      x: 0,
      y: 0,
      label: "Added later",
      createdBy: "u",
    });
    expect(workspace.getPin(pin.id)).toBeDefined();
  });

  it("round-trips through export and import", () => {
    const { workspace, board } = setup();
    const pin = workspace.createPin({
      boardId: board.id,
      x: 7,
      y: 8,
      label: "Exported",
      color: "green",
      createdBy: "u",
      target: { kind: "section", id: "section-1" },
    });

    const other = new WorkspaceDocument();
    other.doc.import(workspace.doc.export({ mode: "update" }));

    expect(other.getPin(pin.id)).toEqual(pin);
    expect(other.listPins(board.id)).toEqual([pin]);
  });

  it("converges concurrent rename and move on one pin", () => {
    const a = new WorkspaceDocument();
    const b = new WorkspaceDocument();
    const board = a.ensureBoard();
    b.doc.import(a.doc.export({ mode: "update" }));
    const pin = a.createPin({
      id: "pin-1",
      boardId: board.id,
      x: 0,
      y: 0,
      label: "Shared",
      createdBy: "u",
    });
    b.doc.import(a.doc.export({ mode: "update" }));

    a.updatePin(pin.id, { label: "From A" });
    b.movePin(pin.id, { x: 200, y: 100 });
    sync(a.doc, b.doc);

    expect(a.getPin(pin.id)).toMatchObject({ label: "From A", x: 200, y: 100 });
    expect(b.getPin(pin.id)).toMatchObject({ label: "From A", x: 200, y: 100 });
    expect(a.listPins(board.id)).toHaveLength(1);
  });
});
