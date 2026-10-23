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
const initialBoardId = useUiStore.getState().activeBoardId;

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
  useUiStore.setState({ activeBoardId: initialBoardId });
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
});
