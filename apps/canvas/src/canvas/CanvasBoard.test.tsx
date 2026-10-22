import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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

beforeAll(() => {
  useCanvasStore.setState({ ready: true, synced: true });
  const board = workspace.ensureBoard();
  boardId = board.id;
  cardId = workspace.createCard({ typeId: "note", boardId, position: { x: 0, y: 0 } }).id;
});

afterAll(() => {
  useUiStore.setState({ readOnly: false, activeBoardId: null, selectedNodeIds: [] });
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
