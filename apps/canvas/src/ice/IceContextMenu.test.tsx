import { WorkspaceDocument } from "@suite/graph";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceSnapshot } from "../hooks/snapshotMerge";
import { useUiStore } from "../store/useUiStore";
import { IceContextMenu } from "./IceContextMenu";
import { setIceSelectionCommand } from "./iceSelectionCommand";

/**
 * The join, end to end: a Board's menu on the ICE surface, driven through the
 * real shared builder, writing through a real `WorkspaceDocument`. This is where
 * "the menu offers a row it cannot keep" is caught — the row has to reach the
 * document (or the surface's own selection path), not just a callback.
 */

function boardMenu(boardId: string) {
  return {
    x: 10,
    y: 20,
    kind: "section" as const,
    sectionId: boardId,
    flowPosition: { x: 1, y: 2 },
  };
}

function renderMenu(workspace: WorkspaceDocument, snapshot: WorkspaceSnapshot, boardId: string) {
  const reconcile = vi.fn();
  useUiStore.getState().openContextMenu(boardMenu(boardId));
  render(
    <IceContextMenu
      workspace={workspace}
      rootBoardId={boardId}
      snapshot={snapshot}
      canCreateContent
      canCreateBoards
      canEditContent
      canEditLayout
      canManageStructure
      canManageTrash
      canManageLinks
      reconcile={reconcile}
    />,
  );
  return { reconcile };
}

let workspace: WorkspaceDocument;
let view = "";

beforeEach(() => {
  workspace = new WorkspaceDocument();
  workspace.ensureDefaultTypes();
  view = workspace.ensureView().id;
  useUiStore.setState({
    contextMenu: null,
    editingSectionId: null,
    selectedNodeIds: [],
    selectedSectionId: null,
  });
});

afterEach(() => {
  cleanup();
  setIceSelectionCommand(null);
  useUiStore.setState({ contextMenu: null, editingSectionId: null, selectedNodeIds: [] });
});

function snapshotOf(workspace: WorkspaceDocument): WorkspaceSnapshot {
  return {
    boards: workspace.listBoards(),
    views: [],
    cards: [],
    placements: workspace.listPlacements(),
    edges: [],
    types: [],
    tags: [],
    sections: [],
    references: {},
  };
}

describe("IceContextMenu on a Board", () => {
  it("renames the Board: the row opens the field and one write lands", () => {
    const board = workspace.createBoard({ name: "Research", parentBoardId: view });
    const { reconcile } = renderMenu(workspace, snapshotOf(workspace), board.id);

    expect(screen.getByText("Rename board")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Rename board"));

    const field = screen.getByTestId("board-rename-input");
    expect(field).toHaveValue("Research");
    fireEvent.change(field, { target: { value: "Field notes" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(workspace.getBoard(board.id)?.name).toBe("Field notes");
    expect(useUiStore.getState().editingSectionId).toBeNull();
    expect(reconcile).toHaveBeenCalled();
  });

  it("does not write when the rename is abandoned", () => {
    const board = workspace.createBoard({ name: "Research", parentBoardId: view });
    renderMenu(workspace, snapshotOf(workspace), board.id);

    fireEvent.click(screen.getByText("Rename board"));
    const field = screen.getByTestId("board-rename-input");
    fireEvent.change(field, { target: { value: "Nope" } });
    fireEvent.keyDown(field, { key: "Escape" });

    expect(workspace.getBoard(board.id)?.name).toBe("Research");
    expect(useUiStore.getState().editingSectionId).toBeNull();
  });

  it("counts the Board's cards and selects them on the surface", () => {
    const board = workspace.createBoard({ name: "Research", parentBoardId: view });
    const first = workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    const second = workspace.createCard({ boardId: board.id, position: { x: 40, y: 0 } });
    // A card on the View is not a member of the Board.
    workspace.createCard({ boardId: view, position: { x: 900, y: 900 } });
    const selectOnSurface = vi.fn();
    setIceSelectionCommand(selectOnSurface);

    renderMenu(workspace, snapshotOf(workspace), board.id);

    const row = screen.getByText("Select 2 cards");
    fireEvent.click(row);

    const selected = [...useUiStore.getState().selectedNodeIds].sort();
    expect(selected).toEqual([first.id, second.id].sort());
    expect(selectOnSurface).toHaveBeenCalledWith(useUiStore.getState().selectedNodeIds);
  });

  it("deletes the Board it names", () => {
    const board = workspace.createBoard({ name: "Research", parentBoardId: view });
    renderMenu(workspace, snapshotOf(workspace), board.id);

    fireEvent.click(screen.getByText("Delete board"));

    expect(workspace.getBoard(board.id)).toBeUndefined();
  });
});
