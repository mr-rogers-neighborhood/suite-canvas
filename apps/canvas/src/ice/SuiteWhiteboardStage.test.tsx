import type { Drawing } from "@suite/graph";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SuiteWhiteboardStage } from "./SuiteWhiteboardStage";

/**
 * The stage's job is boundaries, not Excalidraw: one editor, one scene identity,
 * local gestures, a preview underlay and a clean teardown. Excalidraw is mocked
 * at the module boundary (the surface lazy-imports it) and each drawing is read
 * through a mocked `useDrawing`, so every assertion is about the stage.
 */
const excalidraw = vi.hoisted(() => {
  interface FakeApi {
    updateScene: ReturnType<typeof vi.fn>;
    resetScene: ReturnType<typeof vi.fn>;
    history: { clear: ReturnType<typeof vi.fn> };
  }
  const state = {
    api: null as FakeApi | null,
    props: null as Record<string, unknown> | null,
    mounts: 0,
    handoffs: [] as unknown[],
    /** Whether the fake mounts Excalidraw's own root (its "first paint"). */
    painted: true,
    reset() {
      state.api = null;
      state.props = null;
      state.mounts = 0;
      state.handoffs = [];
      state.painted = true;
    },
  };
  return state;
});

const fixtures = vi.hoisted(() => {
  const drawing = (cardId: string, id: string) => ({
    cardId,
    elements: [{ id, type: "rectangle", x: 0, y: 0, width: 40, height: 20, version: 1 }],
    order: [id],
    version: 1,
    updatedAt: 0,
  });
  const drawings: Record<string, Drawing> = {
    "card-a": drawing("card-a", "a-1"),
    "card-b": drawing("card-b", "b-1"),
  };
  return { drawings };
});

vi.mock("@excalidraw/excalidraw", async () => {
  const React = await import("react");
  function Excalidraw(props: Record<string, unknown>) {
    excalidraw.props = props;
    const [api] = React.useState(() => {
      excalidraw.mounts += 1;
      const value = {
        updateScene: vi.fn(),
        resetScene: vi.fn(),
        history: { clear: vi.fn() },
      };
      excalidraw.api = value;
      return value;
    });
    const handshake = props.excalidrawAPI as ((value: unknown) => void) | undefined;
    React.useEffect(() => {
      excalidraw.handoffs.push(api);
      handshake?.(api);
      return () => {
        excalidraw.handoffs.push(null);
        handshake?.(null);
      };
    }, [handshake, api]);
    return React.createElement(
      "div",
      { "data-testid": "excalidraw-stub" },
      excalidraw.painted ? React.createElement("div", { className: "excalidraw" }) : null,
    );
  }
  return { Excalidraw };
});

vi.mock("../hooks/useDrawing", () => ({
  useDrawing: (cardId: string | null) =>
    cardId === null ? null : (fixtures.drawings[cardId] ?? null),
}));

const BOX = { left: 10, top: 20, width: 320, height: 200, scale: 1 };

interface StageProps {
  activeCardId?: string | null;
  box?: typeof BOX | null;
  readOnly?: boolean;
  suspended?: boolean;
  onCommit?: (cardId: string, commit: { elements: unknown[]; order: string[] }) => void;
  onExit?: () => void;
}

function stage(overrides: StageProps = {}) {
  return (
    <SuiteWhiteboardStage
      activeCardId="card-a"
      box={BOX}
      onCommit={vi.fn()}
      onExit={vi.fn()}
      {...overrides}
    />
  );
}

function wrap(children: ReactNode, spy: () => void) {
  return (
    <div onWheel={spy} onPointerDown={spy} onPointerMove={spy}>
      {children}
    </div>
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  excalidraw.reset();
});

describe("SuiteWhiteboardStage", () => {
  it("should render nothing without an active card", () => {
    const { container } = render(stage({ activeCardId: null, box: null }));

    expect(container).toBeEmptyDOMElement();
    expect(excalidraw.mounts).toBe(0);
  });

  it("should mount exactly one editor for one active card", async () => {
    render(stage());

    await screen.findByTestId("excalidraw-stub");
    expect(screen.getAllByTestId("excalidraw-stub")).toHaveLength(1);
    expect(excalidraw.mounts).toBe(1);
  });

  it("should keep the preview underlay until the editor paints", async () => {
    excalidraw.painted = false;
    const { rerender } = render(stage());
    await screen.findByTestId("excalidraw-stub");

    // No Excalidraw root yet: the SVG preview is what the reader sees, and the
    // editor is mounted underneath at zero opacity.
    expect(screen.getByTestId("suite-whiteboard-stage-preview")).toBeInTheDocument();
    expect(screen.getByTestId("suite-whiteboard-stage-editor")).toHaveStyle({ opacity: "0" });

    excalidraw.painted = true;
    rerender(stage());

    await waitFor(() => {
      expect(screen.queryByTestId("suite-whiteboard-stage-preview")).toBeNull();
    });
    expect(screen.getByTestId("suite-whiteboard-stage-editor")).toHaveStyle({ opacity: "1" });
  });

  it("should re-point one editor at the new card without emitting a commit", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(stage({ onCommit }));
    await screen.findByTestId("excalidraw-stub");
    const api = excalidraw.api;
    if (api === null) throw new Error("Excalidraw never handed over an API");
    api.updateScene.mockClear();
    api.resetScene.mockClear();

    rerender(stage({ activeCardId: "card-b", onCommit }));

    // The new scene identity crossed the boundary: the editor was reset and
    // re-pointed at card-b's drawing in the same instance.
    expect(api.resetScene).toHaveBeenCalledTimes(1);
    const scene = api.updateScene.mock.calls.at(-1)?.[0] as { elements: Array<{ id: string }> };
    expect(scene.elements.map((entry) => entry.id)).toEqual(["b-1"]);
    expect(excalidraw.mounts).toBe(1);
    expect(screen.getByTestId("suite-whiteboard-stage")).toHaveAttribute("data-card-id", "card-b");

    await sleep(350);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("should commit a settled local edit for the active card", async () => {
    const onCommit = vi.fn();
    render(stage({ onCommit }));
    await screen.findByTestId("excalidraw-stub");
    const onChange = excalidraw.props?.onChange as ((next: unknown[]) => void) | undefined;
    if (!onChange) throw new Error("the stage did not pass onChange to Excalidraw");
    const cardA = fixtures.drawings["card-a"];
    const first = cardA?.elements[0];
    if (cardA === undefined || first === undefined) throw new Error("fixture missing");

    onChange([...cardA.elements, { ...first, id: "a-2" }]);

    await sleep(350);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0]?.[0]).toBe("card-a");
  });

  it("should hide the editor while suspended without unmounting it", async () => {
    const { rerender } = render(stage());
    await screen.findByTestId("excalidraw-stub");
    const mountsBefore = excalidraw.mounts;

    rerender(stage({ suspended: true }));

    const shell = screen.getByTestId("suite-whiteboard-stage");
    expect(shell).toHaveAttribute("data-suspended", "true");
    expect(shell).toHaveStyle({ pointerEvents: "none" });
    expect(screen.getByTestId("suite-whiteboard-stage-editor")).toHaveStyle({
      contentVisibility: "hidden",
      pointerEvents: "none",
    });
    expect(screen.getByTestId("excalidraw-stub")).toBeInTheDocument();
    expect(excalidraw.mounts).toBe(mountsBefore);
  });

  it("should call onExit on Escape", async () => {
    const onExit = vi.fn();
    render(stage({ onExit }));
    await screen.findByTestId("excalidraw-stub");
    const shell = screen.getByTestId("suite-whiteboard-stage");

    fireEvent.keyDown(shell, { key: "Enter" });
    expect(onExit).not.toHaveBeenCalled();

    fireEvent.keyDown(shell, { key: "Escape" });
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("should keep wheel and pointer events inside the card", async () => {
    const outer = vi.fn();
    render(wrap(stage(), outer));
    await screen.findByTestId("excalidraw-stub");
    const editor = screen.getByTestId("excalidraw-stub");

    fireEvent.wheel(editor);
    fireEvent.pointerDown(editor);
    fireEvent.pointerMove(editor);

    expect(outer).not.toHaveBeenCalled();
  });

  it("should release the editor on unmount", async () => {
    const { unmount, container } = render(stage());
    await screen.findByTestId("excalidraw-stub");

    unmount();

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("excalidraw-stub")).toBeNull();
    // The surface handed the imperative API back when the editor unmounted.
    expect(excalidraw.handoffs.at(-1)).toBeNull();
  });
});
