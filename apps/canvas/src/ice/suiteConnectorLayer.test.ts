import { afterEach, describe, expect, it } from "vitest";
import type { ConnectorAnchor } from "./iceLinkDrag";
import { createSuiteConnectorLayer, type SuiteConnectorLayerHandle } from "./suiteConnectorLayer";

const ANCHORS: readonly ConnectorAnchor[] = [
  { connectorId: "north", point: { x: 200, y: 50 } },
  { connectorId: "east", point: { x: 300, y: 100 } },
];

interface DragView {
  readonly from: { x: number; y: number };
  readonly pointer: { x: number; y: number };
  readonly target: { x: number; y: number } | null;
}

interface Stage {
  readonly container: HTMLElement;
  readonly handle: SuiteConnectorLayerHandle;
  setAnchors(anchors: readonly ConnectorAnchor[]): void;
  setDrag(drag: DragView | null): void;
}

const stages: Stage[] = [];

function stage(options: {
  anchors?: readonly ConnectorAnchor[];
  drag?: DragView | null;
  zoom?: number;
}): Stage {
  const container = document.createElement("div");
  document.body.append(container);
  const state = {
    anchors: options.anchors ?? ANCHORS,
    drag: options.drag ?? null,
    zoom: options.zoom ?? 1,
  };
  const handle = createSuiteConnectorLayer({
    container,
    camera: () => ({ x: 0, y: 0, zoom: state.zoom }),
    anchors: () => state.anchors,
    drag: () => state.drag,
  });
  container.append(handle.layer);
  const result: Stage = {
    container,
    handle,
    setAnchors(anchors) {
      state.anchors = anchors;
      handle.sync();
    },
    setDrag(drag) {
      state.drag = drag;
      handle.sync();
    },
  };
  stages.push(result);
  return result;
}

afterEach(() => {
  for (const entry of stages.splice(0)) {
    entry.handle.dispose();
    entry.container.remove();
  }
});

describe("createSuiteConnectorLayer", () => {
  it("draws one dot per connector, in screen pixels", () => {
    const { container, handle } = stage({ zoom: 2 });
    const dots = container.querySelectorAll<HTMLElement>('[data-testid="suite-connector-dot"]');
    expect(dots).toHaveLength(2);
    // World (200, 50) at zoom 2 with the camera at the origin is (400, 100).
    expect(dots[0]?.style.left).toBe("400px");
    expect(dots[0]?.style.top).toBe("100px");
    expect(handle.visibleCount()).toBe(2);
  });

  it("draws no drag line while nothing is being dragged", () => {
    const { container } = stage({});
    const line = container.querySelector<SVGLineElement>('[data-testid="suite-connector-drag"]');
    expect(line?.style.display).toBe("none");
    expect(
      container.querySelector<SVGCircleElement>('[data-testid="suite-connector-target"]')?.style
        .display,
    ).toBe("none");
  });

  it("draws the line to the pointer, and to the snap when there is one", () => {
    const free = stage({
      drag: { from: { x: 300, y: 100 }, pointer: { x: 520, y: 200 }, target: null },
    });
    const line = free.container.querySelector<SVGLineElement>(
      '[data-testid="suite-connector-drag"]',
    );
    expect(line?.style.display).toBe("block");
    expect(line?.getAttribute("x1")).toBe("300");
    expect(line?.getAttribute("x2")).toBe("520");

    const snapped = stage({
      drag: { from: { x: 300, y: 100 }, pointer: { x: 520, y: 200 }, target: { x: 500, y: 180 } },
    });
    const snappedLine = snapped.container.querySelector<SVGLineElement>(
      '[data-testid="suite-connector-drag"]',
    );
    const halo = snapped.container.querySelector<SVGCircleElement>(
      '[data-testid="suite-connector-target"]',
    );
    expect(snappedLine?.getAttribute("x2")).toBe("500");
    expect(halo?.style.display).toBe("block");
    expect(halo?.getAttribute("cx")).toBe("500");
  });

  it("removes a dot whose card is no longer hovered, and clears the drag on release", () => {
    const { container, setAnchors, setDrag } = stage({
      drag: { from: { x: 300, y: 100 }, pointer: { x: 520, y: 200 }, target: null },
    });
    setAnchors([]);
    expect(container.querySelectorAll('[data-testid="suite-connector-dot"]')).toHaveLength(0);

    setDrag(null);
    expect(
      container.querySelector<SVGLineElement>('[data-testid="suite-connector-drag"]')?.style
        .display,
    ).toBe("none");
  });
});
