import { describe, expect, it } from "vitest";
import { WorkspaceDocument } from "./loro/WorkspaceDocument.js";

/**
 * A field the app fills.
 *
 * The flag is a decision a reader makes about their own schema, so it has to be durable, visible on the definition,
 * and enforced by the one writer — with exactly one way around it, for the code that is allowed to fill the field.
 */
function fixture() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const type = workspace.createType({ name: "Claim" });
  const card = workspace.createCard({
    typeId: type.id,
    boardId: board.id,
    position: { x: 0, y: 0 },
  });
  const field = workspace.addField(type.id, { name: "Verdict", kind: "text", readOnly: true });
  return { workspace, board, type, card, field };
}

describe("a read-only field", () => {
  it("should be created read-only and read back that way", () => {
    const { workspace, type, field } = fixture();
    expect(field.readOnly).toBe(true);
    const stored = workspace.getType(type.id)?.fields.find((entry) => entry.id === field.id);
    expect(stored?.readOnly).toBe(true);
  });

  it("should refuse a reader's write with a sentence that says why", () => {
    const { workspace, card, field } = fixture();
    expect(() => workspace.setProperty(card.id, field.id, "approved")).toThrow(/read-only/u);
    expect(workspace.getCard(card.id)?.properties[field.id]).toBeUndefined();
  });

  it("should accept the write the app makes, because that is who fills it", () => {
    const { workspace, card, field } = fixture();
    workspace.setProperty(card.id, field.id, "approved", { asApp: true });
    expect(workspace.getCard(card.id)?.properties[field.id]).toBe("approved");
  });

  it("should be turnable off again, and then a reader may write it", () => {
    const { workspace, type, card, field } = fixture();
    workspace.updateField(type.id, field.id, { readOnly: false });

    workspace.setProperty(card.id, field.id, "mine");
    expect(workspace.getCard(card.id)?.properties[field.id]).toBe("mine");
    expect(
      workspace.getType(type.id)?.fields.find((entry) => entry.id === field.id)?.readOnly,
    ).toBe(undefined);
  });

  it("should leave every other field writable", () => {
    const { workspace, type, card } = fixture();
    const free = workspace.addField(type.id, { name: "Note", kind: "text" });
    workspace.setProperty(card.id, free.id, "anything");
    expect(workspace.getCard(card.id)?.properties[free.id]).toBe("anything");
  });
});
