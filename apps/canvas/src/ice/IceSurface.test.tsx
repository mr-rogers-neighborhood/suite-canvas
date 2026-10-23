import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IceSurface } from "./IceSurface";

/**
 * The ICE modules are mocked so the wiring (detection, seeding, teardown) is
 * covered in jsdom, where WebGPU does not exist. The real modules are never
 * imported by these tests.
 */
const ice = vi.hoisted(() => {
  const layerStatus: { current: { state: "ready" | "degraded" | "failed"; message?: string } } = {
    current: { state: "ready" },
  };
  const unsubscribe = vi.fn();
  const layer = {
    status: () => layerStatus.current,
    onStatus: vi.fn(() => unsubscribe),
  };
  const deskLayer = vi.fn(() => () => layer);
  const close = vi.fn();
  const dispose = vi.fn();
  const spawnWidget = vi.fn((_type: string, _opts: unknown) => ({ entity: 1 }));
  const step = vi.fn();
  const createCanvasEngine = vi.fn(() => ({
    docs: { create: () => ({ close }) },
    ops: { spawnWidget },
    step,
    dispose,
  }));
  return {
    close,
    createCanvasEngine,
    deskLayer,
    dispose,
    layer,
    layerStatus,
    spawnWidget,
    step,
    unsubscribe,
  };
});

vi.mock("@vibecook/ice", () => ({ createCanvasEngine: ice.createCanvasEngine }));
vi.mock("@vibecook/ice/desk", () => ({ deskLayer: ice.deskLayer }));
vi.mock("@vibecook/ice/desk/objects", () => ({
  DESK_ENGINE: { widgets: [] },
  DESK_OBJECTS: [],
  deskPalette: () => ({}),
  deskTheme: () => ({}),
}));
vi.mock("@vibecook/ice/react", async () => {
  const { createElement, useEffect } = await import("react");
  return {
    Desk: (props: { onReady?: (handle: unknown) => undefined | (() => void) }) => {
      useEffect(() => props.onReady?.({ layer: ice.layer }), [props.onReady]);
      return createElement("div", { "data-testid": "ice-desk-mock" });
    },
    EngineProvider: (props: { children?: unknown }) => props.children,
  };
});

function stubGpu(value: unknown): void {
  Object.defineProperty(navigator, "gpu", { configurable: true, value });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, "gpu");
  ice.layerStatus.current = { state: "ready" };
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
    expect(screen.getByTestId("ice-scene-link")).toHaveAttribute(
      "href",
      expect.stringContaining("canvas=scene"),
    );
    // The dynamic import is the whole point: an unsupported browser pays nothing.
    expect(ice.createCanvasEngine).not.toHaveBeenCalled();
    expect(ice.deskLayer).not.toHaveBeenCalled();
  });

  it("should explain a WebGPU browser that cannot reach an adapter", async () => {
    stubGpu({ requestAdapter: async () => null });

    render(<IceSurface />);

    expect(await screen.findByText("WebGPU has no graphics adapter")).toBeInTheDocument();
    expect(screen.getByTestId("ice-fallback-detail")).toHaveTextContent("no adapter");
    expect(ice.createCanvasEngine).not.toHaveBeenCalled();
  });

  it("should seed a note and a mini mat, then dispose the desk on unmount", async () => {
    stubGpu({ requestAdapter: async () => ({}) });

    const view = render(<IceSurface />);

    expect(await screen.findByTestId("ice-desk-mock")).toBeInTheDocument();
    expect(ice.createCanvasEngine).toHaveBeenCalledTimes(1);

    const spawned = ice.spawnWidget.mock.calls.map(([type]) => type);
    expect(spawned).toEqual(["desk.note", "desk.minimat", "desk.note"]);
    expect(ice.spawnWidget.mock.calls[2]?.[1]).toMatchObject({ parent: { entity: 1 } });
    expect(ice.deskLayer).toHaveBeenCalledWith(expect.objectContaining({ name: "ice-spike" }));
    // One projection for the document root, one that compiles the mini mat's
    // container frame before a child is placed inside it.
    expect(ice.step).toHaveBeenCalledTimes(2);

    expect(await screen.findByText("engine: ready")).toBeInTheDocument();
    expect(screen.getByTestId("ice-seed")).toHaveTextContent("3/3 objects seeded");
    expect(screen.getByTestId("ice-hud")).toHaveTextContent("not document truth");

    view.unmount();

    expect(ice.unsubscribe).toHaveBeenCalledTimes(1);
    expect(ice.close).toHaveBeenCalledTimes(1);
    expect(ice.dispose).toHaveBeenCalledTimes(1);
  });

  it("should keep a degraded desk mounted and say so in the HUD", async () => {
    ice.layerStatus.current = { state: "degraded", message: "a frame was lost" };
    stubGpu({ requestAdapter: async () => ({}) });

    render(<IceSurface />);

    expect(await screen.findByText("engine: degraded")).toBeInTheDocument();
    expect(screen.getByTestId("ice-desk-mock")).toBeInTheDocument();
    expect(screen.queryByTestId("ice-fallback")).not.toBeInTheDocument();
  });

  it("should replace a failed desk with a calm fallback and still tear down", async () => {
    ice.layerStatus.current = { state: "failed", message: "device lost" };
    stubGpu({ requestAdapter: async () => ({}) });

    render(<IceSurface />);

    expect(await screen.findByText("ICE could not start")).toBeInTheDocument();
    expect(screen.getByTestId("ice-fallback-detail")).toHaveTextContent("device lost");
    expect(ice.dispose).toHaveBeenCalledTimes(1);
  });
});
