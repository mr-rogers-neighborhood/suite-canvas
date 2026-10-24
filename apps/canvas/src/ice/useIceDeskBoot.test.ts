import type { WorkspaceDocument } from "@suite/graph";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Entity } from "@vibecook/ice";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SeedReport } from "./iceSurfaceSpawns";
import {
  demoModeFromSearch,
  seedDemoDocument,
  seedSuiteDocument,
  seedWorkspaceDocument,
  spawnLinkEdges,
} from "./iceSurfaceSpawns";
import { useIceDeskBoot } from "./useIceDeskBoot";

/**
 * The boot's lifetime, in jsdom. ICE is mocked down to the three things this
 * hook touches — the device, the engine and the desk layer — because the one
 * question here is what a re-render costs: a View switch re-seeds the desk it
 * already has, and nothing else in the surface's life destroys the device.
 */
const ice = vi.hoisted(() => {
  const destroy = vi.fn();
  const dispose = vi.fn();
  const close = vi.fn();
  const acquireCompositorDevice = vi.fn(async () => ({
    adapter: { info: { vendor: "Acme", architecture: "gen-1", device: "fake-gpu" } },
    device: {},
    enabled: [],
    hasTimestampQuery: false,
    errors: () => [],
    destroy,
  }));
  const setSelection = vi.fn();
  const deleteSelection = vi.fn();
  const engines: {
    ops: { setSelection: typeof setSelection; deleteSelection: typeof deleteSelection };
  }[] = [];
  const createCanvasEngine = vi.fn(() => {
    const engine = {
      docs: { create: () => ({ close }) },
      ops: { setSelection, deleteSelection },
      dispose,
    };
    engines.push(engine);
    return engine;
  });
  return {
    acquireCompositorDevice,
    close,
    createCanvasEngine,
    deleteSelection,
    destroy,
    dispose,
    engines,
    setSelection,
  };
});

vi.mock("@vibecook/ice", () => ({
  acquireCompositorDevice: ice.acquireCompositorDevice,
  createCanvasEngine: ice.createCanvasEngine,
  // The boot restores a View only when the document says it moved; the jsdom
  // desk has no nav stack, so the camera is always read on the plane.
  currentNavFrame: vi.fn(() => undefined),
}));
vi.mock("@vibecook/ice/desk", () => ({
  deskLayer: vi.fn(() => ({ status: () => ({ state: "ready" }) })),
  inkRaster: vi.fn(() => ({})),
}));
vi.mock("@vibecook/ice/desk/objects", () => ({
  DESK_ENGINE: { widgets: [] },
  DESK_OBJECTS: [],
  deskPalette: vi.fn(() => ({})),
  deskTheme: vi.fn(() => ({})),
}));
vi.mock("@vibecook/ice/react", () => ({
  Desk: () => null,
  EngineProvider: (props: { children?: unknown }) => props.children,
}));
vi.mock("./suiteCardKind", () => ({
  SUITE_CARD_RUNGS: [{ scale: 1, type: "suite.card", object: { type: "suite.card" } }],
  setSuiteCardSlotRenderer: vi.fn(),
}));
vi.mock("./suiteCardWorkspace", () => ({
  createWorkspaceCardSlotRenderer: vi.fn(() => ({ mount: vi.fn() })),
}));
vi.mock("./suitePinKind", () => ({ SuitePin: { type: "suite.pin" } }));
vi.mock("./suiteBoardKind", () => ({ SuiteBoard: { type: "suite.board" } }));
vi.mock("./suiteEdgeKind", () => ({
  SuiteEdge: { type: "suite.edge" },
  setSuiteEdgeLinkOf: vi.fn(),
}));
vi.mock("./iceSurfaceSpawns", () => ({
  demoModeFromSearch: vi.fn(() => "native"),
  seedDemoDocument: vi.fn(() => report()),
  seedSuiteDocument: vi.fn(() => report()),
  seedWorkspaceDocument: vi.fn(() => report()),
  spawnLinkEdges: vi.fn(() => ({ sync: vi.fn(), debug: () => [], dispose: vi.fn() })),
}));

/** An entity id; the mocked engine hands back plain numbers for them. */
function entity(id: number): Entity {
  return id as unknown as Entity;
}

function report(entities: readonly number[] = []): SeedReport {
  return {
    mode: "workspace",
    label: "Workspace",
    seeded: 0,
    total: 0,
    kinds: [],
    failures: [],
    entities: entities.map(entity),
    entitySlots: new Map(),
    boardMats: new Map(),
    stubs: 0,
    pinEntities: new Map(),
    boards: 0,
    skipped: [],
  };
}

function stubGpu(): void {
  Object.defineProperty(navigator, "gpu", {
    configurable: true,
    value: { requestAdapter: async () => ({ info: { vendor: "Acme" } }) },
  });
}

/**
 * The hook hands the workspace to the seeded projection, which is mocked, and
 * reads one View from it to decide whether a camera is restored. The Board tree
 * is read for the structural key a re-seed compares.
 */
const workspace = {
  getView: () => undefined,
  hasStoredCamera: () => false,
  listBoards: () => [],
} as unknown as WorkspaceDocument;

function bootHook(root: string) {
  return renderHook(
    (props: { root: string }) => useIceDeskBoot({ workspace, rootBoardId: props.root }),
    { initialProps: { root } },
  );
}

afterEach(() => {
  Reflect.deleteProperty(navigator, "gpu");
  vi.clearAllMocks();
  ice.engines.length = 0;
});

describe("useIceDeskBoot", () => {
  it("should keep the device and the desk when the View changes", async () => {
    stubGpu();
    const hook = bootHook("view-a");

    await waitFor(() => expect(hook.result.current.phase.kind).toBe("ready"));
    await waitFor(() => expect(hook.result.current.seed).not.toBeNull());
    expect(seedWorkspaceDocument).toHaveBeenLastCalledWith(ice.engines[0], workspace, "view-a");

    act(() => hook.rerender({ root: "view-b" }));

    // The same engine is re-seeded with the new root: no second device, no
    // second engine, nothing disposed.
    await waitFor(() => expect(seedWorkspaceDocument).toHaveBeenCalledTimes(2));
    expect(seedWorkspaceDocument).toHaveBeenLastCalledWith(ice.engines[0], workspace, "view-b");
    expect(ice.createCanvasEngine).toHaveBeenCalledTimes(1);
    expect(ice.acquireCompositorDevice).toHaveBeenCalledTimes(1);
    expect(ice.destroy).not.toHaveBeenCalled();
    expect(ice.dispose).not.toHaveBeenCalled();
    expect(hook.result.current.phase.kind).toBe("ready");

    hook.unmount();
    expect(ice.destroy).toHaveBeenCalledTimes(1);
    expect(ice.dispose).toHaveBeenCalledTimes(1);
    expect(ice.close).toHaveBeenCalledTimes(1);
  });

  it("should replace the previous View's entities instead of stacking them", async () => {
    stubGpu();
    const first = report();
    const second = report();
    vi.mocked(seedWorkspaceDocument)
      .mockReturnValueOnce({ ...first, entities: [entity(11), entity(12)] })
      .mockReturnValueOnce({ ...second, entities: [entity(21)] });
    const hook = bootHook("view-a");

    await waitFor(() => expect(hook.result.current.seed?.entities).toEqual([11, 12]));

    act(() => hook.rerender({ root: "view-b" }));

    await waitFor(() => expect(hook.result.current.seed?.entities).toEqual([21]));
    // The desk the camera is looking at is cleared before it is re-seeded, so a
    // switch cannot leave the old View's cards on the mat.
    expect(ice.setSelection).toHaveBeenCalledWith([entity(11), entity(12)]);
    expect(ice.deleteSelection).toHaveBeenCalledTimes(1);
  });

  it("should still rebuild the desk when the demo changes", async () => {
    stubGpu();
    const hook = renderHook(() => useIceDeskBoot({ workspace: undefined, rootBoardId: null }));

    await waitFor(() => expect(seedDemoDocument).toHaveBeenCalledTimes(1));
    act(() => hook.result.current.chooseDemo("suite"));

    await waitFor(() => expect(seedSuiteDocument).toHaveBeenCalledTimes(1));
    expect(ice.createCanvasEngine).toHaveBeenCalledTimes(2);
    expect(ice.acquireCompositorDevice).toHaveBeenCalledTimes(2);
    // A Reset is a different desk, so the first one is released.
    expect(ice.destroy).toHaveBeenCalledTimes(1);
    expect(ice.dispose).toHaveBeenCalledTimes(1);

    hook.unmount();
    expect(ice.destroy).toHaveBeenCalledTimes(2);
  });

  it("should wait for a root Board before it acquires a device", async () => {
    stubGpu();
    const hook = renderHook(() => useIceDeskBoot({ workspace, rootBoardId: null }));

    await waitFor(() => expect(hook.result.current.phase.kind).toBe("checking"));
    expect(ice.acquireCompositorDevice).not.toHaveBeenCalled();
    expect(ice.createCanvasEngine).not.toHaveBeenCalled();
  });

  it("should seed the demo without a workspace", async () => {
    stubGpu();
    const hook = renderHook(() => useIceDeskBoot({ workspace: undefined, rootBoardId: null }));

    await waitFor(() => expect(hook.result.current.seed).not.toBeNull());
    expect(demoModeFromSearch).toHaveBeenCalled();
    expect(spawnLinkEdges).not.toHaveBeenCalled();
    expect(hook.result.current.phase.kind).toBe("ready");
  });
});
