import { describe, expect, it } from "vitest";
import type { EdgePath, Point, Rect } from "./iceEdgeGeometry";
import {
  anchorWorld,
  commonAncestorFrame,
  DEFAULT_CARD_HEIGHT,
  DEFAULT_CARD_WIDTH,
  DEFAULT_EDGE_SAMPLES,
  depthDelta,
  edgeRender,
  routeEdge,
  seamsOf,
} from "./iceEdgeGeometry";

const TWO_DEEP_FRAMES: readonly Rect[] = [
  { x: 100, y: 50, width: 400, height: 300 },
  { x: 20, y: 10, width: 200, height: 150 },
];

const PATHS: readonly EdgePath[] = ["bezier", "straight", "step", "smoothstep"];

function finite(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

describe("anchorWorld", () => {
  it("should accumulate both ancestor frames before the placement", () => {
    expect(
      anchorWorld({
        frames: TWO_DEEP_FRAMES,
        placement: { x: 10, y: 20, width: 100, height: 80 },
      }),
    ).toEqual({ x: 180, y: 120 });
  });

  it.each([
    [0, 0, 0, 0],
    [0.5, 0.5, 100, 50],
    [1, 1, 200, 100],
  ])("should map connector fraction (%s, %s) to (%s, %s)", (fx, fy, expectedX, expectedY) => {
    expect(
      anchorWorld({
        frames: [],
        placement: { x: 0, y: 0, width: 200, height: 100 },
        connectors: [{ id: "right", x: fx, y: fy }],
        connectorId: "right",
      }),
    ).toEqual({ x: expectedX, y: expectedY });
  });

  it("should place connectors inside the accumulated frames", () => {
    expect(
      anchorWorld({
        frames: TWO_DEEP_FRAMES,
        placement: { x: 10, y: 20, width: 100, height: 80 },
        connectors: [{ id: "corner", x: 1, y: 1 }],
        connectorId: "corner",
      }),
    ).toEqual({ x: 230, y: 160 });
  });

  it("should fall back to the centre when the connector id is missing or unknown", () => {
    const placement = { x: 0, y: 0, width: 100, height: 60 };
    expect(anchorWorld({ frames: [], placement })).toEqual({ x: 50, y: 30 });
    expect(
      anchorWorld({
        frames: [],
        placement,
        connectors: [{ id: "a", x: 0, y: 0 }],
        connectorId: "elsewhere",
      }),
    ).toEqual({ x: 50, y: 30 });
  });

  it("should use the documented default card size when the placement has no dimensions", () => {
    expect(anchorWorld({ frames: [], placement: { x: 0, y: 0 } })).toEqual({
      x: DEFAULT_CARD_WIDTH / 2,
      y: DEFAULT_CARD_HEIGHT / 2,
    });
  });
});

describe("commonAncestorFrame", () => {
  it("should return the last index when both cards sit on the same board", () => {
    expect(commonAncestorFrame(["root", "board"], ["root", "board"])).toBe(1);
  });

  it("should return the shared parent for siblings in different boards", () => {
    expect(commonAncestorFrame(["root", "left"], ["root", "right"])).toBe(0);
    expect(commonAncestorFrame(["root", "left", "a"], ["root", "left", "b"])).toBe(1);
  });

  it("should return the ancestor index for an ancestor/descendant pair", () => {
    expect(commonAncestorFrame(["root"], ["root", "board", "inner"])).toBe(0);
    expect(commonAncestorFrame(["root", "board"], ["root", "board", "inner"])).toBe(1);
  });

  it("should return 0 for two different roots and for empty paths", () => {
    expect(commonAncestorFrame(["alpha", "a"], ["beta", "b"])).toBe(0);
    expect(commonAncestorFrame([], [])).toBe(0);
  });
});

describe("routeEdge", () => {
  it("should return exactly the two endpoints for straight paths", () => {
    const points = routeEdge({
      from: { x: 10, y: 20 },
      to: { x: 90, y: 40 },
      path: "straight",
      samples: 50,
    });
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ x: 10, y: 20 });
    expect(points[1]).toEqual({ x: 90, y: 40 });
  });

  it("should sample bezier with the default count and hit the midpoint of a 3-sample curve", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 100, y: 50 };
    const defaults = routeEdge({ from, to, path: "bezier" });
    expect(defaults).toHaveLength(DEFAULT_EDGE_SAMPLES);
    expect(defaults[0]).toEqual(from);
    expect(defaults[defaults.length - 1]).toEqual(to);

    const three = routeEdge({ from, to, path: "bezier", samples: 3 });
    expect(three).toHaveLength(3);
    expect(three[1]?.x).toBeCloseTo(50, 10);
    expect(three[1]?.y).toBeCloseTo(25, 10);
  });

  it("should clamp requested sample counts into a usable range", () => {
    const from = { x: 0, y: 0 };
    const to = { x: 10, y: 10 };
    expect(routeEdge({ from, to, path: "bezier", samples: 1 })).toHaveLength(2);
    expect(routeEdge({ from, to, path: "bezier", samples: Number.NaN })).toHaveLength(
      DEFAULT_EDGE_SAMPLES,
    );
  });

  it("should build the H-V-H staircase with a kink at the midpoint", () => {
    expect(routeEdge({ from: { x: 0, y: 0 }, to: { x: 100, y: 60 }, path: "step" })).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 60 },
      { x: 100, y: 60 },
    ]);
  });

  it("should collapse step to two points when the ends already share a row", () => {
    expect(routeEdge({ from: { x: 0, y: 5 }, to: { x: 100, y: 5 }, path: "step" })).toHaveLength(2);
    expect(routeEdge({ from: { x: 5, y: 0 }, to: { x: 5, y: 100 }, path: "step" })).toHaveLength(2);
  });

  it("should round the smoothstep corners while keeping the requested count", () => {
    const points = routeEdge({ from: { x: 0, y: 0 }, to: { x: 100, y: 60 }, path: "smoothstep" });
    expect(points).toHaveLength(DEFAULT_EDGE_SAMPLES);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 100, y: 60 });
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(-1e-9);
      expect(point.x).toBeLessThanOrEqual(100 + 1e-9);
      expect(point.y).toBeGreaterThanOrEqual(-1e-9);
      expect(point.y).toBeLessThanOrEqual(60 + 1e-9);
    }
    expect(points.some((point) => point.x === 50 && point.y === 0)).toBe(false);
    expect(points.some((point) => point.x === 50 && point.y === 60)).toBe(false);
  });

  it("should return two identical points for a zero-length edge on every path", () => {
    for (const path of PATHS) {
      const points = routeEdge({ from: { x: 7, y: 9 }, to: { x: 7, y: 9 }, path });
      expect(points).toHaveLength(2);
      expect(points[0]).toEqual({ x: 7, y: 9 });
      expect(points[1]).toEqual({ x: 7, y: 9 });
      expect(points.every(finite)).toBe(true);
    }
  });

  it("should never produce non-finite coordinates, including extreme spans", () => {
    const cases = [
      { from: { x: -1e9, y: -1e9 }, to: { x: 1e9, y: 1e9 } },
      { from: { x: 1e9, y: 1e9 }, to: { x: -1e9, y: -1e9 } },
      { from: { x: 0, y: 0 }, to: { x: 0, y: 100 } },
      { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } },
    ];
    for (const path of PATHS) {
      for (const { from, to } of cases) {
        const points = routeEdge({ from, to, path });
        expect(points.length).toBeGreaterThanOrEqual(2);
        expect(points.every(finite)).toBe(true);
      }
    }
  });
});

describe("seamsOf", () => {
  const OUTER = { rect: { x: 0, y: 0, width: 400, height: 400 }, depth: 0 };
  const INNER = { rect: { x: 100, y: 100, width: 200, height: 200 }, depth: 1 };

  it("should report a nested crossing once per frame, ordered along the path", () => {
    const polyline = routeEdge({
      from: { x: 150, y: 150 },
      to: { x: 500, y: 150 },
      path: "straight",
    });
    const seams = seamsOf(polyline, [INNER, OUTER]);

    expect(seams).toHaveLength(2);
    expect(seams[0]?.depth).toBe(1);
    expect(seams[0]?.index).toBe(0);
    expect(seams[0]?.t).toBeCloseTo(150 / 350, 10);
    expect(seams[0]?.point).toEqual({ x: 300, y: 150 });
    expect(seams[0]?.normal).toEqual({ x: 1, y: 0 });
    expect(seams[1]?.depth).toBe(0);
    expect(seams[1]?.t).toBeCloseTo(250 / 350, 10);
    expect(seams[1]?.point).toEqual({ x: 400, y: 150 });
    expect(seams[1]?.normal).toEqual({ x: 1, y: 0 });
  });

  it("should keep the outward normal when the path runs the other way", () => {
    const polyline = routeEdge({
      from: { x: 500, y: 150 },
      to: { x: 150, y: 150 },
      path: "straight",
    });
    const seams = seamsOf(polyline, [INNER, OUTER]);

    expect(seams.map((seam) => seam.point)).toEqual([
      { x: 400, y: 150 },
      { x: 300, y: 150 },
    ]);
    expect(seams.map((seam) => seam.normal)).toEqual([
      { x: 1, y: 0 },
      { x: 1, y: 0 },
    ]);
  });

  it("should return no seams when the path stays inside the frame", () => {
    const polyline = routeEdge({
      from: { x: 150, y: 150 },
      to: { x: 250, y: 250 },
      path: "straight",
    });
    expect(seamsOf(polyline, [OUTER, INNER])).toEqual([]);
    expect(seamsOf(polyline, [])).toEqual([]);
  });

  it("should report the segment index and parameter inside that segment", () => {
    const polyline = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
    ];
    const frame = { rect: { x: 20, y: -10, width: 200, height: 200 }, depth: 2 };
    const seams = seamsOf(polyline, [frame]);

    expect(seams).toHaveLength(1);
    expect(seams[0]).toMatchObject({ index: 0, depth: 2, point: { x: 20, y: 0 } });
    expect(seams[0]?.t).toBeCloseTo(0.2, 10);
    expect(seams[0]?.normal).toEqual({ x: -1, y: 0 });
  });

  it("should orient horizontal borders outwards", () => {
    const frame = { rect: { x: 0, y: 0, width: 100, height: 100 }, depth: 1 };
    const leavingBottom = seamsOf(
      [
        { x: 50, y: 50 },
        { x: 50, y: 150 },
      ],
      [frame],
    );
    expect(leavingBottom).toHaveLength(1);
    expect(leavingBottom[0]?.normal).toEqual({ x: 0, y: 1 });
    expect(leavingBottom[0]?.point).toEqual({ x: 50, y: 100 });

    const leavingTop = seamsOf(
      [
        { x: 50, y: 50 },
        { x: 50, y: -50 },
      ],
      [frame],
    );
    expect(leavingTop).toHaveLength(1);
    expect(leavingTop[0]?.normal).toEqual({ x: 0, y: -1 });
  });
});

describe("depthDelta", () => {
  it.each([
    [0, 3, 3],
    [2, 0, -2],
    [1, 1, 0],
    [3, 5, 2],
  ])("should report the target depth minus the source depth (%s, %s)", (source, target, value) => {
    expect(depthDelta(source, target)).toBe(value);
  });

  it("should treat non-finite depths as the root", () => {
    expect(depthDelta(Number.NaN, 2)).toBe(2);
    expect(depthDelta(2, Number.POSITIVE_INFINITY)).toBe(-2);
  });
});

describe("edgeRender", () => {
  it.each([0.06, 0.5, 1, 4, 40])(
    "should thin and fade monotonically with depth at zoom %s",
    (zoom) => {
      let previous = edgeRender(0, zoom);
      for (let delta = 1; delta <= 8; delta += 1) {
        const current = edgeRender(delta, zoom);
        expect(current.thickness).toBeLessThanOrEqual(previous.thickness);
        expect(current.opacity).toBeLessThanOrEqual(previous.opacity);
        previous = current;
      }
    },
  );

  it("should stay finite and positive at the zoom extremes", () => {
    for (const zoom of [0.06, 40]) {
      for (let delta = 0; delta <= 10; delta += 1) {
        const render = edgeRender(delta, zoom);
        expect(Number.isFinite(render.thickness)).toBe(true);
        expect(Number.isFinite(render.opacity)).toBe(true);
        expect(render.thickness).toBeGreaterThan(0);
        expect(render.opacity).toBeGreaterThan(0);
        expect(render.opacity).toBeLessThanOrEqual(1);
      }
    }
  });

  it("should survive non-finite and out-of-range inputs", () => {
    for (const [delta, zoom] of [
      [Number.NaN, 1],
      [Number.POSITIVE_INFINITY, 1],
      [0, Number.NaN],
      [0, 0],
      [0, -3],
      [0, Number.POSITIVE_INFINITY],
    ] as const) {
      const render = edgeRender(delta, zoom);
      expect(Number.isFinite(render.thickness)).toBe(true);
      expect(Number.isFinite(render.opacity)).toBe(true);
      expect(render.thickness).toBeGreaterThan(0);
      expect(render.opacity).toBeGreaterThan(0);
    }
  });

  it("should read a deeper target as thinner and lower-contrast than a flat edge", () => {
    const flat = edgeRender(depthDelta(0, 0), 1);
    const nested = edgeRender(depthDelta(0, 3), 1);
    expect(nested.thickness).toBeLessThan(flat.thickness);
    expect(nested.opacity).toBeLessThan(flat.opacity);
  });
});
