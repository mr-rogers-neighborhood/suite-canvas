import type { Drawing, DrawingElement } from "@suite/graph";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WhiteboardSurface } from "./WhiteboardSurface";

/**
 * Excalidraw is mocked at the module boundary: the surface lazy-imports it, so
 * the mock is what the Suspense boundary resolves to. The fake records its
 * props (to drive `onChange`) and the imperative API it hands back (to assert
 * what a scene switch does), and it counts mounts.
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
    reset() {
      state.api = null;
      state.props = null;
      state.mounts = 0;
    },
  };
  return state;
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
      handshake?.(api);
      return () => handshake?.(null);
    }, [handshake, api]);
    return React.createElement("div", {
      className: "excalidraw",
      "data-testid": "excalidraw-stub",
    });
  }
  return { Excalidraw };
});

function element(id: string, version = 1): DrawingElement {
  return { id, type: "rectangle", x: 0, y: 0, width: 40, height: 20, version };
}

function drawing(cardId: string, elements: DrawingElement[]): Drawing {
  return {
    cardId,
    elements,
    order: elements.map((entry) => entry.id),
    version: 1,
    updatedAt: 0,
  };
}

function emitChange(elements: DrawingElement[]): void {
  const onChange = excalidraw.props?.onChange as ((next: unknown[]) => void) | undefined;
  if (!onChange) throw new Error("the surface did not pass onChange to Excalidraw");
  act(() => onChange(elements));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  excalidraw.reset();
});

describe("WhiteboardSurface", () => {
  it("should commit a settled local change once", async () => {
    const onCommit = vi.fn();
    render(<WhiteboardSurface drawing={drawing("card-1", [element("a")])} onCommit={onCommit} />);
    await screen.findByTestId("excalidraw-stub");

    emitChange([element("a"), element("b")]);

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit.mock.calls[0]?.[0]).toMatchObject({
      order: ["a", "b"],
    });
  });

  it("should apply a peer update without writing it back", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <WhiteboardSurface drawing={drawing("card-1", [element("a")])} onCommit={onCommit} />,
    );
    await screen.findByTestId("excalidraw-stub");
    const api = excalidraw.api;
    if (api === null) throw new Error("Excalidraw never handed over an API");

    rerender(
      <WhiteboardSurface drawing={drawing("card-1", [element("a", 2)])} onCommit={onCommit} />,
    );

    expect(api.updateScene).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("should re-point an existing editor when the scene identity changes", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <WhiteboardSurface
        drawing={drawing("card-1", [element("a")])}
        sceneIdentity="card-1"
        onCommit={onCommit}
      />,
    );
    await screen.findByTestId("excalidraw-stub");
    const api = excalidraw.api;
    if (api === null) throw new Error("Excalidraw never handed over an API");

    api.updateScene.mockClear();
    api.resetScene.mockClear();
    api.history.clear.mockClear();

    rerender(
      <WhiteboardSurface
        drawing={drawing("card-2", [element("b")])}
        sceneIdentity="card-2"
        onCommit={onCommit}
      />,
    );

    // One editor, re-pointed: no remount, a reset scene, no undo carry-over.
    expect(excalidraw.mounts).toBe(1);
    expect(api.resetScene).toHaveBeenCalledTimes(1);
    expect(api.history.clear).toHaveBeenCalledTimes(1);

    // The new scene is installed, as initialization rather than as an edit.
    const scene = api.updateScene.mock.calls.at(-1)?.[0] as {
      elements: DrawingElement[];
      captureUpdate?: string;
    };
    expect(scene.elements.map((entry) => entry.id)).toEqual(["b"]);
    expect(scene.captureUpdate).toBe("NEVER");

    await sleep(350);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("should drop a pending commit when the scene identity changes", async () => {
    const onCommit = vi.fn();
    const { rerender } = render(
      <WhiteboardSurface
        drawing={drawing("card-1", [element("a")])}
        sceneIdentity="card-1"
        onCommit={onCommit}
      />,
    );
    await screen.findByTestId("excalidraw-stub");

    // A local edit is waiting out the 300 ms debounce when the card switches.
    emitChange([element("a"), element("b")]);
    rerender(
      <WhiteboardSurface
        drawing={drawing("card-2", [element("c")])}
        sceneIdentity="card-2"
        onCommit={onCommit}
      />,
    );

    await sleep(350);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
