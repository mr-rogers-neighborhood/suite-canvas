import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider, useStore } from "@xyflow/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { CanvasBoard } from "./CanvasBoard";

// React Flow measures its container; jsdom has no layout engine.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const workspace = useCanvasStore.getState().workspace;
let boardId = "";
let cardId = "";

const FULL_CAPABILITIES = {
  canEditContent: true,
  canEditLayout: true,
  canPublish: false,
  canCreateContent: true,
  canCreateBoards: true,
  canManageBoards: true,
  canManageSchema: true,
  canManageTrash: true,
  canManageLinks: true,
} as const;

const NO_CAPABILITIES = {
  canEditContent: false,
  canEditLayout: false,
  canPublish: false,
  canCreateContent: false,
  canCreateBoards: false,
  canManageBoards: false,
  canManageSchema: false,
  canManageTrash: false,
  canManageLinks: false,
} as const;

beforeAll(() => {
  useCanvasStore.setState({ ready: true, synced: true });
  const board = workspace.ensureBoard();
  boardId = board.id;
  cardId = workspace.createCard({ typeId: "note", boardId, position: { x: 0, y: 0 } }).id;
});

afterAll(() => {
  useUiStore.setState({
    readOnly: false,
    activeBoardId: null,
    selectedNodeIds: [],
    ...FULL_CAPABILITIES,
  });
  cleanup();
});

/** Reads the machine flags React Flow derived from the props CanvasBoard passed. */
function MachineProbe() {
  const draggable = useStore((state) => state.nodesDraggable);
  const connectable = useStore((state) => state.nodesConnectable);
  const reconnectable = useStore((state) => state.edgesReconnectable);
  return (
    <span
      data-testid="machine"
      data-draggable={String(draggable)}
      data-connectable={String(connectable)}
      data-reconnectable={String(reconnectable)}
    />
  );
}

function mount(readOnly: boolean) {
  useUiStore.setState({
    readOnly,
    activeBoardId: boardId,
    selectedNodeIds: [cardId],
    selectedEdgeIds: [],
    selectedSectionId: null,
    ...(readOnly ? NO_CAPABILITIES : FULL_CAPABILITIES),
  });
  return render(
    <ReactFlowProvider>
      <CanvasBoard />
      <MachineProbe />
    </ReactFlowProvider>,
  );
}

describe("CanvasBoard read-only", () => {
  it("keeps the card selectable but hides its write menu", async () => {
    const { container } = mount(true);

    await waitFor(() => expect(container.querySelector(".react-flow__node")).not.toBeNull());
    expect(container.querySelector('[data-testid="node-card"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="card-menu"]')).toBeNull();
  });

  it("turns off node dragging, linking and edge reconnects", async () => {
    const { getByTestId } = mount(true);
    const machine = getByTestId("machine");
    await waitFor(() => expect(machine).toHaveAttribute("data-draggable", "false"));
    expect(machine).toHaveAttribute("data-connectable", "false");
    expect(machine).toHaveAttribute("data-reconnectable", "false");
  });

  it("does not trash, unplace or undo from the keyboard", async () => {
    mount(true);
    const trash = vi.spyOn(workspace, "trashCard");
    const unplace = vi.spyOn(workspace, "unplaceCard");
    const undo = vi.spyOn(workspace, "undo");

    fireEvent.keyDown(window, { key: "Delete" });
    fireEvent.keyDown(window, { key: "Backspace", shiftKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(trash).not.toHaveBeenCalled();
    expect(unplace).not.toHaveBeenCalled();
    expect(undo).not.toHaveBeenCalled();
    // Selection survives so the reader can still inspect what they clicked.
    expect(useUiStore.getState().selectedNodeIds).toEqual([cardId]);

    trash.mockRestore();
    unplace.mockRestore();
    undo.mockRestore();
  });

  it("still applies the same shortcuts for an editor", async () => {
    mount(false);
    const unplace = vi.spyOn(workspace, "unplaceCard").mockImplementation(() => {});
    const trash = vi.spyOn(workspace, "trashCard").mockImplementation(() => {});

    fireEvent.keyDown(window, { key: "Delete" });

    expect(unplace).toHaveBeenCalledWith(boardId, cardId);
    expect(trash).not.toHaveBeenCalled();

    unplace.mockRestore();
    trash.mockRestore();
  });
});

describe("CanvasBoard board editor", () => {
  function mountBoardEditor() {
    useUiStore.setState({
      readOnly: false,
      activeBoardId: boardId,
      selectedNodeIds: [cardId],
      selectedEdgeIds: [],
      selectedSectionId: null,
      canEditContent: true,
      canEditLayout: true,
      canPublish: true,
      // A board draft owns cards, sections and edges, never boards or schema.
      canCreateContent: true,
      canCreateBoards: false,
      canManageBoards: false,
      canManageSchema: false,
      canManageTrash: false,
      canManageLinks: false,
    });
    return render(
      <ReactFlowProvider>
        <CanvasBoard />
        <MachineProbe />
      </ReactFlowProvider>,
    );
  }

  it("keeps layout, reconnect and draft creation gestures", async () => {
    const { getByTestId } = mountBoardEditor();
    const machine = getByTestId("machine");
    await waitFor(() => expect(machine).toHaveAttribute("data-draggable", "true"));
    expect(machine).toHaveAttribute("data-connectable", "true");
    expect(machine).toHaveAttribute("data-reconnectable", "true");
  });

  it("unplaces on Delete instead of trashing", () => {
    mountBoardEditor();
    const unplace = vi.spyOn(workspace, "unplaceCard").mockImplementation(() => {});
    const trash = vi.spyOn(workspace, "trashCard").mockImplementation(() => {});

    fireEvent.keyDown(window, { key: "Delete" });
    fireEvent.keyDown(window, { key: "Backspace", shiftKey: true });

    expect(unplace).toHaveBeenCalledWith(boardId, cardId);
    expect(trash).not.toHaveBeenCalled();

    unplace.mockRestore();
    trash.mockRestore();
  });

  it("offers content and layout edits but no destructive or schema actions", async () => {
    const { container } = mountBoardEditor();
    await waitFor(() =>
      expect(container.querySelector('[data-testid="card-menu"]')).not.toBeNull(),
    );

    fireEvent.click(container.querySelector('[data-testid="card-menu"]') as HTMLElement);

    expect(screen.getByRole("menuitem", { name: "Edit body" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Remove from board" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Delete card" })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Add connector" })).not.toBeInTheDocument();
  });
});
