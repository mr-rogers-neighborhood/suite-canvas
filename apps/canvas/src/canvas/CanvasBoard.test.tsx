import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider, useStore } from "@xyflow/react";
import { LoroList, LoroMap, LoroText } from "loro-crdt";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { CanvasBoard } from "./CanvasBoard";
import { NUDGE_LARGE_STEP, NUDGE_STEP } from "./nudge";
import { usePlaceStackStore } from "./placeStack";

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
    const body = container.querySelector("[data-testid='card-body']") as HTMLElement;
    fireEvent.click(body);
    await waitFor(() => expect(container.querySelector(".ProseMirror")).not.toBeNull());
    const editor = container.querySelector(".ProseMirror") as HTMLElement;
    const before = workspace.listBoardCards(boardId).length;
    const create = vi.spyOn(workspace, "createCard");

    fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });

    expect(create).not.toHaveBeenCalled();
    expect(workspace.listBoardCards(boardId)).toHaveLength(before);
    create.mockRestore();
    useUiStore.getState().stopEditing();
  });

  it("mounts ProseMirror when editing via keyboard even if body container was initially absent", async () => {
    const { container } = mountEditor();
    const card = workspace.listBoardCards(boardId)[0];
    if (!card) throw new Error("card not found");
    const cardId = card.id;
    workspace.doc.getMap("content").delete(cardId);
    workspace.doc.commit();
    expect(workspace.peekContent(cardId)).toBeNull();

    useUiStore.setState({ selectedNodeIds: [cardId] });
    fireEvent.keyDown(window, { key: "Enter" });

    expect(useUiStore.getState().editingNodeId).toBe(cardId);
    expect(useUiStore.getState().editingField).toBe("body");

    await waitFor(() => {
      expect(workspace.peekContent(cardId)).not.toBeNull();
      expect(container.querySelector(".ProseMirror")).not.toBeNull();
    });

    useUiStore.getState().stopEditing();
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

describe("CanvasBoard keyboard move", () => {
  /**
   * The board reads the arrows itself. React Flow would move a focused node by
   * one flow unit per press, and its position change carried no drag stop to
   * commit from — the move used to render and then vanish on reload.
   */
  it("persists an arrow-key move exactly once, with no drag stop", async () => {
    const { container } = mount(false);
    const node = await waitFor(() => {
      const found = container.querySelector(`.react-flow__node[data-id="${cardId}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    const stored = workspace.getPlacement(boardId, cardId);
    expect(stored).not.toBeUndefined();
    const move = vi.spyOn(workspace, "movePlacements");

    // Selecting the card is what gives the arrow keys a target: a card nobody
    // focused has nothing to move.
    fireEvent.click(node);
    fireEvent.keyDown(node, { key: "ArrowRight" });

    // One document write for one press — not one per frame, and not a second
    // one when the snapshot echoes the write back.
    expect(move).toHaveBeenCalledTimes(1);
    expect(move).toHaveBeenCalledWith(boardId, [
      { cardId, x: (stored?.x ?? 0) + NUDGE_STEP, y: stored?.y ?? 0 },
    ]);
    // The position a reload reads is the moved one.
    expect(workspace.getPlacement(boardId, cardId)).toMatchObject({
      x: (stored?.x ?? 0) + NUDGE_STEP,
      y: stored?.y,
    });

    move.mockRestore();
  });

  it("steps further with Shift, one write per press", async () => {
    const { container } = mount(false);
    const node = await waitFor(() => {
      const found = container.querySelector(`.react-flow__node[data-id="${cardId}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    const stored = workspace.getPlacement(boardId, cardId);
    const move = vi.spyOn(workspace, "movePlacements");

    fireEvent.click(node);
    fireEvent.keyDown(node, { key: "ArrowDown", shiftKey: true });

    expect(move).toHaveBeenCalledWith(boardId, [
      { cardId, x: stored?.x ?? 0, y: (stored?.y ?? 0) + NUDGE_LARGE_STEP },
    ]);
    move.mockRestore();
  });

  it("shows the nudge hint with a selection, and not to a viewer", async () => {
    const editor = mount(false);
    await waitFor(() => expect(editor.container.querySelector(".react-flow__node")).not.toBeNull());
    expect(editor.getByTestId("nudge-hint")).toBeInTheDocument();
    editor.unmount();

    mount(true);
    await waitFor(() => expect(screen.queryByTestId("nudge-hint")).toBeNull());
  });

  it("does not nudge a viewer's card", async () => {
    const { container } = mount(true);
    const node = await waitFor(() => {
      const found = container.querySelector(`.react-flow__node[data-id="${cardId}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    const stored = workspace.getPlacement(boardId, cardId);
    const move = vi.spyOn(workspace, "movePlacements");

    fireEvent.keyDown(node, { key: "ArrowRight" });

    expect(move).not.toHaveBeenCalled();
    expect(workspace.getPlacement(boardId, cardId)).toMatchObject({ x: stored?.x, y: stored?.y });
    move.mockRestore();
  });

  it("does not write while a card is only being selected", async () => {
    const { container } = mount(false);
    const node = await waitFor(() => {
      const found = container.querySelector(`.react-flow__node[data-id="${cardId}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    const move = vi.spyOn(workspace, "movePlacements");

    fireEvent.click(node);

    expect(move).not.toHaveBeenCalled();

    move.mockRestore();
  });
});

describe("CanvasBoard escape ladder", () => {
  it("empties a held stack as the last rung", async () => {
    usePlaceStackStore.getState().start(["held-a", "held-b"]);
    const { container } = mount(false);
    // Nothing else left to close: no selection, the resting mode and purpose.
    useUiStore.setState({ selectedNodeIds: [], mode: "place", purpose: "explore" });

    await waitFor(() => expect(container.querySelector(".react-flow__node")).not.toBeNull());
    // A stack in hand is the last thing Escape puts down, after every surface above it.
    fireEvent.keyDown(window, { key: "Escape" });

    expect(usePlaceStackStore.getState().queue).toEqual([]);
    usePlaceStackStore.getState().stop();
  });

  it("closes the selection before the hand", () => {
    usePlaceStackStore.getState().start(["held-a"]);
    mount(false);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUiStore.getState().selectedNodeIds).toEqual([]);
    expect(usePlaceStackStore.getState().queue).toEqual(["held-a"]);

    // The mode climb comes before the hand, one press per axis.
    useUiStore.setState({ mode: "thread" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUiStore.getState().mode).toBe("place");
    expect(usePlaceStackStore.getState().queue).toEqual(["held-a"]);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(usePlaceStackStore.getState().queue).toEqual([]);
    usePlaceStackStore.getState().stop();
  });
});

describe("CanvasBoard pane double-click", () => {
  async function pane(container: HTMLElement): Promise<HTMLElement> {
    return waitFor(() => {
      const found = container.querySelector(".react-flow__pane");
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
  }

  it("creates a card where the reader double-clicked", async () => {
    const { container } = mount(false);
    const target = await pane(container);
    const before = workspace.listBoardCards(boardId).length;
    const create = vi.spyOn(workspace, "createCard");

    fireEvent.doubleClick(target, { clientX: 240, clientY: 180 });

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ boardId });
    expect(workspace.listBoardCards(boardId)).toHaveLength(before + 1);
    create.mockRestore();
  });

  it("does nothing for a session that cannot create content", async () => {
    const { container } = mount(true);
    const target = await pane(container);
    const before = workspace.listBoardCards(boardId).length;
    const create = vi.spyOn(workspace, "createCard");

    fireEvent.doubleClick(target, { clientX: 240, clientY: 180 });

    expect(create).not.toHaveBeenCalled();
    expect(workspace.listBoardCards(boardId)).toHaveLength(before);
    create.mockRestore();
  });

  it("leaves a double-click on a card to the card", async () => {
    const { container } = mount(false);
    const node = await waitFor(() => {
      const found = container.querySelector(`.react-flow__node[data-id="${cardId}"]`);
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    const create = vi.spyOn(workspace, "createCard");

    fireEvent.doubleClick(node);

    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
  });
});

describe("CanvasBoard camera controls", () => {
  it("keeps the camera controls inside the pill React Flow already draws", async () => {
    const { container, getByTestId } = mount(false);
    await waitFor(() => expect(container.querySelector(".react-flow__node")).not.toBeNull());

    // Zoom in, zoom out and fit stay on React Flow's own `<Controls>`; the one
    // addition is zoom-to-selection, which has no built-in equivalent.
    const pill = container.querySelector(".react-flow__controls");
    expect(pill).not.toBeNull();
    expect(pill?.contains(getByTestId("zoom-to-selection"))).toBe(true);

    // The dot grid is not a switch any more, so it is always painted.
    expect(container.querySelector(".react-flow__background")).not.toBeNull();
  });
});
