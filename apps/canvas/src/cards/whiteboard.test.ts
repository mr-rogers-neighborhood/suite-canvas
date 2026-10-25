import type { DrawingElement } from "@suite/graph";
import { WorkspaceDocument } from "@suite/graph";
import { describe, expect, it, vi } from "vitest";
import {
  createSketchCommitBatcher,
  ensureWhiteboardType,
  isWhiteboardCard,
  readSketchDisplay,
  SKETCH_DISPLAY_FIELD_NAME,
  SKETCH_TYPE_NAME,
  SKETCH_TYPE_PLURAL,
  setSketchDisplay,
  sketchDisplayField,
  WHITEBOARD_TYPE_ID,
} from "./whiteboard";

/** One document commit is the unit undo and history care about. */
function countCommits(workspace: WorkspaceDocument): () => number {
  let commits = 0;
  workspace.doc.subscribe(() => {
    commits += 1;
  });
  return () => commits;
}

function sketchCard(workspace: WorkspaceDocument, id = "sketch"): string {
  const board = workspace.ensureBoard();
  const type = ensureWhiteboardType(workspace);
  return workspace.createCard({ id, typeId: type.id, boardId: board.id, position: { x: 0, y: 0 } })
    .id;
}

function stamp(width: number): DrawingElement {
  return { id: "stroke", type: "freedraw", x: 0, y: 0, width, height: width };
}

describe("sketch type", () => {
  it("should create the built-in type once, labelled Sketch, with one display field", () => {
    const workspace = new WorkspaceDocument();
    const first = ensureWhiteboardType(workspace);
    const second = ensureWhiteboardType(workspace);

    expect(first.id).toBe(WHITEBOARD_TYPE_ID);
    expect(first.name).toBe(SKETCH_TYPE_NAME);
    expect(first.pluralName).toBe(SKETCH_TYPE_PLURAL);
    expect(second.id).toBe(first.id);
    expect(workspace.listTypes().filter((type) => type.id === WHITEBOARD_TYPE_ID)).toHaveLength(1);
    expect(second.fields.filter((field) => field.name === SKETCH_DISPLAY_FIELD_NAME)).toHaveLength(
      1,
    );
  });

  it("should upgrade the old Whiteboard label without touching a user's own name", () => {
    const workspace = new WorkspaceDocument();
    const legacy = workspace.createType({
      id: WHITEBOARD_TYPE_ID,
      name: "Whiteboard",
      pluralName: "Whiteboards",
    });

    expect(ensureWhiteboardType(workspace).name).toBe(SKETCH_TYPE_NAME);

    workspace.updateType(legacy.id, { name: "Diagram" });
    expect(ensureWhiteboardType(workspace).name).toBe("Diagram");
  });

  it("should keep the stored id so existing sketch cards still resolve", () => {
    const workspace = new WorkspaceDocument();
    const card = sketchCard(workspace);

    expect(workspace.getCard(card)?.primaryTypeId).toBe("whiteboard");
    expect(isWhiteboardCard(workspace.getCard(card))).toBe(true);
    expect(isWhiteboardCard({ primaryTypeId: "note" })).toBe(false);
    expect(isWhiteboardCard(undefined)).toBe(false);
  });
});

describe("sketch display mode", () => {
  it("should read framed until a mode is stored, and follow a stored mode", () => {
    const workspace = new WorkspaceDocument();
    const cardId = sketchCard(workspace);
    const card = workspace.getCard(cardId);

    expect(sketchDisplayField(workspace.getType(WHITEBOARD_TYPE_ID))).toBeDefined();
    expect(readSketchDisplay(workspace, card)).toBe("framed");

    setSketchDisplay(workspace, cardId, "seamless");
    expect(readSketchDisplay(workspace, workspace.getCard(cardId))).toBe("seamless");

    setSketchDisplay(workspace, cardId, "framed");
    expect(readSketchDisplay(workspace, workspace.getCard(cardId))).toBe("framed");
  });

  it("should write the mode as one ordinary field value", () => {
    const workspace = new WorkspaceDocument();
    const cardId = sketchCard(workspace);
    const commits = countCommits(workspace);

    setSketchDisplay(workspace, cardId, "seamless");
    const field = sketchDisplayField(workspace.getType(WHITEBOARD_TYPE_ID));
    expect(commits()).toBe(1);
    expect(workspace.getCard(cardId)?.properties[field?.id ?? ""]).toBeTruthy();
  });

  it("should ignore a card that is not a sketch or a mode a peer removed", () => {
    const workspace = new WorkspaceDocument();
    const note = workspace.createCard({ id: "note" });

    setSketchDisplay(workspace, note.id, "seamless");
    expect(note.properties).toEqual({});
    expect(readSketchDisplay(workspace, { primaryTypeId: "note", properties: {} })).toBe("framed");
    expect(
      readSketchDisplay(workspace, { primaryTypeId: WHITEBOARD_TYPE_ID, properties: {} }),
    ).toBe("framed");
  });
});

describe("sketch stroke batching", () => {
  it("should land a whole stroke in one document commit on pointer-up", () => {
    const workspace = new WorkspaceDocument();
    const cardId = sketchCard(workspace);
    const commits = countCommits(workspace);
    const committed: DrawingElement[][] = [];
    const batcher = createSketchCommitBatcher<DrawingElement[]>((elements) => {
      committed.push(elements);
      workspace.applyDrawing(cardId, elements);
    });

    batcher.beginGesture();
    for (let sample = 1; sample <= 60; sample += 1) batcher.schedule([stamp(sample)]);
    // Every sample is one Excalidraw change; none of them is a write.
    expect(batcher.pending).toBe(true);
    expect(committed).toHaveLength(0);
    expect(commits()).toBe(0);

    batcher.endGesture();
    expect(committed).toHaveLength(1);
    expect(commits()).toBe(1);
    expect(workspace.drawing(cardId)?.elements[0]?.width).toBe(60);
  });

  it("should not let the idle timer commit mid-gesture", () => {
    vi.useFakeTimers();
    try {
      const committed: number[] = [];
      const batcher = createSketchCommitBatcher<number>((value) => committed.push(value));
      batcher.schedule(1);
      batcher.beginGesture();
      batcher.schedule(2);
      vi.advanceTimersByTime(5_000);
      expect(committed).toEqual([]);

      batcher.endGesture();
      expect(committed).toEqual([2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should still settle a keyboard-only edit on the idle timer", () => {
    vi.useFakeTimers();
    try {
      const committed: number[] = [];
      const batcher = createSketchCommitBatcher<number>((value) => committed.push(value), 300);
      batcher.schedule(7);
      vi.advanceTimersByTime(299);
      expect(committed).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(committed).toEqual([7]);
    } finally {
      vi.useRealTimers();
    }
  });
});
