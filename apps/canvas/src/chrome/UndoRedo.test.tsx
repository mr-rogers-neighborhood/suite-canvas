import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { UndoRedo } from "./UndoRedo";

/**
 * Undo and redo existed only as `Mod+Z` and `Mod+Shift+Z`, so a reader who did
 * not already know the keys had no way to reach either.
 */
describe("the undo pair", () => {
  beforeEach(() => {
    const workspace = useCanvasStore.getState().workspace;
    // A clean stack, so the assertions below are about this test's one change.
    while (workspace.canUndo()) workspace.undo();
  });

  it("offers both controls, disabled until there is something to step", () => {
    render(<UndoRedo />);

    expect(screen.getByTestId("nav-undo")).toBeDisabled();
    expect(screen.getByTestId("nav-redo")).toBeDisabled();
  });

  it("undoes the last document change and redoes it", async () => {
    const workspace = useCanvasStore.getState().workspace;
    const board = workspace.ensureBoard();
    const card = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });

    render(<UndoRedo />);

    await waitFor(() => expect(screen.getByTestId("nav-undo")).toBeEnabled());
    fireEvent.click(screen.getByTestId("nav-undo"));

    expect(workspace.getCard(card.id)).toBeUndefined();

    await waitFor(() => expect(screen.getByTestId("nav-redo")).toBeEnabled());
    fireEvent.click(screen.getByTestId("nav-redo"));

    expect(workspace.getCard(card.id)).toBeDefined();
  });
});
