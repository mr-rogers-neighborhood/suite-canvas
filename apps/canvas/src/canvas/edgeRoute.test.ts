import type { GraphEdge } from "@suite/graph";
import { describe, expect, it } from "vitest";
import {
  absoluteBends,
  avoidRoute,
  isAvoidMode,
  pairOffset,
  type RoutePoint,
  type RouteRect,
  reversePartnerOf,
  routePath,
  routePoints,
  shiftRoute,
} from "./edgeRoute";

/** Parses a path into its drawing commands, so a test can count and measure them. */
function commands(path: string): { command: string; numbers: number[] }[] {
  return (path.match(/[MLQC][^MLQC]*/g) ?? []).map((chunk) => {
    const [command = "", ...rest] = chunk.trim().split(/[\s,]+/);
    return { command, numbers: rest.map(Number) };
  });
}

function countOf(path: string, command: string): number {
  return commands(path).filter((part) => part.command === command).length;
}

function startOf(path: string): RoutePoint {
  const numbers = commands(path)[0]?.numbers ?? [];
  return { x: numbers[0] ?? Number.NaN, y: numbers[1] ?? Number.NaN };
}

function endOf(path: string): RoutePoint {
  const parts = commands(path);
  const numbers = parts[parts.length - 1]?.numbers ?? [];
  return {
    x: numbers[numbers.length - 2] ?? Number.NaN,
    y: numbers[numbers.length - 1] ?? Number.NaN,
  };
}

/** The points a mode is expected to pass through, read back off the path. */
function waypoints(path: string): RoutePoint[] {
  return commands(path).map((part) => {
    const numbers = part.numbers;
    return {
      x: numbers[numbers.length - 2] ?? Number.NaN,
      y: numbers[numbers.length - 1] ?? Number.NaN,
    };
  });
}

function inside(point: RoutePoint, rect: RouteRect): boolean {
  return (
    point.x > rect.x &&
    point.x < rect.x + rect.width &&
    point.y > rect.y &&
    point.y < rect.y + rect.height
  );
}

function insideAny(point: RoutePoint, rects: readonly RouteRect[]): boolean {
  return rects.some((rect) => inside(point, rect));
}

function isCollinear(a: RoutePoint, b: RoutePoint, c: RoutePoint): boolean {
  const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  return Math.abs(cross) < 1e-6;
}

const source = { x: 100, y: 100 };
const target = { x: 400, y: 300 };

describe("route points", () => {
  it("is just the two ends when there are no bends", () => {
    expect(routePoints(source, target)).toEqual([source, target]);
    expect(routePoints(source, target, [])).toEqual([source, target]);
    expect(routePoints(source, target, undefined)).toEqual([source, target]);
  });

  it("resolves bends from source-relative to absolute", () => {
    expect(absoluteBends(source, undefined)).toEqual([]);
    expect(absoluteBends(source, [{ x: 50, y: -20 }])).toEqual([{ x: 150, y: 80 }]);
    expect(routePoints(source, target, [{ x: 50, y: -20 }])).toEqual([
      source,
      { x: 150, y: 80 },
      target,
    ]);
  });

  it("keeps a whole hand-drawn polyline in order", () => {
    const bends = [
      { x: 40, y: 60 },
      { x: 140, y: 60 },
      { x: 140, y: 140 },
    ];
    expect(routePoints({ x: 0, y: 0 }, target, bends)).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 60 },
      { x: 140, y: 60 },
      { x: 140, y: 140 },
      target,
    ]);
  });

  it("drops consecutive duplicates and unusable bends", () => {
    const points = routePoints({ x: 0, y: 0 }, { x: 200, y: 0 }, [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 0 },
      { x: Number.NaN, y: 10 },
      { x: 10, y: Number.POSITIVE_INFINITY },
      { x: 150, y: 0 },
    ]);
    expect(points).toEqual([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 150, y: 0 },
      { x: 200, y: 0 },
    ]);
  });

  it("still yields a segment for a collapsed link", () => {
    expect(routePoints({ x: 10, y: 10 }, { x: 10, y: 10 })).toHaveLength(2);
  });
});

describe("route paths", () => {
  const bent = routePoints({ x: 0, y: 0 }, { x: 200, y: 100 }, [{ x: 100, y: 0 }]);

  it("draws straight joins through the bends", () => {
    const path = routePath(bent, "straight");
    expect(countOf(path, "L")).toBe(2);
    expect(waypoints(path)).toEqual(bent);
    expect(startOf(path)).toEqual({ x: 0, y: 0 });
    expect(endOf(path)).toEqual({ x: 200, y: 100 });
  });

  it("draws a single segment for a straight line with no bends", () => {
    const path = routePath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
      "straight",
    );
    expect(path).toBe("M 0 0 L 100 50");
    expect(countOf(path, "L")).toBe(1);
  });

  it("draws right angles for step, with no bends and with them", () => {
    const plain = routePath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      "step",
    );
    // Horizontal first, then the vertical run: two elbows' worth of segments.
    expect(plain).toBe("M 0 0 L 100 0 L 100 100");
    expect(countOf(plain, "L")).toBe(2);

    const path = routePath(
      [
        { x: 0, y: 0 },
        { x: 50, y: 100 },
        { x: 200, y: 150 },
      ],
      "step",
    );
    expect(countOf(path, "L")).toBe(4);
    const points = waypoints(path);
    for (let index = 1; index < points.length; index += 1) {
      const from = points[index - 1];
      const to = points[index];
      if (!from || !to) continue;
      expect(from.x === to.x || from.y === to.y).toBe(true);
    }
    expect(startOf(path)).toEqual({ x: 0, y: 0 });
    expect(endOf(path)).toEqual({ x: 200, y: 150 });
  });

  it("rounds the corners of a smooth step", () => {
    const path = routePath(
      [
        { x: 0, y: 0 },
        { x: 200, y: 200 },
      ],
      "smoothstep",
    );
    // One elbow (at 200,0) becomes one quadratic corner.
    expect(countOf(path, "Q")).toBe(1);
    expect(countOf(path, "L")).toBe(2);
    expect(startOf(path)).toEqual({ x: 0, y: 0 });
    expect(endOf(path)).toEqual({ x: 200, y: 200 });
  });

  it("bends the smooth step through every hand-placed point", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ];
    const path = routePath(points, "smoothstep");
    expect(countOf(path, "Q")).toBe(2);
    expect(startOf(path)).toEqual({ x: 0, y: 0 });
    expect(endOf(path)).toEqual({ x: 200, y: 100 });
  });

  it("curves through a single bend with one cubic", () => {
    const path = routePath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      "bezier",
    );
    expect(countOf(path, "C")).toBe(1);
    expect(startOf(path)).toEqual({ x: 0, y: 0 });
    expect(endOf(path)).toEqual({ x: 100, y: 100 });
  });

  it("keeps a horizontal shape for a bezier with no bends", () => {
    const path = routePath(
      [
        { x: 0, y: 0 },
        { x: 300, y: 120 },
      ],
      "bezier",
    );
    const control = commands(path).find((part) => part.command === "C")?.numbers ?? [];
    // Both controls leave their end horizontally: the app's gentle S curve.
    expect(control[1]).toBe(0);
    expect(control[3]).toBe(120);
    expect(control[0] ?? 0).toBeGreaterThan(0);
    expect(control[2] ?? 0).toBeLessThan(300);
  });

  it("curves through every bend rather than around them", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ];
    const path = routePath(points, "bezier");
    expect(countOf(path, "C")).toBe(3);
    // A Catmull-Rom conversion lands each curve exactly on the next point.
    expect(waypoints(path)).toEqual(points);
    expect(startOf(path)).toEqual({ x: 0, y: 0 });
    expect(endOf(path)).toEqual({ x: 200, y: 100 });
  });

  it("draws manual bends sharply in avoid mode, because bends win", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 40 },
      { x: 200, y: 0 },
    ];
    expect(routePath(points, "avoid")).toBe(routePath(points, "straight"));
  });

  it("rounds a routed polyline in avoid mode", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0, y: 60 },
      { x: 400, y: 60 },
      { x: 400, y: 0 },
    ];
    const path = routePath(points, "avoid");
    expect(countOf(path, "Q")).toBe(2);
    expect(path).toBe(routePath(points, "smoothstep"));
    expect(startOf(path)).toEqual({ x: 0, y: 0 });
    expect(endOf(path)).toEqual({ x: 400, y: 0 });
  });

  it("knows which mode routes around obstacles", () => {
    expect(isAvoidMode("avoid")).toBe(true);
    expect(isAvoidMode("bezier")).toBe(false);
    expect(isAvoidMode("straight")).toBe(false);
    expect(isAvoidMode("step")).toBe(false);
    expect(isAvoidMode("smoothstep")).toBe(false);
  });
});

describe("avoiding obstacles", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 400, y: 0 };
  const wall = { x: 180, y: -10, width: 40, height: 20 };

  it("goes around a wall between the ends", () => {
    const route = avoidRoute(from, to, [wall]);
    expect(route).not.toBeNull();
    if (!route) return;

    expect(route[0]).toEqual(from);
    expect(route[route.length - 1]).toEqual(to);
    for (const point of route) expect(insideAny(point, [wall])).toBe(false);

    // Every point of every segment stays clear, not just the corners.
    for (let index = 1; index < route.length; index += 1) {
      const a = route[index - 1];
      const b = route[index];
      if (!a || !b) continue;
      for (let step = 1; step < 10; step += 1) {
        const t = step / 10;
        expect(insideAny({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, [wall])).toBe(
          false,
        );
      }
    }
  });

  it("rounds a real router result, anchor stubs and all", () => {
    const route = avoidRoute(from, to, [wall]);
    expect(route).not.toBeNull();
    if (!route) return;
    expect(countOf(routePath(route, "avoid"), "Q")).toBeGreaterThan(0);
    expect(routePath(route, "avoid")).not.toBe(routePath(route, "straight"));
  });

  it("simplifies the polyline it returns", () => {
    const route = avoidRoute(from, to, [wall]);
    expect(route).not.toBeNull();
    if (!route) return;
    for (let index = 2; index < route.length; index += 1) {
      const a = route[index - 2];
      const b = route[index - 1];
      const c = route[index];
      if (!a || !b || !c) continue;
      expect(isCollinear(a, b, c)).toBe(false);
    }
  });

  it("is deterministic across calls", () => {
    expect(avoidRoute(from, to, [wall])).toEqual(avoidRoute(from, to, [wall]));
  });

  it("declines when the straight line is already clear", () => {
    expect(avoidRoute(from, to, [])).toBeNull();
    expect(avoidRoute(from, to, [{ x: 0, y: 200, width: 40, height: 40 }])).toBeNull();
    expect(avoidRoute({ x: 10, y: 10 }, { x: 10, y: 10 }, [wall])).toBeNull();
    // The card an end sits on is not an obstacle: the anchor is on its border.
    expect(avoidRoute(from, to, [{ x: -50, y: -50, width: 60, height: 60 }])).toBeNull();
  });

  it("declines when the node budget runs out", () => {
    expect(avoidRoute(from, to, [wall], { budget: 1 })).toBeNull();
  });

  it("declines when the grid has no room to go around", () => {
    // Taller than the margin allows a detour: the caller falls back to bezier.
    const wallAllTheWay = { x: 180, y: -400, width: 40, height: 800 };
    expect(avoidRoute(from, to, [wallAllTheWay])).toBeNull();
  });
});

/** A minimal edge record: only the fields the pair rule reads matter here. */
function edge(id: string, source: string, target: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    boardId: "board-1",
    source,
    target,
    kind: "references",
    path: "bezier",
    bidirectional: false,
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  } as unknown as GraphEdge;
}

describe("reverse pairs", () => {
  const a = { x: 100, y: 100 };
  const b = { x: 400, y: 300 };

  it("gives the same edge the same offset every time", () => {
    expect(pairOffset("edge-1", a, b)).toEqual(pairOffset("edge-1", a, b));
  });

  it("mirrors an edge that travels the other way, so a pair cannot overlap", () => {
    // Same id, reversed travel: the vector is exactly negated, which is what
    // guarantees the two directions land on opposite sides.
    const forward = pairOffset("edge-1", a, b);
    const backward = pairOffset("edge-1", b, a);
    expect(backward.x).toBeCloseTo(-forward.x, 6);
    expect(backward.y).toBeCloseTo(-forward.y, 6);
    expect(Math.hypot(forward.x, forward.y)).toBeGreaterThan(0);
  });

  it("gives the two directions of a pair two different, deterministic offsets", () => {
    const out = pairOffset("edge-incoming", a, b);
    const back = pairOffset("edge-outgoing", b, a);
    expect(out).not.toEqual(back);
    // Opposite sides of the straight line whatever the two ids hash to.
    expect(out.x * back.x + out.y * back.y).toBeLessThan(0);
    expect(pairOffset("edge-incoming", a, b)).toEqual(out);
    expect(pairOffset("edge-outgoing", b, a)).toEqual(back);
  });

  it("keeps the offset small and perpendicular to the line", () => {
    const offset = pairOffset("edge-1", a, b);
    const length = Math.hypot(offset.x, offset.y);
    expect(length).toBeGreaterThanOrEqual(4);
    expect(length).toBeLessThanOrEqual(10);
    const line = { x: b.x - a.x, y: b.y - a.y };
    expect(offset.x * line.x + offset.y * line.y).toBeCloseTo(0, 6);
  });

  it("declines on a collapsed line rather than dividing by zero", () => {
    expect(pairOffset("edge-1", a, a)).toEqual({ x: 0, y: 0 });
  });

  it("finds the link that runs the same dots the other way", () => {
    const out = edge("e-out", "card-a", "card-b", {
      sourceConnector: "dot-1",
      targetConnector: "dot-2",
    });
    const back = edge("e-back", "card-b", "card-a", {
      sourceConnector: "dot-2",
      targetConnector: "dot-1",
    });
    const elsewhere = edge("e-other", "card-a", "card-c");
    expect(reversePartnerOf(out, [out, back, elsewhere])?.id).toBe("e-back");
    expect(reversePartnerOf(out, [out, elsewhere])).toBeUndefined();
    // Same pair, different dots: not the same connection, so not a pair.
    const otherDots = edge("e-dots", "card-b", "card-a", {
      sourceConnector: "dot-3",
      targetConnector: "dot-1",
    });
    expect(reversePartnerOf(out, [out, otherDots])).toBeUndefined();
    // A self link is never paired with itself.
    const loop = edge("e-loop", "card-a", "card-a");
    expect(reversePartnerOf(loop, [loop])).toBeUndefined();
  });
});

describe("shifting a route sideways", () => {
  const a = { x: 100, y: 100 };
  const b = { x: 400, y: 300 };
  const offset = { x: 0, y: -6 };

  it("bows a two-point route out through a new midpoint", () => {
    const shifted = shiftRoute([a, b], offset);
    expect(shifted).toHaveLength(3);
    expect(shifted[0]).toEqual(a);
    expect(shifted[2]).toEqual(b);
    expect(shifted[1]).toEqual({ x: 250, y: 194 });
  });

  it("moves the interior of a bent route and leaves the ends on their dots", () => {
    const points = routePoints(a, b, [{ x: 80, y: -40 }]);
    const shifted = shiftRoute(points, offset);
    expect(shifted).toHaveLength(points.length);
    expect(shifted[0]).toEqual(a);
    expect(shifted[shifted.length - 1]).toEqual(b);
    expect(shifted[1]).toEqual({ x: points[1]?.x ?? 0, y: (points[1]?.y ?? 0) - 6 });
  });

  it("is a no-op for a zero offset", () => {
    expect(shiftRoute([a, b], { x: 0, y: 0 })).toEqual([a, b]);
  });

  it("splits a pair apart while both still start and end on their dots", () => {
    const out = shiftRoute([a, b], pairOffset("e-1", a, b));
    const back = shiftRoute([a, b], pairOffset("e-2", b, a));
    const outMid = out[1];
    const backMid = back[1];
    if (!outMid || !backMid) throw new Error("no midpoint");
    expect(Math.hypot(outMid.x - backMid.x, outMid.y - backMid.y)).toBeGreaterThan(8);
    expect(out[0]).toEqual(a);
    expect(back[2]).toEqual(b);
  });
});
