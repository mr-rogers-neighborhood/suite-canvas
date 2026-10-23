import { EMPTY_VIEW_ZOOM, type TypeGraphNode } from "@suite/scene";
import { describe, expect, it } from "vitest";
import type { FlightCamera } from "./iceCameraFlight";
import {
  cameraForBounds,
  ceilingZoomFor,
  dampedZoom,
  fitZoom,
  frameCameraFor,
  GRAPH_PAST_LID,
  GRAPH_RETURN_ZOOM,
  graphCameraFor,
  graphNodeSignature,
  graphReconcile,
  graphZoomFor,
  placementRect,
  returnCameraFor,
  returnZoom,
  typeUnionBounds,
  unionRect,
} from "./iceGraphBand";

const VIEWPORT = { width: 1200, height: 800 };
const CARD = { width: 300, height: 200 };

function node(overrides: Partial<TypeGraphNode> = {}): TypeGraphNode {
  return {
    key: "type:container:s1:type-a",
    kind: "type",
    label: "Article",
    glyph: "A",
    count: 3,
    containerId: "s1",
    typeId: "type-a",
    x: 0,
    y: 0,
    width: 96,
    height: 64,
    depth: 1,
    ...overrides,
  };
}

describe("unionRect", () => {
  it("spans every rect and refuses nothing at all", () => {
    expect(
      unionRect([
        { x: 0, y: 0, width: 100, height: 50 },
        { x: -20, y: 40, width: 10, height: 10 },
      ]),
    ).toEqual({ x: -20, y: 0, width: 120, height: 50 });
    expect(unionRect([])).toBeNull();
  });

  it("ignores non-finite rects instead of poisoning the union", () => {
    expect(
      unionRect([
        { x: Number.NaN, y: 0, width: 10, height: 10 },
        { x: 5, y: 5, width: 10, height: 10 },
      ]),
    ).toEqual({ x: 5, y: 5, width: 10, height: 10 });
  });
});

describe("placementRect", () => {
  it("falls back to the natural card size when the placement stores none", () => {
    expect(placementRect({ x: 4, y: 6 }, CARD)).toEqual({ x: 4, y: 6, width: 300, height: 200 });
    expect(placementRect({ x: 4, y: 6, width: 10, height: 20 }, CARD)).toEqual({
      x: 4,
      y: 6,
      width: 10,
      height: 20,
    });
  });
});

describe("typeUnionBounds", () => {
  it("frames only the placements of the requested cards", () => {
    const placements = [
      { cardId: "a", x: 0, y: 0, width: 100, height: 100 },
      { cardId: "b", x: 200, y: 100, width: 100, height: 100 },
      { cardId: "c", x: 900, y: 900, width: 100, height: 100 },
    ];
    expect(typeUnionBounds(placements, new Set(["a", "b"]))).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 200,
    });
    expect(typeUnionBounds(placements, new Set())).toBeNull();
  });
});

describe("fitZoom", () => {
  it("fits the smaller axis inside the padded viewport and clamps both ways", () => {
    const bounds = { x: 0, y: 0, width: 600, height: 200 };
    // 1200 * 0.88 / 600 = 1.76; 800 * 0.88 / 200 = 3.52 → the width wins.
    expect(fitZoom(bounds, VIEWPORT)).toBeCloseTo(1.76);
    expect(fitZoom({ x: 0, y: 0, width: 1_000_000, height: 1 }, VIEWPORT)).toBe(0.02);
    expect(fitZoom({ x: 0, y: 0, width: 1, height: 1 }, VIEWPORT)).toBe(4);
  });

  it("falls back to the band's exit threshold without bounds or a viewport", () => {
    expect(fitZoom(null, VIEWPORT)).toBe(EMPTY_VIEW_ZOOM);
    expect(fitZoom({ x: 0, y: 0, width: 10, height: 10 }, null)).toBe(EMPTY_VIEW_ZOOM);
  });
});

describe("cameraForBounds", () => {
  it("puts the bounds' centre at the viewport's centre", () => {
    const camera = cameraForBounds({ x: 100, y: 50, width: 200, height: 100 }, VIEWPORT, 2);
    // world = (screen - x) / zoom → the centre lands at 600, 400.
    expect((VIEWPORT.width / 2 - camera.x) / camera.zoom).toBeCloseTo(200);
    expect((VIEWPORT.height / 2 - camera.y) / camera.zoom).toBeCloseTo(100);
  });

  it("still answers without bounds, so a flight has a place to go", () => {
    expect(cameraForBounds(null, VIEWPORT, 0.5)).toEqual({ x: 0, y: 0, zoom: 0.5 });
  });
});

describe("ceilingZoomFor", () => {
  it("is the fit of the content, and the band's entry without content", () => {
    expect(ceilingZoomFor({ x: 0, y: 0, width: 600, height: 200 }, VIEWPORT)).toBeCloseTo(1.76);
    expect(ceilingZoomFor(null, VIEWPORT)).toBe(EMPTY_VIEW_ZOOM);
  });
});

describe("graphZoomFor", () => {
  it("never lands inside the lid, even when the graph would fit closer", () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    expect(graphZoomFor(bounds, VIEWPORT, 0.4)).toBeCloseTo(0.4 * GRAPH_PAST_LID);
  });

  it("uses the graph fit when the aggregated bounds need more room than the lid", () => {
    const content = { x: 0, y: 0, width: 2000, height: 1000 };
    const graph = { x: -200, y: -100, width: 4000, height: 2000 };
    const ceiling = fitZoom(content, VIEWPORT);
    const fit = fitZoom(graph, VIEWPORT);
    expect(fit).toBeLessThan(ceiling * GRAPH_PAST_LID);
    expect(graphZoomFor(graph, VIEWPORT, ceiling)).toBeCloseTo(fit);
    expect(graphCameraFor(graph, VIEWPORT, ceiling).zoom).toBeLessThan(ceiling);
  });
});

describe("returnZoom", () => {
  it("returns to the ceiling when the ceiling is already out of the band", () => {
    expect(returnZoom(1.5)).toBe(1.5);
  });

  it("returns just above the band when the whole View fits inside it", () => {
    expect(returnZoom(0.05)).toBeCloseTo(GRAPH_RETURN_ZOOM);
    expect(GRAPH_RETURN_ZOOM).toBeGreaterThan(EMPTY_VIEW_ZOOM);
  });

  it("centres the return on the same content", () => {
    const bounds = { x: 0, y: 0, width: 400, height: 400 };
    const camera = returnCameraFor(bounds, VIEWPORT, 0.05);
    expect(camera.zoom).toBeCloseTo(GRAPH_RETURN_ZOOM);
    expect((VIEWPORT.width / 2 - camera.x) / camera.zoom).toBeCloseTo(200);
  });
});

describe("frameCameraFor", () => {
  it("frames a type but never closer than a reading zoom", () => {
    const tiny = frameCameraFor({ x: 0, y: 0, width: 10, height: 10 }, VIEWPORT);
    expect(tiny.zoom).toBe(2);
    const wide = frameCameraFor({ x: 0, y: 0, width: 100_000, height: 100_000 }, VIEWPORT);
    expect(wide.zoom).toBeCloseTo(GRAPH_RETURN_ZOOM);
  });
});

describe("dampedZoom", () => {
  const from: FlightCamera = { x: 0, y: 0, zoom: 1 };
  const to: FlightCamera = { x: 60, y: 40, zoom: 1 / 1.2 };
  const anchor = { x: 600, y: 400 };

  it("keeps the world point under the pointer while taking a share of the step", () => {
    const damped = dampedZoom(from, to, 0.25, anchor);
    const before = { x: (anchor.x - from.x) / from.zoom, y: (anchor.y - from.y) / from.zoom };
    const after = {
      x: (anchor.x - damped.x) / damped.zoom,
      y: (anchor.y - damped.y) / damped.zoom,
    };
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    // A quarter of a 1 → 1/1.2 step.
    expect(damped.zoom).toBeCloseTo((1 / 1.2) ** 0.25);
    expect(damped.zoom).toBeLessThan(1);
    expect(damped.zoom).toBeGreaterThan(to.zoom);
  });

  it("is the identity at full share and the engine's result at none", () => {
    expect(dampedZoom(from, to, 1, anchor)).toBe(to);
    const none = dampedZoom(from, to, 0, anchor);
    expect(none.zoom).toBeCloseTo(1);
    expect(none.x).toBeCloseTo(from.x);
  });

  it("does not divide by an unusable camera", () => {
    expect(dampedZoom({ x: 0, y: 0, zoom: 0 }, to, 0.5, anchor)).toBe(to);
  });
});

describe("graphReconcile", () => {
  it("spawns everything on the first pass and nothing on an identical one", () => {
    const nodes = [node(), node({ key: "container:s1", kind: "container", count: 3 })];
    const first = graphReconcile(nodes, new Map());
    expect(first.spawn).toHaveLength(2);
    expect(first.remove).toEqual([]);
    const present = new Map(nodes.map((n) => [n.key, graphNodeSignature(n)]));
    const second = graphReconcile(nodes, present);
    expect(second.spawn).toEqual([]);
    expect(second.remove).toEqual([]);
  });

  it("replaces a node whose geometry moved and drops the ones that left", () => {
    const before = [node(), node({ key: "type:container:s1:type-b", count: 1 })];
    const present = new Map(before.map((n) => [n.key, graphNodeSignature(n)]));
    const after = [node({ x: 40, count: 5 })];
    const plan = graphReconcile(after, present);
    expect(plan.remove).toEqual([node().key, "type:container:s1:type-b"]);
    expect(plan.spawn.map((n) => n.key)).toEqual([node().key]);
  });

  it("only notices a count change through the signature", () => {
    const before = new Map([[node().key, graphNodeSignature(node())]]);
    expect(graphReconcile([node({ count: 4 })], before).spawn).toHaveLength(1);
  });
});
