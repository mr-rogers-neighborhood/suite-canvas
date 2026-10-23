import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";
import { SceneBoard } from "./SceneBoard";

// React Flow measures its container; jsdom has no layout engine.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

const originalRect = Element.prototype.getBoundingClientRect;
const initialUi = useUiStore.getState();
const initialBoardId = initialUi.activeBoardId;

beforeAll(() => {
  useCanvasStore.setState({ ready: true, synced: true });
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

afterEach(() => {
  cleanup();
  useUiStore.setState({
    activeBoardId: initialBoardId,
    selectedNodeIds: [],
    readOnly: initialUi.readOnly,
    canEditLayout: initialUi.canEditLayout,
    canCreateContent: initialUi.canCreateContent,
    canManageTrash: initialUi.canManageTrash,
    canManageLinks: initialUi.canManageLinks,
  });
});

afterAll(() => {
  Element.prototype.getBoundingClientRect = originalRect;
});

describe("SceneBoard", () => {
  it("should show a calm empty state when no board is active", () => {
    useUiStore.setState({ activeBoardId: null });
    render(<SceneBoard />);

    expect(screen.getByTestId("scene-preview-badge")).toBeInTheDocument();
    expect(screen.getByTestId("scene-board-empty")).toBeInTheDocument();
    expect(screen.getByText("No board selected")).toBeInTheDocument();
    expect(screen.getByTestId("scene-preview-flow-link")).toHaveAttribute(
      "href",
      expect.stringContaining("canvas=flow"),
    );
  });

  it("should explain a board that no longer exists instead of crashing", () => {
    useUiStore.setState({ activeBoardId: "board-that-is-gone" });
    render(<SceneBoard />);

    expect(screen.getByTestId("scene-board-empty")).toBeInTheDocument();
    expect(screen.getByText("This board is unavailable")).toBeInTheDocument();
  });

  it("should show a calm empty state for a board with nothing on it", () => {
    const workspace = useCanvasStore.getState().workspace;
    const board = workspace.createBoard({ name: "Empty scene" });
    useUiStore.setState({ activeBoardId: board.id });

    render(
      <ReactFlowProvider>
        <SceneBoard />
      </ReactFlowProvider>,
    );

    expect(screen.getByTestId("scene-board-empty")).toBeInTheDocument();
    expect(screen.getByText("Nothing on this board yet")).toBeInTheDocument();
  });

  it("should focus a portal into the focus path and restore the camera on Escape", () => {
    const workspace = useCanvasStore.getState().workspace;
    const root = workspace.createBoard({ name: "Scene root" });
    const target = workspace.createBoard({ name: "Scene sources" });
    workspace.createPortalCard({
      id: "scene-portal",
      boardId: root.id,
      position: { x: 0, y: 0 },
      targetBoardId: target.id,
      size: { width: 400, height: 320 },
    });
    useUiStore.setState({ activeBoardId: root.id });

    render(
      <ReactFlowProvider>
        <SceneBoard />
      </ReactFlowProvider>,
    );

    const portal = document.querySelector<HTMLElement>('[data-testid="scene-portal"]');
    expect(portal).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Focus Scene sources/ }));
    expect(screen.getByTestId("scene-preview-root")).toHaveTextContent(
      "Scene root / Scene sources",
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("scene-preview-root")).not.toHaveTextContent("/ Scene sources");
  });

  it("should clear the scene selection on Escape", () => {
    const workspace = useCanvasStore.getState().workspace;
    const board = workspace.createBoard({ name: "Scene root" });
    const card = workspace.createCard({
      typeId: "note",
      boardId: board.id,
      position: { x: 0, y: 0 },
    });
    useUiStore.setState({ activeBoardId: board.id, selectedNodeIds: [card.id] });

    render(
      <ReactFlowProvider>
        <SceneBoard />
      </ReactFlowProvider>,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUiStore.getState().selectedNodeIds).toEqual([]);
  });

  it("should let the focus path claim Escape before the selection", () => {
    const workspace = useCanvasStore.getState().workspace;
    const root = workspace.createBoard({ name: "Scene root" });
    const target = workspace.createBoard({ name: "Scene sources" });
    workspace.createPortalCard({
      id: "scene-portal-escape",
      boardId: root.id,
      position: { x: 0, y: 0 },
      targetBoardId: target.id,
      size: { width: 400, height: 320 },
    });
    useUiStore.setState({ activeBoardId: root.id });

    render(
      <ReactFlowProvider>
        <SceneBoard />
      </ReactFlowProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Focus Scene sources/ }));
    expect(screen.getByTestId("scene-preview-root")).toHaveTextContent(
      "Scene root / Scene sources",
    );
    const selected = useUiStore.getState().selectedNodeIds;

    fireEvent.keyDown(window, { key: "Escape" });
    // Back navigation wins the first Escape; the selection survives it.
    expect(screen.getByTestId("scene-preview-root")).not.toHaveTextContent("/ Scene sources");
    expect(useUiStore.getState().selectedNodeIds).toEqual(selected);

    // At the root there is no camera step left, so Escape clears the selection.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUiStore.getState().selectedNodeIds).toEqual([]);
  });

  it("should select an edge and open the shared edge menu on right click", () => {
    const workspace = useCanvasStore.getState().workspace;
    const board = workspace.createBoard({ name: "Scene edges" });
    const source = workspace.createCard({
      typeId: "note",
      boardId: board.id,
      position: { x: 0, y: 0 },
    });
    const target = workspace.createCard({
      typeId: "note",
      boardId: board.id,
      position: { x: 600, y: 0 },
    });
    const edge = workspace.addEdge({
      boardId: board.id,
      source: source.id,
      target: target.id,
    });
    if (!edge) throw new Error("edge fixture did not create");
    workspace.setEdgePath(edge.id, "straight");
    useUiStore.setState({ activeBoardId: board.id, selectedNodeIds: [], selectedEdgeIds: [] });

    render(
      <ReactFlowProvider>
        <SceneBoard />
      </ReactFlowProvider>,
    );

    const path = document.querySelector<SVGPathElement>('[data-testid="scene-edge"]');
    expect(path).not.toBeNull();
    const match = (path?.getAttribute("d") ?? "").match(
      /^M (-?[\d.]+) (-?[\d.]+) L (-?[\d.]+) (-?[\d.]+)$/,
    );
    if (!match) throw new Error("unexpected edge path");
    const ax = Number(match[1]);
    const ay = Number(match[2]);
    const bx = Number(match[3]);
    const by = Number(match[4]);
    const middle = { x: (ax + bx) / 2, y: (ay + by) / 2 };

    fireEvent.contextMenu(screen.getByTestId("scene-surface"), {
      clientX: middle.x,
      clientY: middle.y,
    });

    expect(useUiStore.getState().contextMenu).toMatchObject({ kind: "edge", edgeId: edge.id });
    expect(useUiStore.getState().selectedEdgeIds).toEqual([edge.id]);
    expect(screen.getByTestId("context-menu")).toBeInTheDocument();
  });

  it("should mount the React Flow camera and project a real board", () => {
    const workspace = useCanvasStore.getState().workspace;
    const board = workspace.createBoard({ name: "Scene root" });
    workspace.createCard({ typeId: "note", boardId: board.id, position: { x: 0, y: 0 } });
    useUiStore.setState({ activeBoardId: board.id });

    render(
      <ReactFlowProvider>
        <SceneBoard />
      </ReactFlowProvider>,
    );

    expect(screen.getByTestId("scene-preview-badge")).toBeInTheDocument();
    expect(screen.getByTestId("scene-preview-root")).toHaveTextContent("Scene root");
    expect(screen.getByTestId("scene-layer")).toBeInTheDocument();
    expect(screen.getAllByTestId("scene-card").length).toBeGreaterThan(0);
  });
  it("should let a viewer select and enter portals but block drag, resize and creation", () => {
    const workspace = useCanvasStore.getState().workspace;
    const root = workspace.createBoard({ name: "Viewer scene" });
    const target = workspace.createBoard({ name: "Viewer target" });
    const card = workspace.createCard({
      typeId: "note",
      boardId: root.id,
      position: { x: 0, y: 0 },
    });
    workspace.createPortalCard({
      id: "viewer-portal",
      boardId: root.id,
      position: { x: 0, y: 220 },
      targetBoardId: target.id,
      size: { width: 400, height: 280 },
    });
    // The viewer shorthand on top of the capability matrix: no write path opens.
    useUiStore.setState({ activeBoardId: root.id, readOnly: true, selectedNodeIds: [] });

    render(
      <ReactFlowProvider>
        <SceneBoard />
      </ReactFlowProvider>,
    );

    const surface = screen.getByTestId("scene-surface");
    fireEvent.pointerDown(surface, { clientX: 40, clientY: 40, button: 0, pointerId: 1 });
    expect(useUiStore.getState().selectedNodeIds).toEqual([card.id]);
    fireEvent.pointerMove(surface, { clientX: 160, clientY: 140, pointerId: 1 });
    fireEvent.pointerUp(surface, {
      clientX: 160,
      clientY: 140,
      button: 0,
      pointerId: 1,
    });

    expect(useUiStore.getState().selectedNodeIds).toEqual([card.id]);
    expect(workspace.getPlacement(root.id, card.id)).toMatchObject({ x: 0, y: 0 });
    expect(document.querySelector('[data-testid="scene-resize-handle"]')).toBeNull();

    // Portals stay enterable for a reader.
    fireEvent.click(screen.getByRole("button", { name: /Focus Viewer target/ }));
    expect(screen.getByTestId("scene-preview-root")).toHaveTextContent(
      "Viewer scene / Viewer target",
    );

    // The shared menu keeps only non-destructive, non-creating entries.
    fireEvent.contextMenu(surface, { clientX: 900, clientY: 500 });
    expect(screen.queryByText("New note")).not.toBeInTheDocument();
    expect(screen.queryByText("New section")).not.toBeInTheDocument();
    expect(screen.queryByText("Delete cards")).not.toBeInTheDocument();
  });
});
