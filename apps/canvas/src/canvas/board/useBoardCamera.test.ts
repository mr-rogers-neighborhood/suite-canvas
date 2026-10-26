import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../../store/useUiStore";
import { useBoardCamera } from "./useBoardCamera";
import type { useBoardProjection } from "./useBoardProjection";
import type { useBoardUi } from "./useBoardUi";

/**
 * The reveal behind `card.focus` and `section.focus` — reachable from the
 * palette and the outline — is a camera flight. A reader who asked for reduced
 * motion gets the destination, not the journey, so the duration the camera
 * hands React Flow is the thing to assert.
 */
function cameraHarness() {
  const setViewport = vi.fn(async (_viewport: unknown, _options?: { duration?: number }) => true);
  const fitView = vi.fn(async () => true);
  const clearFocusTarget = vi.fn();
  const ui = {
    activeBoardId: "board-1",
    snapshot: {
      sections: [{ id: "section-1", boardId: "board-1", x: 0, y: 0, width: 400, height: 300 }],
    },
    store: {
      getState: () => ({
        width: 1200,
        height: 800,
        minZoom: 0.1,
        nodeLookup: new Map(),
        transform: [0, 0, 1],
      }),
    },
    focusTarget: { kind: "section", id: "section-1", boardId: "board-1" },
    clearFocusTarget,
    setActiveBoardId: vi.fn(),
    setViewport,
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    fitView,
    viewportRequest: null,
    clearViewportRequest: vi.fn(),
    recordBoardViewport: vi.fn(),
    goBackBoard: vi.fn(),
    requestPortalEntry: vi.fn(),
    portalOpenRequest: null,
    clearPortalOpenRequest: vi.fn(),
  } as unknown as ReturnType<typeof useBoardUi>;
  const projection = { cardsById: new Map() } as unknown as ReturnType<typeof useBoardProjection>;
  return { ui, projection, setViewport, clearFocusTarget, fitView };
}

const reveal = (harness: ReturnType<typeof cameraHarness>) => {
  renderHook(() => useBoardCamera(harness.ui, { projection: harness.projection }));
  expect(harness.setViewport).toHaveBeenCalledTimes(1);
  // The reveal is consumed: a focus request lands once.
  expect(harness.clearFocusTarget).toHaveBeenCalled();
  return harness.setViewport.mock.calls[0]?.[1];
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.motion;
});

describe("focus reveal motion", () => {
  it("flies when motion is allowed", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    document.documentElement.dataset.motion = "full";

    expect(reveal(cameraHarness())).toEqual({ duration: 300 });
  });

  it("jumps when the OS asks for reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));

    expect(reveal(cameraHarness())).toEqual({ duration: 0 });
  });

  it("jumps when the app's own Appearance setting asks for reduced motion", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    document.documentElement.dataset.motion = "reduced";

    expect(reveal(cameraHarness())).toEqual({ duration: 0 });
  });
});

describe("zoom to selection", () => {
  it("frames exactly the cards that are selected", () => {
    useUiStore.setState({ selectedNodeIds: ["card-a", "card-b"] });
    const harness = cameraHarness();
    const { result } = renderHook(() =>
      useBoardCamera(harness.ui, { projection: harness.projection }),
    );

    act(() => result.current.zoomToSelection());

    expect(harness.fitView).toHaveBeenCalledWith({
      nodes: [{ id: "card-a" }, { id: "card-b" }],
      padding: 0.2,
      duration: 300,
      maxZoom: 1,
    });
  });

  it("does nothing without a selection", () => {
    useUiStore.setState({ selectedNodeIds: [] });
    const harness = cameraHarness();
    const { result } = renderHook(() =>
      useBoardCamera(harness.ui, { projection: harness.projection }),
    );

    act(() => result.current.zoomToSelection());

    expect(harness.fitView).not.toHaveBeenCalled();
  });

  it("arrives instead of flying when motion is reduced", () => {
    useUiStore.setState({ selectedNodeIds: ["card-a"] });
    document.documentElement.dataset.motion = "reduced";
    const harness = cameraHarness();
    const { result } = renderHook(() =>
      useBoardCamera(harness.ui, { projection: harness.projection }),
    );

    act(() => result.current.zoomToSelection());

    expect(harness.fitView).toHaveBeenCalledWith(expect.objectContaining({ duration: 0 }));
  });
});
