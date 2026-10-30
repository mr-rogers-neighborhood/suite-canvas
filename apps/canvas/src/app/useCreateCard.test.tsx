import { WorkspaceDocument } from "@suite/graph";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ensureWhiteboardType } from "../cards/whiteboard";
import { useCreateCard } from "./useCreateCard";

/**
 * One door for every "new card of this type". What the press leaves on screen is
 * the part these tests pin: a note opens on its title, and a sketch opens on the
 * drawing surface — a sketch has no title editor on the canvas, so asking for one
 * made a blank card and nothing else.
 */
function harness() {
  const workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  const board = workspace.ensureBoard();
  const startEditing = vi.fn();
  const openCardFocus = vi.fn();
  const view = renderHook(() =>
    useCreateCard({
      workspace,
      activeBoardId: board.id,
      canvasPoint: () => ({ x: 0, y: 0 }),
      startEditing,
      openCardFocus,
    }),
  );
  return { workspace, board, startEditing, openCardFocus, view };
}

describe("creating a card", () => {
  it("should open a note on its title", () => {
    const { startEditing, openCardFocus, view } = harness();

    let id: string | undefined;
    act(() => {
      id = view.result.current.createCard("note");
    });

    expect(id).toBeDefined();
    expect(startEditing).toHaveBeenCalledWith(id, "title");
    expect(openCardFocus).not.toHaveBeenCalled();
  });

  it("should open a sketch on its drawing surface instead of a title", () => {
    const { workspace, startEditing, openCardFocus, view } = harness();
    const sketchType = ensureWhiteboardType(workspace);

    let id: string | undefined;
    act(() => {
      id = view.result.current.createCard(sketchType.id);
    });

    expect(id).toBeDefined();
    expect(openCardFocus).toHaveBeenCalledWith(id);
    expect(startEditing).not.toHaveBeenCalled();
  });

  it("should place the card on the board it was made for", () => {
    const { workspace, board, view } = harness();

    act(() => {
      view.result.current.createCard("note");
    });

    expect(workspace.listBoardPlacements(board.id)).toHaveLength(1);
  });

  /**
   * Two live templates cannot answer "what does a new card look like", so the
   * door asks first and creates nothing until the answer arrives. A sketch has
   * no templates, so it never takes this path.
   */
  it("should ask before making a card of a type with two templates", () => {
    const { workspace, startEditing, openCardFocus, view } = harness();
    const type = workspace.createType({ name: "Brief", pluralName: "Briefs" });
    const first = workspace.createCard({ typeId: type.id });
    const second = workspace.createCard({ typeId: type.id });
    workspace.updateType(type.id, { templateCardIds: [first.id, second.id] });

    let id: string | undefined;
    act(() => {
      id = view.result.current.createCard(type.id);
    });

    expect(id).toBeUndefined();
    expect(view.result.current.choice?.typeId).toBe(type.id);
    expect(startEditing).not.toHaveBeenCalled();
    expect(openCardFocus).not.toHaveBeenCalled();

    act(() => {
      view.result.current.pick(null);
    });
    expect(startEditing).toHaveBeenCalledTimes(1);
  });
});
