import { WorkspaceDocument } from "@suite/graph";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "../store/useUiStore";
import { demoModeFromSearch, IceSurface } from "./IceSurface";

/**
 * The ICE modules are mocked so the wiring (detection, adapter reporting,
 * seeding, reset and teardown) is covered in jsdom, where WebGPU does not
 * exist. The real modules are never imported by these tests.
 */
const ice = vi.hoisted(() => {
  const layerStatus: {
    current: { state: "ready" | "degraded" | "failed"; message?: string };
  } = {
    current: { state: "ready" },
  };
  const unsubscribe = vi.fn();
  const layer = {
    status: () => layerStatus.current,
    onStatus: vi.fn(() => unsubscribe),
  };
  const deskLayer = vi.fn(() => () => layer);
  const close = vi.fn();
  const destroyDevice = vi.fn();
  const dispose = vi.fn();
  const acquireCompositorDevice = vi.fn(async () => {
    const api = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
    const adapter = await api?.requestAdapter();
    if (adapter === null || adapter === undefined) {
      throw new Error("WebGPU: requestAdapter() returned null");
    }
    return {
      adapter,
      device: {},
      enabled: [],
      hasTimestampQuery: false,
      errors: () => [],
      destroy: destroyDevice,
    };
  });
  let entity = 0;
  const spawn = (_type: string, _opts: unknown) => {
    entity += 1;
    return { entity };
  };
  const spawnWidget = vi.fn(spawn);
  const step = vi.fn();
  const setSelection = vi.fn();
  const deleteSelection = vi.fn();
  const cancelActiveGestures = vi.fn();
  // The camera the surface reads and writes. Off by default so the tests that
  // only cover seeding never see a camera at all; the graph-band tests turn it
  // on and then can assert the flight's destination.
  const Camera = { name: "Camera" };
  const Viewport = { name: "Viewport" };
  const cameraWorld = {
    enabled: false,
    camera: { x: 100, y: 50, zoom: 1, gesturing: false },
    viewport: { w: 1200, h: 800, dpr: 1 },
  };
  const writeRuntimeResource = vi.fn((_world: unknown, resource: unknown, value: unknown) => {
    if (resource === Camera && value !== null && typeof value === "object") {
      Object.assign(cameraWorld.camera, value);
    }
  });
  const world = {
    getResource: (resource: unknown) => {
      if (!cameraWorld.enabled) return undefined;
      if (resource === Camera) return cameraWorld.camera;
      if (resource === Viewport) return cameraWorld.viewport;
      return undefined;
    },
    read: () => undefined,
  };
  const createCanvasEngine = vi.fn(() => ({
    docs: { create: () => ({ close }) },
    ops: { spawnWidget, zoomToFit: vi.fn(), setSelection, deleteSelection, cancelActiveGestures },
    step,
    dispose,
    world,
  }));
  const keymap: { current: readonly { key: string; run: (engine: unknown) => void }[] | null } = {
    current: null,
  };
  return {
    Camera,
    Viewport,
    acquireCompositorDevice,
    cameraWorld,
    cancelActiveGestures,
    close,
    createCanvasEngine,
    deleteSelection,
    deskLayer,
    deskPalette: vi.fn(() => ({})),
    deskTheme: vi.fn(() => ({})),
    destroyDevice,
    dispose,
    keymap,
    layer,
    layerStatus,
    resetCamera: () => {
      cameraWorld.enabled = false;
      cameraWorld.camera = { x: 100, y: 50, zoom: 1, gesturing: false };
      cameraWorld.viewport = { w: 1200, h: 800, dpr: 1 };
      keymap.current = null;
    },
    resetSpawn: () => {
      entity = 0;
      spawnWidget.mockReset();
      spawnWidget.mockImplementation(spawn);
      setSelection.mockReset();
      deleteSelection.mockReset();
      cancelActiveGestures.mockReset();
      writeRuntimeResource.mockClear();
    },
    setSelection,
    spawnWidget,
    step,
    unsubscribe,
    writeRuntimeResource,
    world,
  };
});

vi.mock("@vibecook/ice", () => ({
  Camera: ice.Camera,
  Viewport: ice.Viewport,
  acquireCompositorDevice: ice.acquireCompositorDevice,
  createCanvasEngine: ice.createCanvasEngine,
  selectedEntities: vi.fn(() => []),
  writeRuntimeResource: ice.writeRuntimeResource,
}));
vi.mock("@vibecook/ice/desk", () => ({
  deskLayer: ice.deskLayer,
  // The desk asks for a text raster to write notes with; in jsdom there is no
  // font to measure, so it reports no metrics and every sheet stays blank.
  inkRaster: () => ({
    metrics: () => undefined,
    version: () => 0,
    raster: () => ({ bytes: new Uint8Array(0), w: 0, h: 0 }),
  }),
}));
vi.mock("@vibecook/ice/desk/objects", () => ({
  DESK_ENGINE: { widgets: [] },
  DESK_OBJECTS: [],
  deskPalette: ice.deskPalette,
  deskTheme: ice.deskTheme,
}));
vi.mock("@vibecook/ice/react", async () => {
  const { createElement, useEffect } = await import("react");
  return {
    Desk: (props: {
      onReady?: (handle: unknown) => undefined | (() => void);
      keymapOverrides?: readonly { key: string; run: (engine: unknown) => void }[];
    }) => {
      ice.keymap.current = props.keymapOverrides ?? null;
      useEffect(() => props.onReady?.({ layer: ice.layer }), [props.onReady]);
      return createElement("div", { "data-testid": "ice-desk-mock" });
    },
    EngineProvider: (props: { children?: unknown }) => props.children,
  };
});
vi.mock("./suiteCardKind", () => ({
  SuiteCard: { type: "suite.card" },
  // The type ladder: the base rung plus the 2x rung, as the desk registers them.
  SUITE_CARD_RUNGS: [
    { scale: 1, type: "suite.card", object: { type: "suite.card" } },
    { scale: 2, type: "suite.card@2", object: { type: "suite.card@2" } },
  ],
  setSuiteCardSlotRenderer: vi.fn(),
}));
vi.mock("./suiteCardWorkspace", () => ({
  createWorkspaceCardSlotRenderer: vi.fn(() => ({ mount: vi.fn() })),
}));
vi.mock("./suitePinKind", () => ({
  SuitePin: { type: "suite.pin" },
  SUITE_PIN_TYPE: "suite.pin",
}));
// The graph band's two kinds, mocked the same way the card kind is: the real
// modules build a GPU-backed prefab on import, which jsdom cannot do.
vi.mock("./suiteTypeNodeKind", () => ({
  SUITE_TYPE_NODE_TYPE: "suite.typeNode",
  SuiteTypeNode: { type: "suite.typeNode" },
  suiteTypeNodeSpawn: (node: {
    key: string;
    label: string;
    glyph: string;
    count: number;
    depth: number;
    color?: string | undefined;
    x: number;
    y: number;
    width: number;
    height: number;
  }) => ({
    type: "suite.typeNode",
    x: node.x,
    y: node.y,
    w: node.width,
    h: node.height,
    props: {
      nodeKey: node.key,
      label: node.label,
      glyph: node.glyph,
      count: node.count,
      depth: node.depth,
      color: node.color ?? "",
    },
  }),
}));
vi.mock("./suiteContainerNodeKind", () => ({
  SUITE_CONTAINER_NODE_TYPE: "suite.containerNode",
  SuiteContainerNode: { type: "suite.containerNode" },
  suiteContainerNodeSpawn: (node: {
    key: string;
    label: string;
    count: number;
    depth: number;
    color?: string | undefined;
    x: number;
    y: number;
    width: number;
    height: number;
  }) => ({
    type: "suite.containerNode",
    x: node.x,
    y: node.y,
    w: node.width,
    h: node.height,
    props: {
      containerKey: node.key,
      label: node.label,
      count: node.count,
      depth: node.depth,
      color: node.color ?? "",
    },
  }),
}));

const ADAPTER = {
  info: {
    vendor: "Acme",
    architecture: "gen-1",
    device: "fake-gpu",
    description: "the test adapter",
    isFallback: false,
  },
};

function stubGpu(value: unknown): void {
  Object.defineProperty(navigator, "gpu", { configurable: true, value });
}

function stubClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
}

/**
 * Wait until the surface's editing effect is attached: the desk's `onReady`
 * starts it, and everything the graph band needs (the ceiling, the wheel
 * membrane, the commands) lives there.
 */
async function settled(): Promise<void> {
  await screen.findByTestId("ice-desk-mock");
  await waitFor(() => expect(ice.layer.onStatus).toHaveBeenCalled());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

/** Ask for no motion, so a flight lands in one write instead of a frame loop. */
function stubReducedMotion(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  Reflect.deleteProperty(navigator, "gpu");
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(window, "matchMedia");
  ice.layerStatus.current = { state: "ready" };
  ice.resetCamera();
  ice.resetSpawn();
  useUiStore.setState({ graphViewRequest: 0, selectedNodeIds: [] });
  vi.clearAllMocks();
});

describe("IceSurface", () => {
  it("should explain a browser without WebGPU and never load the ICE modules", async () => {
    render(<IceSurface />);

    expect(await screen.findByTestId("ice-fallback")).toBeInTheDocument();
    expect(screen.getByTestId("ice-fallback-title")).toHaveTextContent(
      "This browser has no WebGPU",
    );
    expect(screen.getByTestId("ice-fallback-detail")).toHaveTextContent("navigator.gpu");
    expect(screen.getByTestId("ice-fallback-copy")).toHaveTextContent("pnpm dev:ice");
    expect(screen.getByTestId("ice-fallback-copy")).toHaveTextContent("--enable-unsafe-webgpu");
    expect(screen.getByTestId("ice-fallback-copy")).toHaveTextContent("integrated browser");
    expect(screen.getByTestId("ice-scene-link")).toHaveAttribute(
      "href",
      expect.stringContaining("canvas=scene"),
    );
    expect(screen.getByTestId("ice-status")).toHaveTextContent("engine: no WebGPU");
    expect(screen.getByTestId("ice-phase")).toHaveTextContent("phase: unavailable");
    // The dynamic import is the whole point: an unsupported browser pays nothing.
    expect(ice.createCanvasEngine).not.toHaveBeenCalled();
    expect(ice.deskLayer).not.toHaveBeenCalled();
  });

  it("should explain a WebGPU browser that cannot reach an adapter", async () => {
    stubGpu({ requestAdapter: async () => null });

    render(<IceSurface />);

    expect(await screen.findByText("WebGPU has no graphics adapter")).toBeInTheDocument();
    expect(screen.getByTestId("ice-fallback-detail")).toHaveTextContent("no adapter");
    expect(screen.getByTestId("ice-fallback-copy")).toHaveTextContent("pnpm dev:ice");
    expect(screen.getByTestId("ice-adapter")).toHaveTextContent("adapter: not acquired");
    expect(ice.acquireCompositorDevice).not.toHaveBeenCalled();
    expect(ice.createCanvasEngine).not.toHaveBeenCalled();
  });

  it("should seed the rich desk on the paper palette and report the adapter", async () => {
    stubGpu({ requestAdapter: async () => ADAPTER });

    render(<IceSurface />);

    expect(await screen.findByTestId("ice-desk-mock")).toBeInTheDocument();
    expect(ice.acquireCompositorDevice).toHaveBeenCalledTimes(1);
    expect(ice.createCanvasEngine).toHaveBeenCalledTimes(1);
    expect(ice.createCanvasEngine).toHaveBeenCalledWith(
      expect.objectContaining({
        compositorDevice: expect.objectContaining({ adapter: ADAPTER }),
      }),
    );

    const spawned = ice.spawnWidget.mock.calls.map(([type]) => type);
    expect(spawned).toEqual([
      "desk.minimat",
      "desk.minimat",
      "desk.note",
      "desk.note",
      "desk.note",
      "desk.note",
      "desk.board",
      "desk.notebook",
      "desk.note",
      "desk.note",
    ]);
    // Both contained notes are frame-local children of the two mini mats.
    expect(ice.spawnWidget.mock.calls[8]?.[1]).toMatchObject({ parent: { entity: 1 } });
    expect(ice.spawnWidget.mock.calls[9]?.[1]).toMatchObject({ parent: { entity: 2 } });
    // Every seed is a batch write, never an undo step.
    expect(ice.spawnWidget.mock.calls.every(([, opts]) => opts !== undefined)).toBe(true);
    expect(
      ice.spawnWidget.mock.calls.every(
        ([, opts]) => (opts as { undoable?: boolean }).undoable === false,
      ),
    ).toBe(true);

    expect(ice.deskTheme).toHaveBeenCalledWith("light");
    expect(ice.deskPalette).toHaveBeenCalledWith("light");
    expect(ice.deskLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ice-demo-1",
        theme: {},
        // The engine palette plus the card's own sheet and ink.
        palette: expect.objectContaining({
          papers: expect.objectContaining({ card: expect.anything() }),
          pens: expect.objectContaining({ card: expect.anything() }),
        }),
        // Without a text raster ICE writes no note at all.
        text: expect.anything(),
      }),
    );
    // One projection for the root, one that compiles the mini mats' frames,
    // and one that settles the children.
    expect(ice.step).toHaveBeenCalledTimes(3);

    expect(await screen.findByText("engine: ready")).toBeInTheDocument();
    expect(screen.getByTestId("ice-phase")).toHaveTextContent("phase: ready");
    expect(screen.getByTestId("ice-seed")).toHaveTextContent("10/10 objects seeded");
    expect(screen.getByTestId("ice-adapter")).toHaveTextContent(
      "hardware · Acme / gen-1 / fake-gpu",
    );
    expect(screen.getByTestId("ice-hud")).toHaveTextContent("not document truth");
    expect(screen.getByTestId("ice-fps")).toHaveTextContent("fps:");
  });

  it("should project the live workspace read-only", async () => {
    stubGpu({ requestAdapter: async () => ADAPTER });
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const board = workspace.ensureBoard();
    workspace.createCard({ boardId: board.id, position: { x: 12, y: 34 } });

    render(<IceSurface workspace={workspace} rootBoardId={board.id} />);

    expect(await screen.findByTestId("ice-desk-mock")).toBeInTheDocument();
    expect(ice.spawnWidget).toHaveBeenCalledTimes(1);
    expect(ice.spawnWidget.mock.calls[0]?.[0]).toBe("suite.card");
    expect(screen.getByTestId("ice-demo-summary")).toHaveTextContent(
      "Workspace: 1 objects / 1 boards",
    );
    expect(screen.queryByTestId("ice-demo-modes")).not.toBeInTheDocument();
    expect(screen.getByTestId("ice-hud")).toHaveTextContent("Live workspace");
  });

  it("should wait for a live workspace instead of showing a demo", () => {
    stubGpu({ requestAdapter: async () => ADAPTER });

    render(<IceSurface workspace={null} rootBoardId={null} />);

    expect(screen.getByTestId("ice-phase")).toHaveTextContent("phase: checking");
    expect(ice.createCanvasEngine).not.toHaveBeenCalled();
    expect(ice.spawnWidget).not.toHaveBeenCalled();
  });

  it("should label a fallback adapter as software", async () => {
    stubGpu({
      requestAdapter: async () => ({
        info: { vendor: "Google", architecture: "swiftshader", isFallback: true },
      }),
    });

    render(<IceSurface />);

    expect(await screen.findByTestId("ice-adapter")).toHaveTextContent(
      "software · Google / swiftshader",
    );
  });

  it("should keep seeding after a refused kind and report the failure", async () => {
    stubGpu({ requestAdapter: async () => ADAPTER });
    let next = 0;
    ice.spawnWidget.mockImplementation((type: string) => {
      if (type === "desk.board") throw new Error("no board today");
      next += 1;
      return { entity: next };
    });

    render(<IceSurface />);

    expect(await screen.findByTestId("ice-seed-failures")).toHaveTextContent("desk.board");
    expect(screen.getByTestId("ice-seed-failures")).toHaveTextContent("no board today");
    expect(screen.getByTestId("ice-seed")).toHaveTextContent("9/10 objects seeded");
    expect(await screen.findByText("engine: ready")).toBeInTheDocument();
  });

  it("should keep a degraded desk mounted and say so in the HUD", async () => {
    ice.layerStatus.current = { state: "degraded", message: "a frame was lost" };
    stubGpu({ requestAdapter: async () => ADAPTER });

    render(<IceSurface />);

    expect(await screen.findByText("engine: degraded")).toBeInTheDocument();
    expect(screen.getByTestId("ice-desk-mock")).toBeInTheDocument();
    expect(screen.queryByTestId("ice-fallback")).not.toBeInTheDocument();
  });

  it("should replace a lost device with a calm fallback and still tear down", async () => {
    ice.layerStatus.current = { state: "failed", message: "device lost" };
    stubGpu({ requestAdapter: async () => ADAPTER });

    render(<IceSurface />);

    expect(await screen.findByText("The graphics device was lost")).toBeInTheDocument();
    expect(screen.getByTestId("ice-fallback-detail")).toHaveTextContent("device lost");
    expect(screen.getByTestId("ice-status")).toHaveTextContent("engine: device lost");
    expect(ice.dispose).toHaveBeenCalledTimes(1);
    expect(ice.destroyDevice).toHaveBeenCalledTimes(1);
  });

  it("should distinguish an engine failure from a lost device", async () => {
    stubGpu({ requestAdapter: async () => ADAPTER });
    ice.createCanvasEngine.mockImplementationOnce(() => {
      throw new Error("the engine refused to boot");
    });

    render(<IceSurface />);

    expect(await screen.findByText("ICE could not start")).toBeInTheDocument();
    expect(screen.getByTestId("ice-fallback-detail")).toHaveTextContent(
      "the engine refused to boot",
    );
    expect(screen.getByTestId("ice-status")).toHaveTextContent("engine: failed");
    expect(ice.dispose).not.toHaveBeenCalled();
    // The device was acquired before the engine refused it, so it is released.
    expect(ice.destroyDevice).toHaveBeenCalledTimes(1);
  });

  it("should tear down and reseed when Reset demo is pressed", async () => {
    stubGpu({ requestAdapter: async () => ADAPTER });

    const view = render(<IceSurface />);

    expect(await screen.findByTestId("ice-desk-mock")).toBeInTheDocument();
    expect(ice.createCanvasEngine).toHaveBeenCalledTimes(1);
    expect(ice.spawnWidget).toHaveBeenCalledTimes(10);

    fireEvent.click(screen.getByTestId("ice-reset"));

    await waitFor(() => expect(ice.createCanvasEngine).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(ice.spawnWidget).toHaveBeenCalledTimes(20));
    expect(ice.close).toHaveBeenCalledTimes(1);
    expect(ice.dispose).toHaveBeenCalledTimes(1);
    expect(ice.destroyDevice).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId("ice-desk-mock")).toBeInTheDocument();
    expect(screen.getByTestId("ice-seed")).toHaveTextContent("10/10 objects seeded");

    view.unmount();

    expect(ice.close).toHaveBeenCalledTimes(2);
    expect(ice.dispose).toHaveBeenCalledTimes(2);
    expect(ice.destroyDevice).toHaveBeenCalledTimes(2);
    expect(ice.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it("should copy adapter details and seed failures to the clipboard", async () => {
    stubGpu({ requestAdapter: async () => ADAPTER });
    let next = 0;
    ice.spawnWidget.mockImplementation((type: string) => {
      if (type === "desk.notebook") throw new Error("the notebook was refused");
      next += 1;
      return { entity: next };
    });
    const writeText = vi.fn((_text: string) => Promise.resolve());
    stubClipboard(writeText);

    render(<IceSurface />);

    await screen.findByTestId("ice-seed-failures");
    fireEvent.click(screen.getByTestId("ice-copy-diagnostics"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]?.[0] ?? "";
    expect(copied).toContain("vendor=Acme architecture=gen-1 device=fake-gpu");
    expect(copied).toContain("seeded: 9/10");
    expect(copied).toContain("desk.notebook");
    expect(copied).toContain("the notebook was refused");
    expect(await screen.findByTestId("ice-copy-status")).toHaveTextContent("Diagnostics copied");
  });

  it("should say so when the clipboard is unavailable", async () => {
    stubGpu({ requestAdapter: async () => ADAPTER });

    render(<IceSurface />);

    await screen.findByTestId("ice-desk-mock");
    fireEvent.click(screen.getByTestId("ice-copy-diagnostics"));

    expect(await screen.findByTestId("ice-copy-status")).toHaveTextContent(
      "Copy failed: clipboard is unavailable",
    );
  });

  it("should dispose the desk and unsubscribe on unmount", async () => {
    stubGpu({ requestAdapter: async () => ADAPTER });

    const view = render(<IceSurface />);

    expect(await screen.findByTestId("ice-desk-mock")).toBeInTheDocument();
    view.unmount();

    expect(ice.unsubscribe).toHaveBeenCalledTimes(1);
    expect(ice.close).toHaveBeenCalledTimes(1);
    expect(ice.dispose).toHaveBeenCalledTimes(1);
    expect(ice.destroyDevice).toHaveBeenCalledTimes(1);
  });

  it("should report a device that cannot be acquired without loading the desk", async () => {
    stubGpu({ requestAdapter: async () => ADAPTER });
    ice.acquireCompositorDevice.mockRejectedValueOnce(new Error("no device for you"));

    render(<IceSurface />);

    expect(await screen.findByText("WebGPU has no graphics adapter")).toBeInTheDocument();
    expect(screen.getByTestId("ice-fallback-detail")).toHaveTextContent(
      "Could not create a WebGPU device: no device for you",
    );
    expect(ice.createCanvasEngine).not.toHaveBeenCalled();
    expect(ice.destroyDevice).not.toHaveBeenCalled();
  });

  it("should read the demo choice from the query string", () => {
    expect(demoModeFromSearch("?demo=suite")).toBe("suite");
    expect(demoModeFromSearch("?canvas=ice&demo=suite")).toBe("suite");
    expect(demoModeFromSearch("?canvas=ice")).toBe("native");
    expect(demoModeFromSearch("?demo=native")).toBe("native");
  });

  it("should switch to the Suite demo, reseed and tear the native desk down", async () => {
    stubGpu({ requestAdapter: async () => ADAPTER });

    const view = render(<IceSurface />);

    expect(await screen.findByTestId("ice-desk-mock")).toBeInTheDocument();
    expect(screen.getByTestId("ice-demo-native")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("ice-demo-summary")).toHaveTextContent("Native demo: 10 objects");
    expect(ice.spawnWidget).toHaveBeenCalledTimes(10);

    fireEvent.click(screen.getByTestId("ice-demo-suite"));

    await waitFor(() => expect(ice.spawnWidget).toHaveBeenCalledTimes(30));
    expect(ice.createCanvasEngine).toHaveBeenCalledTimes(2);
    expect(ice.close).toHaveBeenCalledTimes(1);
    expect(ice.dispose).toHaveBeenCalledTimes(1);
    expect(ice.destroyDevice).toHaveBeenCalledTimes(1);

    expect(await screen.findByText("engine: ready")).toBeInTheDocument();
    expect(screen.getByTestId("ice-demo-suite")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("ice-demo-native")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("ice-demo-summary")).toHaveTextContent(
      "Suite demo: 20 objects / 3 boards",
    );
    expect(screen.getByTestId("ice-seed")).toHaveTextContent("20/20 objects seeded");
    expect(screen.getByTestId("ice-demo-skipped")).toHaveTextContent("skipped: 2 cycle, 5 section");

    const suiteTypes = ice.spawnWidget.mock.calls.slice(10).map(([type]) => type);
    expect(suiteTypes.filter((type) => type === "desk.note")).toHaveLength(17);
    expect(suiteTypes.filter((type) => type === "desk.minimat")).toHaveLength(3);
    expect(ice.step).toHaveBeenCalledTimes(3 + 4);

    // Switching back is another reset, with the native count again.
    fireEvent.click(screen.getByTestId("ice-demo-native"));
    await waitFor(() => expect(ice.spawnWidget).toHaveBeenCalledTimes(40));
    expect(screen.getByTestId("ice-demo-summary")).toHaveTextContent("Native demo: 10 objects");
    expect(screen.queryByTestId("ice-demo-skipped")).not.toBeInTheDocument();
    expect(ice.close).toHaveBeenCalledTimes(2);

    view.unmount();
    expect(ice.close).toHaveBeenCalledTimes(3);
    expect(ice.dispose).toHaveBeenCalledTimes(3);
    expect(ice.destroyDevice).toHaveBeenCalledTimes(3);
  });

  it("should open the graph projection from the canvas zoom cluster", async () => {
    stubGpu({ requestAdapter: async () => ADAPTER });
    stubReducedMotion();
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const board = workspace.ensureBoard();
    workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    ice.cameraWorld.enabled = true;

    render(<IceSurface workspace={workspace} rootBoardId={board.id} />);
    await settled();

    expect(screen.getByTestId("canvas-controls")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("canvas-graph-view"));

    // One widget per (container, type) pair, drawn *over* the canvas: the card
    // projection is untouched, which is what makes this an overlay.
    const spawned = ice.spawnWidget.mock.calls.map(([type]) => type);
    expect(spawned).toContain("suite.containerNode");
    expect(spawned).toContain("suite.typeNode");
    const cardsBefore = spawned.filter((type) => type === "suite.card").length;
    expect(cardsBefore).toBeGreaterThan(0);
    expect(screen.getByTestId("ice-graph-crumb")).toBeInTheDocument();
    expect(screen.getByTestId("ice-band-types")).toBeInTheDocument();
    expect(screen.getByTestId("canvas-graph-view")).toHaveAttribute("data-graph-active", "true");
    // A flight, not a jump: the camera is written through the engine resource.
    expect(ice.writeRuntimeResource).toHaveBeenCalled();
  });

  it("should return to the camera the graph was entered from", async () => {
    stubGpu({ requestAdapter: async () => ADAPTER });
    stubReducedMotion();
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const board = workspace.ensureBoard();
    workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    ice.cameraWorld.enabled = true;
    ice.cameraWorld.camera = { x: 300, y: 120, zoom: 1.4, gesturing: false };

    render(<IceSurface workspace={workspace} rootBoardId={board.id} />);
    await settled();

    fireEvent.click(screen.getByTestId("canvas-graph-view"));
    expect(await screen.findByTestId("ice-graph-crumb")).toBeInTheDocument();
    // The camera the graph view landed on is not the one we came from.
    expect(ice.cameraWorld.camera.zoom).not.toBeCloseTo(1.4);

    // Wandering inside the graph must not change where the return goes.
    ice.cameraWorld.camera = { x: -900, y: 400, zoom: 0.09, gesturing: false };
    await waitFor(() =>
      expect(screen.getByTestId("canvas-graph-view")).toHaveAttribute("data-graph-active", "true"),
    );

    fireEvent.click(screen.getByTestId("canvas-graph-view"));

    await waitFor(() => expect(screen.queryByTestId("ice-graph-crumb")).not.toBeInTheDocument());
    expect(ice.cameraWorld.camera.x).toBeCloseTo(300);
    expect(ice.cameraWorld.camera.y).toBeCloseTo(120);
    expect(ice.cameraWorld.camera.zoom).toBeCloseTo(1.4);
  });

  it("should still take a graph request from the shell store action", async () => {
    stubGpu({ requestAdapter: async () => ADAPTER });
    stubReducedMotion();
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const board = workspace.ensureBoard();
    workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    ice.cameraWorld.enabled = true;

    render(<IceSurface workspace={workspace} rootBoardId={board.id} />);
    await settled();

    act(() => {
      useUiStore.getState().requestGraphView();
    });

    expect(await screen.findByTestId("ice-graph-crumb")).toBeInTheDocument();
  });

  it("should return from the graph on Escape and on the breadcrumb", async () => {
    stubGpu({ requestAdapter: async () => ADAPTER });
    stubReducedMotion();
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const board = workspace.ensureBoard();
    workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    ice.cameraWorld.enabled = true;

    render(<IceSurface workspace={workspace} rootBoardId={board.id} />);
    await settled();

    const entry = ice.keymap.current?.find((binding) => binding.key === "g");
    expect(entry).toBeDefined();
    act(() => entry?.run(undefined));
    expect(await screen.findByTestId("ice-graph-crumb")).toBeInTheDocument();

    const escapeEntry = ice.keymap.current?.find((binding) => binding.key === "Escape");
    act(() => escapeEntry?.run(undefined));

    // The projection closes: the crumb goes away, and the graph widgets are
    // removed through the engine's delete path. The cards were never disturbed,
    // which is the point of an overlay.
    await waitFor(() => expect(screen.queryByTestId("ice-graph-crumb")).not.toBeInTheDocument());
    expect(ice.deleteSelection).toHaveBeenCalled();
    expect(screen.queryByTestId("ice-band-types")).toBeNull();
  });

  it("should open the Suite demo directly when ?demo=suite is in the URL", async () => {
    window.history.replaceState({}, "", "/ice.html?demo=suite");
    stubGpu({ requestAdapter: async () => ADAPTER });

    render(<IceSurface />);

    expect(await screen.findByTestId("ice-desk-mock")).toBeInTheDocument();
    expect(screen.getByTestId("ice-demo-suite")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("ice-demo-native")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("ice-demo-summary")).toHaveTextContent(
      "Suite demo: 20 objects / 3 boards",
    );
    expect(ice.spawnWidget).toHaveBeenCalledTimes(20);
    expect(ice.spawnWidget.mock.calls.some(([type]) => type === "desk.board")).toBe(false);
    expect(screen.getByTestId("ice-hud")).toHaveTextContent("not document truth");
  });
});
