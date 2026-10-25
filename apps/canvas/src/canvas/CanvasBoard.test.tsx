import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider, useStore } from "@xyflow/react";
import { LoroList, LoroMap, LoroText } from "loro-crdt";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

// Portalled menus land in `document.body`, so every test starts with one tree.
afterEach(cleanup);

afterAll(() => {
  useUiStore.setState({
    readOnly: false,
    activeBoardId: null,
    selectedNodeIds: [],
    shareRequest: null,
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

describe("CanvasBoard share intent", () => {
  function mountSelection(selectedNodeIds: string[], canManageLinks: boolean) {
    useUiStore.setState({
      readOnly: false,
      activeBoardId: boardId,
      selectedNodeIds,
      selectedEdgeIds: [],
      selectedSectionId: null,
      shareRequest: null,
      ...FULL_CAPABILITIES,
      canManageLinks,
    });
    return render(
      <ReactFlowProvider>
        <CanvasBoard />
      </ReactFlowProvider>,
    );
  }

  it("offers a share item for a multi-selection and records the request", async () => {
    const { container } = mountSelection([cardId, "card-2"], true);
    await waitFor(() => expect(container.querySelector(".react-flow__node")).not.toBeNull());

    fireEvent.contextMenu(container.querySelector(".react-flow__node") as HTMLElement, {
      clientX: 12,
      clientY: 12,
    });

    fireEvent.click(screen.getByRole("menuitem", { name: "Share 2 cards\u2026" }));
    expect(useUiStore.getState().shareRequest).toBe("selection");
    useUiStore.setState({ shareRequest: null });
  });

  it("hides the share item without link management or a lone card", async () => {
    const { container, unmount } = mountSelection([cardId, "card-2"], false);
    await waitFor(() => expect(container.querySelector(".react-flow__node")).not.toBeNull());

    fireEvent.contextMenu(container.querySelector(".react-flow__node") as HTMLElement, {
      clientX: 12,
      clientY: 12,
    });
    expect(screen.queryByRole("menuitem", { name: /^Share / })).not.toBeInTheDocument();
    unmount();

    const single = mountSelection([cardId], true);
    await waitFor(() => expect(single.container.querySelector(".react-flow__node")).not.toBeNull());
    fireEvent.contextMenu(single.container.querySelector(".react-flow__node") as HTMLElement, {
      clientX: 12,
      clientY: 12,
    });
    expect(screen.queryByRole("menuitem", { name: /^Share / })).not.toBeInTheDocument();
  });
});

/** A title tree in the shape `loro-prosemirror` writes. */
function writeTitle(targetId: string, text: string) {
  const title = workspace.getTitle(targetId);
  title.set("nodeName", "doc");
  const blocks = title.getOrCreateContainer("children", new LoroList());
  const paragraph = blocks.insertContainer(0, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.getOrCreateContainer("attributes", new LoroMap());
  const inline = paragraph.getOrCreateContainer("children", new LoroList());
  inline.insertContainer(0, new LoroText()).insert(0, text);
  workspace.doc.commit({ origin: "text:title" });
}

/** A body paragraph, written straight into the card's content container. */
function writeBody(targetId: string, text: string) {
  const content = workspace.getContent(targetId);
  content.set("nodeName", "doc");
  const blocks = content.getOrCreateContainer("children", new LoroList());
  const paragraph = blocks.insertContainer(blocks.length, new LoroMap());
  paragraph.set("nodeName", "paragraph");
  paragraph.getOrCreateContainer("attributes", new LoroMap());
  const inline = paragraph.getOrCreateContainer("children", new LoroList());
  inline.insertContainer(0, new LoroText()).insert(0, text);
  workspace.doc.commit({ origin: "text:body" });
}

describe("CanvasBoard card organization", () => {
  function mountEditor() {
    useUiStore.setState({
      readOnly: false,
      activeBoardId: boardId,
      selectedNodeIds: [],
      selectedEdgeIds: [],
      selectedSectionId: null,
      editingNodeId: null,
      // A menu left open by an earlier test would render into this mount.
      contextMenu: null,
      ...FULL_CAPABILITIES,
    });
    return render(
      <ReactFlowProvider>
        <CanvasBoard />
      </ReactFlowProvider>,
    );
  }

  function cardMenu(container: HTMLElement, nodeId: string) {
    const menu = container.querySelector(`[data-node-id="${nodeId}"] [data-testid="card-menu"]`);
    expect(menu).not.toBeNull();
    fireEvent.click(menu as HTMLElement);
  }

  it("duplicates a card from its menu with an independent body", async () => {
    const source = workspace.createCard({ boardId, position: { x: 40, y: 40 } });
    writeTitle(source.id, "Sprint plan");
    writeBody(source.id, "day one");
    const { container } = mountEditor();
    await waitFor(() =>
      expect(container.querySelector(`[data-node-id="${source.id}"]`)).not.toBeNull(),
    );
    cardMenu(container, source.id);
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    const titled = workspace
      .listBoardCards(boardId)
      .filter((card) => workspace.displayTitle(card.id) === "Sprint plan");
    expect(titled).toHaveLength(2);
    const copy = titled.find((card) => card.id !== source.id);
    expect(copy).toBeDefined();
    expect(copy?.id).not.toBe(source.id);
    expect(container.querySelector(`[data-node-id="${copy?.id}"]`)).not.toBeNull();
    await waitFor(() => expect(useUiStore.getState().selectedNodeIds).toEqual([copy?.id]));

    // The copy's body is its own container: editing it leaves the source alone.
    writeBody(copy?.id ?? "", "day one, revised");
    expect(workspace.cardText(source.id)).toBe("day one");
    expect(workspace.cardText(copy?.id ?? "")).toContain("day one, revised");
  });

  it("moves a card to another board and leaves the old board without it", async () => {
    const target = workspace.createBoard({ name: "Someday" });
    const moved = workspace.createCard({ boardId, position: { x: 60, y: 60 } });
    writeTitle(moved.id, "Move me");
    const { container } = mountEditor();
    await waitFor(() =>
      expect(container.querySelector(`[data-node-id="${moved.id}"]`)).not.toBeNull(),
    );

    cardMenu(container, moved.id);
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to board" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Someday" }));

    expect(workspace.getPlacement(boardId, moved.id)).toBeUndefined();
    expect(workspace.getPlacement(target.id, moved.id)).toBeDefined();
    expect(workspace.listBoardCards(boardId).map((card) => card.id)).not.toContain(moved.id);
    expect(workspace.listBoardCards(target.id).map((card) => card.id)).toContain(moved.id);
    expect(workspace.displayTitle(moved.id)).toBe("Move me");
    await waitFor(() => expect(container.querySelector(`[data-node-id="${moved.id}"]`)).toBeNull());
  });

  it("duplicates a multi-selection from the selection menu", async () => {
    const first = workspace.createCard({ boardId, position: { x: 300, y: 300 } });
    const second = workspace.createCard({ boardId, position: { x: 560, y: 300 } });
    const { container } = mountEditor();
    await waitFor(() =>
      expect(container.querySelector(`[data-node-id="${first.id}"]`)).not.toBeNull(),
    );
    useUiStore.setState({ selectedNodeIds: [first.id, second.id] });
    const before = workspace.listBoardCards(boardId).length;

    fireEvent.contextMenu(container.querySelector(`[data-node-id="${first.id}"]`) as HTMLElement, {
      clientX: 10,
      clientY: 10,
    });
    fireEvent.click(screen.getByRole("menuitem", { name: "Duplicate 2 cards" }));

    expect(workspace.listBoardCards(boardId)).toHaveLength(before + 2);
    expect(useUiStore.getState().selectedNodeIds).toHaveLength(2);
  });

  it("captures a new card at the viewport centre with Ctrl+Enter", async () => {
    mountEditor();
    const before = workspace.listBoardCards(boardId).length;
    const create = vi.spyOn(workspace, "createCard");

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });

    expect(create).toHaveBeenCalledOnce();
    expect(workspace.listBoardCards(boardId)).toHaveLength(before + 1);
    const created = workspace.listBoardCards(boardId).at(-1);
    expect(useUiStore.getState().editingNodeId).toBe(created?.id);
    expect(useUiStore.getState().selectedNodeIds).toEqual([created?.id]);
    create.mockRestore();
  });

  it("ignores quick capture while an editor has focus", async () => {
    const { container } = mountEditor();
    await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull());
    const editor = container.querySelector(".ProseMirror") as HTMLElement;
    const before = workspace.listBoardCards(boardId).length;
    const create = vi.spyOn(workspace, "createCard");

    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });

    expect(create).not.toHaveBeenCalled();
    expect(workspace.listBoardCards(boardId)).toHaveLength(before);
    create.mockRestore();
  });
});

describe("CanvasBoard selection during a press", () => {
  function mountPress() {
    useUiStore.setState({
      readOnly: false,
      activeBoardId: boardId,
      selectedNodeIds: [],
      selectedEdgeIds: [],
      selectedSectionId: null,
      contextMenu: null,
      ...FULL_CAPABILITIES,
    });
    return render(
      <ReactFlowProvider>
        <CanvasBoard />
      </ReactFlowProvider>,
    );
  }

  const selectedCount = (container: HTMLElement): number =>
    container.querySelectorAll(".react-flow__node.selected").length;

  /**
   * React Flow owns the selection for the length of a press. The store echo of
   * the click *before* it can land mid-gesture, and painting that older set back
   * is what swallowed a modifier click.
   */
  it("keeps the pane's selection when a stale echo lands during a press", async () => {
    const first = workspace.createCard({ boardId, position: { x: 640, y: 640 } });
    const second = workspace.createCard({ boardId, position: { x: 940, y: 640 } });
    const { container } = mountPress();
    await waitFor(() =>
      expect(container.querySelector(`.react-flow__node[data-id="${second.id}"]`)).not.toBeNull(),
    );

    const ids = workspace.listBoardCards(boardId).map((card) => card.id);
    act(() => useUiStore.setState({ selectedNodeIds: ids }));
    await waitFor(() => expect(selectedCount(container)).toBe(ids.length));

    fireEvent.pointerDown(window);
    // The echo of an earlier click names one card; the pane already holds them all.
    act(() => useUiStore.setState({ selectedNodeIds: [first.id] }));
    expect(selectedCount(container)).toBe(ids.length);

    fireEvent.pointerUp(window);
    // The guard is per press: the next selection change paints as before.
    act(() => useUiStore.setState({ selectedNodeIds: [second.id] }));
    await waitFor(() => expect(selectedCount(container)).toBe(1));
    expect(container.querySelector(`.react-flow__node[data-id="${second.id}"]`)).toHaveClass(
      "selected",
    );
    expect(container.querySelector(`.react-flow__node[data-id="${first.id}"]`)).not.toHaveClass(
      "selected",
    );
  });
});
