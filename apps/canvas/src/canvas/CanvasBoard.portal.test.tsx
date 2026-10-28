import { PORTAL_BOARD_FIELD_ID, PORTAL_TYPE_ID } from "@suite/graph";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
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
let targetBoardId = "";
let noteId = "";

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

const originalRect = Element.prototype.getBoundingClientRect;

beforeAll(() => {
  useCanvasStore.setState({ ready: true, synced: true });
  const board = workspace.ensureBoard();
  boardId = board.id;
  noteId = workspace.createCard({ typeId: "note", boardId, position: { x: 0, y: 0 } }).id;
  targetBoardId = workspace.createBoard({ name: "Portal target" }).id;
  // Something for the miniature to draw.
  workspace.createCard({ typeId: "note", boardId: targetBoardId, position: { x: 40, y: 30 } });
  workspace.createSection({
    boardId: targetBoardId,
    title: "Bands",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
  });
  // jsdom reports a zero-sized canvas, which the camera transition reads as
  // "not on screen". Give every element the same pane-sized box instead.
  Element.prototype.getBoundingClientRect = () =>
    ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 900,
      height: 640,
      right: 900,
      bottom: 640,
      toJSON: () => ({}),
    }) as DOMRect;
});

afterEach(cleanup);

afterAll(() => {
  Element.prototype.getBoundingClientRect = originalRect;
  useUiStore.setState({
    readOnly: false,
    activeBoardId: null,
    selectedNodeIds: [],
    selectedEdgeIds: [],
    selectedSectionId: null,
    contextMenu: null,
    portalEntry: null,
    boardHistory: [],
    cardFocusId: null,
    ...FULL_CAPABILITIES,
  });
  cleanup();
});

function mount(overrides: Partial<ReturnType<typeof useUiStore.getState>> = {}) {
  useUiStore.setState({
    readOnly: false,
    activeBoardId: boardId,
    selectedNodeIds: [],
    selectedEdgeIds: [],
    selectedSectionId: null,
    editingNodeId: null,
    contextMenu: null,
    portalEntry: null,
    boardHistory: [],
    cardFocusId: null,
    ...FULL_CAPABILITIES,
    ...overrides,
  });
  return render(
    <ReactFlowProvider>
      <CanvasBoard />
    </ReactFlowProvider>,
  );
}

describe("CanvasBoard portals", () => {
  it("should paint a portal card with its target's miniature", async () => {
    workspace.createPortalCard({
      boardId,
      targetBoardId,
      position: { x: 500, y: 20 },
      id: "portal-render",
    });
    const { container } = mount();

    await waitFor(() =>
      expect(container.querySelector('[data-testid="portal-node"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-testid="portal-miniature"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="portal-miniature-section"]')).not.toBeNull();
    // The card names its target in text; the axe pass in Storybook checks the
    // composed accessible name.
    expect(screen.getByTestId("portal-node")).toHaveTextContent("Portal to");
    expect(screen.getByTestId("portal-node")).toHaveTextContent("Portal target");
  });

  it("should create a portal to an existing board from the canvas menu", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".react-flow__node")).not.toBeNull());

    fireEvent.contextMenu(container.querySelector(".react-flow__pane") as HTMLElement, {
      clientX: 120,
      clientY: 90,
    });

    fireEvent.click(await screen.findByRole("menuitem", { name: "New portal" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Portal target" }));

    const portals = workspace
      .listBoardCards(boardId)
      .filter(
        (card) =>
          card.primaryTypeId === PORTAL_TYPE_ID &&
          card.properties[PORTAL_BOARD_FIELD_ID] === targetBoardId,
      );
    expect(portals.length).toBeGreaterThan(0);
    expect(useUiStore.getState().selectedNodeIds).toEqual([portals.at(-1)?.id]);
  });

  it("should offer a new board and portal beside the existing targets", async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".react-flow__node")).not.toBeNull());

    fireEvent.contextMenu(container.querySelector(".react-flow__pane") as HTMLElement, {
      clientX: 120,
      clientY: 90,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "New portal" }));
    expect(screen.getByRole("menuitem", { name: "New board" })).toBeInTheDocument();
  });

  it("should not offer a board the session cannot create", async () => {
    const { container } = mount({ canCreateBoards: false });
    await waitFor(() => expect(container.querySelector(".react-flow__node")).not.toBeNull());

    fireEvent.contextMenu(container.querySelector(".react-flow__pane") as HTMLElement, {
      clientX: 120,
      clientY: 90,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "New portal" }));
    expect(screen.queryByRole("menuitem", { name: "New board" })).toBeNull();
  });

  it("should render no canvas menu for a session that cannot create content", async () => {
    const { container } = mount({ canCreateContent: false });
    await waitFor(() => expect(container.querySelector(".react-flow__node")).not.toBeNull());

    fireEvent.contextMenu(container.querySelector(".react-flow__pane") as HTMLElement, {
      clientX: 120,
      clientY: 90,
    });
    expect(screen.queryByTestId("context-menu")).toBeNull();
  });

  it("should enter the target board when a portal is double-clicked", async () => {
    workspace.createPortalCard({
      boardId,
      targetBoardId,
      position: { x: 520, y: 240 },
      id: "portal-enter",
    });
    const { container } = mount();
    await waitFor(() =>
      expect(container.querySelector('[data-testid="portal-node"]')).not.toBeNull(),
    );

    fireEvent.doubleClick(container.querySelector('[data-testid="portal-node"]') as HTMLElement);

    await waitFor(() => expect(useUiStore.getState().activeBoardId).toBe(targetBoardId));
    expect(useUiStore.getState().boardHistory.at(-1)).toMatchObject({
      boardId,
      via: "portal",
    });
  });
});

describe("CanvasBoard card focus", () => {
  it("should open the focus surface for a non-portal card on double-click", async () => {
    const { container } = mount();
    await waitFor(() =>
      expect(container.querySelector(`[data-node-id="${noteId}"]`)).not.toBeNull(),
    );

    fireEvent.doubleClick(container.querySelector(`[data-node-id="${noteId}"]`) as HTMLElement);

    expect(useUiStore.getState().cardFocusId).toBe(noteId);
  });
});
