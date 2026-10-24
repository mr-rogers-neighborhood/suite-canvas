import { WorkspaceDocument } from "@suite/graph";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDrawing } from "./useDrawing";

function fixture() {
  const workspace = new WorkspaceDocument();
  const board = workspace.ensureView();
  const card = workspace.createCard({ typeId: "note", boardId: board.id });
  workspace.setDrawing(card.id, [
    { id: "rect-1", type: "rectangle", x: 0, y: 0, width: 100, height: 60 },
  ]);
  return { workspace, card };
}

describe("useDrawing", () => {
  it("should read a card's scene and follow document commits", async () => {
    const { workspace, card } = fixture();
    const { result } = renderHook(() => useDrawing(card.id, workspace));

    expect(result.current?.elements).toHaveLength(1);

    act(() => {
      workspace.upsertDrawingElement(card.id, {
        id: "rect-1",
        type: "rectangle",
        x: 24,
        y: 10,
        width: 100,
        height: 60,
      });
    });

    await waitFor(() => expect(result.current?.elements[0]?.x).toBe(24));
    expect(result.current?.order).toEqual(["rect-1"]);
  });

  it("should return null without a card", () => {
    const { workspace } = fixture();
    const { result } = renderHook(() => useDrawing(null, workspace));
    expect(result.current).toBeNull();
  });
});
