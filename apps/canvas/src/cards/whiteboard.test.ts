import { WorkspaceDocument } from "@suite/graph";
import { describe, expect, it } from "vitest";
import { ensureWhiteboardType, isWhiteboardCard, WHITEBOARD_TYPE_ID } from "./whiteboard";

describe("whiteboard type", () => {
  it("should create the built-in type once and reuse it", () => {
    const workspace = new WorkspaceDocument();
    const first = ensureWhiteboardType(workspace);
    const second = ensureWhiteboardType(workspace);

    expect(first.id).toBe(WHITEBOARD_TYPE_ID);
    expect(first.name).toBe("Whiteboard");
    expect(second.id).toBe(first.id);
    expect(workspace.listTypes().filter((type) => type.id === WHITEBOARD_TYPE_ID)).toHaveLength(1);
  });

  it("should recognise a whiteboard card by its primary type", () => {
    expect(isWhiteboardCard({ primaryTypeId: WHITEBOARD_TYPE_ID })).toBe(true);
    expect(isWhiteboardCard({ primaryTypeId: "note" })).toBe(false);
    expect(isWhiteboardCard(undefined)).toBe(false);
  });
});
