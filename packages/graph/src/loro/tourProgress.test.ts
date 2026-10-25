import { describe, expect, it } from "vitest";
import {
  insertTourStep,
  listTourSteps,
  markTourRead,
  moveTourStep,
  parseStep,
  removeTourStep,
  TOUR_READ_FIELD_NAME,
  tourReadDay,
  tourSteps,
  updateTourStep,
} from "../tutorial.js";
import { WorkspaceDocument } from "./WorkspaceDocument.js";

function setup() {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureBoard();
  workspace.ensureDefaultTypes();
  workspace.createCard({ id: "tour", typeId: "note", boardId: board.id });
  workspace.createCard({ id: "target", typeId: "note", boardId: board.id });
  return { workspace, board };
}

const step = (id: string, targetId: string) =>
  parseStep({
    id,
    targets: [{ kind: "card", id: targetId }],
    viewport: { x: 10, y: 20, zoom: 1 },
    caption: `about ${targetId}`,
  }) as NonNullable<ReturnType<typeof parseStep>>;

describe("tour step blocks in a card body", () => {
  it("should append steps in authored order and read them back", () => {
    const { workspace } = setup();

    expect(insertTourStep(workspace, "tour", step("s1", "target"))).toBe(true);
    expect(insertTourStep(workspace, "tour", step("s2", "target"))).toBe(true);

    expect(listTourSteps(workspace, "tour").map((stored) => stored.stepId)).toEqual(["s1", "s2"]);
    expect(tourSteps(workspace, "tour").map((entry) => entry.caption)).toEqual([
      "about target",
      "about target",
    ]);
  });

  it("should refuse a card that does not exist", () => {
    const { workspace } = setup();

    expect(insertTourStep(workspace, "nope", step("s1", "target"))).toBe(false);
    expect(listTourSteps(workspace, "nope")).toEqual([]);
  });

  it("should write one attribute at a time and clear a null one", () => {
    const { workspace } = setup();
    insertTourStep(workspace, "tour", step("s1", "target"));

    expect(updateTourStep(workspace, "tour", "s1", { caption: "rewritten" })).toBe(true);
    expect(tourSteps(workspace, "tour")[0]?.caption).toBe("rewritten");

    updateTourStep(workspace, "tour", "s1", { caption: null });
    expect(tourSteps(workspace, "tour")[0]?.caption).toBeUndefined();
    // The step still plays: a caption is narration, never the anchor.
    expect(tourSteps(workspace, "tour")[0]?.viewport).toEqual({ x: 10, y: 20, zoom: 1 });
  });

  it("should remove a step and leave the rest alone", () => {
    const { workspace } = setup();
    insertTourStep(workspace, "tour", step("s1", "target"));
    insertTourStep(workspace, "tour", step("s2", "target"));

    expect(removeTourStep(workspace, "tour", "s1")).toBe(true);
    expect(listTourSteps(workspace, "tour").map((stored) => stored.stepId)).toEqual(["s2"]);
    expect(removeTourStep(workspace, "tour", "missing")).toBe(false);
  });

  it("should reorder steps one place at a time", () => {
    const { workspace } = setup();
    insertTourStep(workspace, "tour", step("s1", "target"));
    insertTourStep(workspace, "tour", step("s2", "target"));
    insertTourStep(workspace, "tour", step("s3", "target"));

    expect(moveTourStep(workspace, "tour", "s3", -1)).toBe(true);
    expect(listTourSteps(workspace, "tour").map((stored) => stored.stepId)).toEqual([
      "s1",
      "s3",
      "s2",
    ]);

    expect(moveTourStep(workspace, "tour", "s1", 1)).toBe(true);
    expect(listTourSteps(workspace, "tour").map((stored) => stored.stepId)).toEqual([
      "s3",
      "s1",
      "s2",
    ]);

    // The ends refuse instead of wrapping.
    expect(moveTourStep(workspace, "tour", "s3", -1)).toBe(false);
    expect(moveTourStep(workspace, "tour", "s2", 1)).toBe(false);
  });

  it("should not lose the caption when a step is reordered", () => {
    const { workspace } = setup();
    insertTourStep(workspace, "tour", step("s1", "target"));
    insertTourStep(workspace, "tour", step("s2", "target"));
    updateTourStep(workspace, "tour", "s2", { caption: "second" });

    moveTourStep(workspace, "tour", "s2", -1);

    expect(tourSteps(workspace, "tour")[0]?.caption).toBe("second");
  });
});

describe("tour completion", () => {
  it("should record the day on the tutorial card's own type", () => {
    const { workspace } = setup();

    const fieldId = markTourRead(workspace, "tour", "2026-10-25");

    expect(fieldId).toBeTruthy();
    const field = workspace.getType("note")?.fields.find((entry) => entry.id === fieldId);
    expect(field?.name).toBe(TOUR_READ_FIELD_NAME);
    expect(field?.kind).toBe("date");
    expect(workspace.getCard("tour")?.properties[fieldId ?? ""]).toBe("2026-10-25");
    expect(tourReadDay(workspace, workspace.getCard("tour") as never)).toBe("2026-10-25");
  });

  it("should add the field once, not once per completion", () => {
    const { workspace } = setup();

    markTourRead(workspace, "tour", "2026-10-24");
    markTourRead(workspace, "tour", "2026-10-25");

    const readers = (workspace.getType("note")?.fields ?? []).filter(
      (entry) => entry.name === TOUR_READ_FIELD_NAME,
    );
    expect(readers).toHaveLength(1);
    expect(tourReadDay(workspace, workspace.getCard("tour") as never)).toBe("2026-10-25");
  });

  it("should stay a workspace value, so a reload still knows", () => {
    const { workspace, board } = setup();
    markTourRead(workspace, "tour", "2026-10-25");

    const reopened = new WorkspaceDocument(workspace.doc);
    const card = reopened.listCards().find((entry) => entry.id === "tour");
    // A reopened document reads the same record; nothing lived in the browser.
    expect(reopened.getBoard(board.id)).toBeTruthy();
    expect(tourReadDay(reopened, card as never)).toBe("2026-10-25");
  });

  it("should do nothing for a card that is gone", () => {
    const { workspace } = setup();

    expect(markTourRead(workspace, "missing", "2026-10-25")).toBeNull();
  });
});
