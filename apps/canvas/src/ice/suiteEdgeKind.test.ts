import { edgeKinds, edgePaths } from "@suite/graph";
import { type Entity, Position, PrefabId, Size } from "@vibecook/ice";
import { driversOf, type ObjectContext, type ObjectKind, objectKindOf } from "@vibecook/ice/desk";
import { describe, expect, it } from "vitest";
import type { Point } from "./iceEdgeGeometry";
import {
  arrowQuads,
  distanceToPolyline,
  polylineBounds,
  SUITE_EDGE_ARROW_LENGTH,
  SUITE_EDGE_DEFAULT_THICKNESS,
  SUITE_EDGE_FACE,
  SUITE_EDGE_HIT_PX,
  SUITE_EDGE_INTERACTION,
  SUITE_EDGE_KIND,
  SUITE_EDGE_SIZE,
  SUITE_EDGE_STRATUM,
  SUITE_EDGE_TONE,
  SUITE_EDGE_TYPE,
  SuiteEdge,
  type SuiteEdgeFace,
  type SuiteEdgeGeometry,
  type SuiteEdgeTrace,
  segmentQuads,
  setSuiteEdgeLinkOf,
  suiteEdgeEntities,
  suiteEdgeHitTest,
  suiteEdgeSpawn,
} from "./suiteEdgeKind";

/** A straight run of ink, the simplest link there is. */
const flat: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];

/** A hard-cornered route: the shape `path: "step"` routes between (0,0) and (100,100). */
const elbow: readonly Point[] = [
  { x: 0, y: 0 },
  { x: 50, y: 0 },
  { x: 50, y: 100 },
  { x: 100, y: 100 },
];

const kind = objectKindOf(SuiteEdge) as
  | ObjectKind<SuiteEdgeGeometry, readonly unknown[]>
  | undefined;

/**
 * What the builder hands `resolve`: the props, the side table the driver keeps,
 * and the camera. Everything else a link ignores.
 */
function edgeContext(overrides: {
  readonly polyline?: readonly Point[] | undefined;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly zoom?: number;
  readonly pens?: Readonly<Record<string, readonly [number, number, number]>>;
}): ObjectContext {
  return {
    entity: 1 as unknown as Entity,
    props: { thickness: SUITE_EDGE_DEFAULT_THICKNESS, ...overrides.props },
    local: overrides.polyline === undefined ? undefined : { polylineOf: () => overrides.polyline },
    view: { zoom: overrides.zoom ?? 1 },
    look: { pens: overrides.pens ?? { card: [0.2, 0.2, 0.2] } },
  } as unknown as ObjectContext;
}

describe("suite.edge kind", () => {
  it("should expose the same type and kind name", () => {
    expect(SuiteEdge.type).toBe(SUITE_EDGE_TYPE);
    expect(SUITE_EDGE_KIND).toBe(SUITE_EDGE_TYPE);
    expect(kind?.name).toBe(SUITE_EDGE_KIND);
  });

  it("should carry only stable props on the edge group", () => {
    expect(SUITE_EDGE_FACE).toBeDefined();
    expect(SuiteEdge.propToGroup).toEqual({
      edgeId: "edge",
      kind: "edge",
      path: "edge",
      thickness: "edge",
      arrow: "edge",
    });
  });

  it("should be selectable and never moved, resized, snapped or dropped", () => {
    expect(SUITE_EDGE_INTERACTION).toEqual({
      selectable: true,
      movable: false,
      resizable: false,
      snap: "none",
      drop: "never",
    });
    expect(SuiteEdge.defaultSize).toEqual(SUITE_EDGE_SIZE);
    // Over the Board it crosses, under every card.
    expect(SUITE_EDGE_STRATUM).toBe("sheets");
    expect(SuiteEdge.stratum).toBe(SUITE_EDGE_STRATUM);
  });

  it("should declare a driver that always follows", () => {
    const driver = driversOf(SuiteEdge);
    expect(typeof driver).toBe("function");
    const made = driver?.({
      local: {
        polylineOf: () => undefined,
        traceOf: () => undefined,
        setTrace: () => {},
        touch: () => {},
        dropTrace: () => {},
        clear: () => {},
      },
    } as never);
    expect(typeof made?.follow).toBe("function");
    // No `idle`: an endpoint can move with no input on this object at all.
    expect(made?.idle).toBeUndefined();
  });

  it("should offer both graph enums as its props' values", () => {
    const face: SuiteEdgeFace = {
      edgeId: "edge-1",
      kind: edgeKinds[1],
      path: edgePaths[0],
      thickness: 2,
      arrow: true,
    };
    expect(edgeKinds).toContain(face.kind);
    expect(edgePaths).toContain(face.path);
  });
});

describe("polylineBounds", () => {
  it("should return the axis-aligned box of every sample", () => {
    expect(polylineBounds(elbow)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("should grow by the pad on every side", () => {
    expect(polylineBounds(elbow, 2)).toEqual({ x: -2, y: -2, width: 104, height: 104 });
  });

  it("should give a flat line a real height only by its pad", () => {
    expect(polylineBounds(flat)).toEqual({ x: 0, y: 0, width: 100, height: 0 });
    expect(polylineBounds(flat, 1)).toEqual({ x: -1, y: -1, width: 102, height: 2 });
  });

  it("should be empty for a polyline with no samples", () => {
    expect(polylineBounds([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("segmentQuads", () => {
  it("should make one quad per non-degenerate segment", () => {
    expect(segmentQuads(flat, 2)).toHaveLength(1);
    expect(segmentQuads(elbow, 2)).toHaveLength(3);
    expect(
      segmentQuads(
        [
          { x: 0, y: 0 },
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        2,
      ),
    ).toHaveLength(1);
    expect(segmentQuads([], 2)).toHaveLength(0);
  });

  it("should centre each quad on its segment and turn it along the run", () => {
    const [horizontal] = segmentQuads(flat, 2);
    expect(horizontal).toMatchObject({ cx: 50, cy: 0, angle: 0, cos: 1, sin: 0, thickness: 2 });

    const [vertical] = segmentQuads(
      [
        { x: 10, y: 0 },
        { x: 10, y: 50 },
      ],
      2,
    );
    expect(vertical?.cx).toBe(10);
    expect(vertical?.cy).toBe(25);
    expect(vertical?.angle).toBeCloseTo(Math.PI / 2, 12);
    expect(vertical?.cos).toBeCloseTo(0, 12);
    expect(vertical?.sin).toBeCloseTo(1, 12);

    const [diagonal] = segmentQuads(
      [
        { x: 0, y: 0 },
        { x: 3, y: 4 },
      ],
      2,
    );
    expect(diagonal?.cx).toBe(1.5);
    expect(diagonal?.cy).toBe(2);
    expect(diagonal?.angle).toBeCloseTo(Math.atan2(4, 3), 12);
    expect(diagonal?.length).toBeCloseTo(7, 12);
  });

  it("should run one thickness past each end so a joint has no notch", () => {
    const [quad] = segmentQuads(flat, 2);
    // 100 of segment, plus half a thickness of round cap at each end.
    expect(quad?.length).toBe(102);

    const [thick] = segmentQuads(flat, 8);
    expect(thick?.length).toBe(108);
    expect(thick?.thickness).toBe(8);
  });

  it("should keep the ink the same on every segment", () => {
    const quads = segmentQuads(elbow, 3);
    expect(new Set(quads.map((quad) => quad.thickness))).toEqual(new Set([3]));
  });

  it("should never take a zero, negative or NaN thickness", () => {
    for (const thickness of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const [quad] = segmentQuads(flat, thickness);
      expect(quad?.thickness).toBeGreaterThan(0);
      expect(Number.isFinite(quad?.thickness)).toBe(true);
    }
  });
});

describe("arrowQuads", () => {
  it("should open two barbs behind the target end", () => {
    const barbs = arrowQuads(flat, 2);
    expect(barbs).toHaveLength(2);
    // Symmetric about the incoming direction, one on each side.
    expect(barbs[0]?.angle).toBeCloseTo(Math.PI - Math.PI / 6, 12);
    expect(barbs[1]?.angle).toBeCloseTo(Math.PI + Math.PI / 6, 12);
    for (const barb of barbs) {
      expect(barb.length).toBeCloseTo(2 * SUITE_EDGE_ARROW_LENGTH, 12);
      // Drawn behind the tip, never past it.
      expect(barb.cx).toBeLessThan(100);
    }
  });

  it("should take the last real direction, not a repeated sample", () => {
    const barbs = arrowQuads(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
      ],
      2,
    );
    expect(barbs[0]?.angle).toBeCloseTo(Math.PI - Math.PI / 6, 12);
  });

  it("should draw nothing for a polyline with no direction", () => {
    expect(arrowQuads([], 2)).toHaveLength(0);
    expect(arrowQuads([{ x: 5, y: 5 }], 2)).toHaveLength(0);
    expect(
      arrowQuads(
        [
          { x: 5, y: 5 },
          { x: 5, y: 5 },
        ],
        2,
      ),
    ).toHaveLength(0);
  });
});

describe("distanceToPolyline", () => {
  it("should be zero on the ink and the perpendicular distance beside it", () => {
    expect(distanceToPolyline(flat, 50, 0)).toBeCloseTo(0, 12);
    expect(distanceToPolyline(flat, 50, 3)).toBeCloseTo(3, 12);
    expect(distanceToPolyline(flat, 50, -4)).toBeCloseTo(4, 12);
  });

  it("should measure to the nearest segment, corners included", () => {
    // The elbow's corner at (50, 0): a point 3 right and 4 up is 5 from the
    // horizontal run's end.
    expect(distanceToPolyline(elbow, 53, -4)).toBeCloseTo(5, 12);
    // Inside the bounding box but far from the ink: the rect is never the test.
    expect(distanceToPolyline(elbow, 10, 50)).toBeCloseTo(40, 12);
  });

  it("should be infinite without samples", () => {
    expect(distanceToPolyline([], 0, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("suiteEdgeHitTest", () => {
  /** Exactly what `resolve` would build for this polyline at this zoom. */
  const geometryOf = (polyline: readonly Point[], zoom = 1, thickness = 2): SuiteEdgeGeometry => ({
    polyline,
    quads: segmentQuads(polyline, thickness),
    thickness,
    zoom,
    arrow: false,
    box: polylineBounds(polyline),
    hitSlop: Math.max(thickness / 2, SUITE_EDGE_HIT_PX / zoom),
  });
  const hit = (polyline: readonly Point[], x: number, y: number, zoom = 1, thickness = 2) =>
    suiteEdgeHitTest(geometryOf(polyline, zoom, thickness), x, y);

  it("should hit on the line, near it, and miss far from it", () => {
    expect(hit(flat, 50, 0)).toBe(true);
    expect(hit(flat, 50, 3)).toBe(true);
    expect(hit(flat, 50, 50)).toBe(false);
  });

  it("should stay grabbable at a hard corner", () => {
    expect(hit(elbow, 50, 0)).toBe(true);
    expect(hit(elbow, 53, -4)).toBe(true);
  });

  it("should never treat the bounding rect as the target", () => {
    // Inside the elbow's box, 40 units from any ink.
    expect(hit(elbow, 10, 50)).toBe(false);
  });

  it("should widen with the inverse zoom and never narrow under the ink", () => {
    // 4 units off the ink: inside 6 px at zoom 1, outside 1.5 world units at zoom 4.
    expect(hit(flat, 50, 4, 1)).toBe(true);
    expect(hit(flat, 50, 4, 4)).toBe(false);
    // A thick link keeps its own half width as the floor.
    expect(hit(flat, 50, 4, 100, 20)).toBe(true);
  });

  it("should resolve a real geometry's slop from the frame's zoom", () => {
    const geometry = kind?.resolve(
      edgeContext({ polyline: flat, zoom: 4, props: { thickness: 2 } }),
    ) as SuiteEdgeGeometry;
    expect(geometry.hitSlop).toBeCloseTo(SUITE_EDGE_HIT_PX / 4, 12);
    expect(suiteEdgeHitTest(geometry, 50, 1)).toBe(true);
    expect(suiteEdgeHitTest(geometry, 50, 4)).toBe(false);
  });
});

describe("resolve and record", () => {
  it("should turn the side table's polyline into one quad per segment, plus the arrow", () => {
    const plain = kind?.resolve(edgeContext({ polyline: elbow })) as SuiteEdgeGeometry;
    expect(plain.quads).toHaveLength(3);
    expect(plain.arrow).toBe(false);
    expect(plain.box).toEqual({ x: -1, y: -1, width: 102, height: 102 });

    const armed = kind?.resolve(
      edgeContext({ polyline: flat, props: { thickness: 2, arrow: true } }),
    ) as SuiteEdgeGeometry;
    expect(armed.arrow).toBe(true);
    expect(armed.quads).toHaveLength(1 + 2);
  });

  it("should be empty — not stale — while an endpoint is off the desk", () => {
    const geometry = kind?.resolve(edgeContext({})) as SuiteEdgeGeometry;
    expect(geometry.polyline).toEqual([]);
    expect(geometry.quads).toEqual([]);
    expect(suiteEdgeHitTest(geometry, 0, 0)).toBe(false);
  });

  it("should hand the paper pass one flat sheet per quad", () => {
    const context = edgeContext({ polyline: flat, props: { kind: "relates-to", thickness: 2 } });
    const geometry = kind?.resolve(context) as SuiteEdgeGeometry;
    const sheets = kind?.record(geometry, context) ?? [];

    expect(sheets).toHaveLength(1);
    const sheet = sheets[0] as {
      geometry: { radius: number; lift: number; alpha: number; half: readonly [number, number] };
      paper: readonly [number, number, number];
      grain: number;
    };
    expect(sheet.geometry.half).toEqual([51, 1]);
    expect(sheet.geometry.radius).toBe(1);
    expect(sheet.geometry.lift).toBe(0);
    expect(sheet.geometry.alpha).toBe(SUITE_EDGE_TONE["relates-to"]);
    expect(sheet.paper).toEqual([0.2, 0.2, 0.2]);
    expect(sheet.grain).toBe(0);
  });

  it("should tone each relation differently and fall back to references", () => {
    const alphaOf = (kindName: string) => {
      const context = edgeContext({ polyline: flat, props: { kind: kindName } });
      const geometry = kind?.resolve(context) as SuiteEdgeGeometry;
      const sheets = kind?.record(geometry, context) ?? [];
      return (sheets[0] as { geometry: { alpha: number } }).geometry.alpha;
    };
    expect(alphaOf("references")).toBe(SUITE_EDGE_TONE.references);
    expect(alphaOf("tagged")).toBe(SUITE_EDGE_TONE.tagged);
    expect(alphaOf("nonsense")).toBe(SUITE_EDGE_TONE.references);
  });
});

describe("suiteEdgeSpawn", () => {
  it("should box a same-Board link on its polyline, grown by the ink", () => {
    const spawn = suiteEdgeSpawn({
      edgeId: "edge-1",
      kind: "relates-to",
      path: "straight",
      from: { x: 10, y: 20 },
      to: { x: 110, y: 20 },
    });
    expect(spawn.type).toBe(SUITE_EDGE_TYPE);
    expect(spawn).toMatchObject({ x: 9, y: 19, w: 102, h: 2 });
    expect(spawn.props).toEqual({
      edgeId: "edge-1",
      kind: "relates-to",
      path: "straight",
      thickness: SUITE_EDGE_DEFAULT_THICKNESS,
      arrow: false,
    });
  });

  it("should box a frame-crossing link around both anchors", () => {
    const from = { x: -500, y: -300 };
    const to = { x: 900, y: 700 };
    const spawn = suiteEdgeSpawn({
      edgeId: "edge-2",
      kind: "references",
      path: "bezier",
      from,
      to,
      thickness: 4,
      arrow: true,
    });
    expect(spawn.x).toBeLessThanOrEqual(from.x);
    expect(spawn.y).toBeLessThanOrEqual(from.y);
    expect(spawn.x + spawn.w).toBeGreaterThanOrEqual(to.x);
    expect(spawn.y + spawn.h).toBeGreaterThanOrEqual(to.y);
    expect(spawn.w).toBeGreaterThan(0);
    expect(spawn.h).toBeGreaterThan(0);
    expect(spawn.props).toMatchObject({ thickness: 4, arrow: true });
  });

  it("should give a flat link a real height and a vertical one a real width", () => {
    const horizontal = suiteEdgeSpawn({
      edgeId: "edge-3",
      kind: "tagged",
      path: "straight",
      from: { x: 0, y: 0 },
      to: { x: 100, y: 0 },
    });
    expect(horizontal.h).toBe(SUITE_EDGE_DEFAULT_THICKNESS);

    const vertical = suiteEdgeSpawn({
      edgeId: "edge-4",
      kind: "tagged",
      path: "straight",
      from: { x: 5, y: 0 },
      to: { x: 5, y: 100 },
    });
    expect(vertical.w).toBe(SUITE_EDGE_DEFAULT_THICKNESS);
  });

  it("should never spawn a zero-thickness link", () => {
    const spawn = suiteEdgeSpawn({
      edgeId: "edge-5",
      kind: "references",
      path: "straight",
      from: { x: 0, y: 0 },
      to: { x: 10, y: 10 },
      thickness: 0,
    });
    expect(spawn.props.thickness).toBeGreaterThan(0);
    expect(spawn.w).toBeGreaterThan(0);
    expect(spawn.h).toBeGreaterThan(0);
  });
});

describe("the driver's recompute policy", () => {
  const entity = 7 as unknown as Entity;
  const face: SuiteEdgeFace = {
    edgeId: "edge-1",
    kind: "relates-to",
    path: "straight",
    thickness: 2,
    arrow: false,
  };

  /** A world holding one link: its props group plus a rect the writes land in. */
  type RectState = { x?: number; y?: number; w?: number; h?: number };

  function worldOf(rect: RectState, writes: { count: number }): unknown {
    return {
      entities: () => [entity],
      isAlive: () => true,
      read: (_e: Entity, component: unknown) =>
        component === PrefabId ? { id: SUITE_EDGE_TYPE } : undefined,
      get: (_e: Entity, component: unknown) => {
        if (component === SUITE_EDGE_FACE) return face;
        if (component === Position) {
          return rect.x === undefined ? undefined : { x: rect.x, y: rect.y ?? 0 };
        }
        if (component === Size) {
          return rect.w === undefined ? undefined : { w: rect.w, h: rect.h ?? 0 };
        }
        return undefined;
      },
      edit: () => ({
        set(component: unknown, value: { x?: number; y?: number; w?: number; h?: number }) {
          if (component === Position) {
            if (value.x !== undefined) rect.x = value.x;
            if (value.y !== undefined) rect.y = value.y;
          }
          if (component === Size) {
            if (value.w !== undefined) rect.w = value.w;
            if (value.h !== undefined) rect.h = value.h;
          }
          writes.count += 1;
        },
      }),
    };
  }

  it("should re-route once, then hold while neither end moves, then follow a move", () => {
    const writes = { count: 0 };
    const rect: { x?: number; y?: number; w?: number; h?: number } = {};
    let remakes = 0;
    const local = kind?.local?.({
      remake: () => {
        remakes += 1;
      },
    } as never) as unknown as {
      polylineOf(e: Entity): readonly Point[] | undefined;
      traceOf(e: Entity): SuiteEdgeTrace | undefined;
    };
    const driver = driversOf(SuiteEdge)?.({
      world: worldOf(rect, writes),
      local,
    } as never);

    let source = { x: 0, y: 0 };
    setSuiteEdgeLinkOf(() => ({
      source: { placement: { x: source.x, y: source.y, width: 10, height: 10 }, frames: [] },
      target: { placement: { x: 100, y: 0, width: 10, height: 10 }, frames: [] },
    }));

    try {
      driver?.follow(0);
      const first = local.traceOf(entity);
      expect(first?.polyline).toHaveLength(2);
      // Anchor = placement + half the card, `anchorWorld`'s rule.
      expect(first?.from).toEqual({ x: 5, y: 5 });
      expect(first?.to).toEqual({ x: 105, y: 5 });
      expect(remakes).toBe(1);
      // The box is the polyline's bounds grown by half the ink.
      expect(rect).toEqual({ x: 4, y: 4, w: 102, h: 2 });
      expect(writes.count).toBeGreaterThan(0);

      // Nothing moved: the side table is not touched, the record is not remade,
      // and the rect is left alone.
      const settled = writes.count;
      driver?.follow(16);
      expect(local.traceOf(entity)).toBe(first);
      expect(remakes).toBe(1);
      expect(writes.count).toBe(settled);

      // One endpoint moved: re-route, remake, re-box.
      source = { x: 0, y: 200 };
      driver?.follow(32);
      expect(local.traceOf(entity)).not.toBe(first);
      expect(local.traceOf(entity)?.from).toEqual({ x: 5, y: 205 });
      expect(remakes).toBe(2);
      // The link now runs (5,205) → (105,5): the box grows to hold both ends.
      expect(rect).toEqual({ x: 4, y: 4, w: 102, h: 202 });
    } finally {
      setSuiteEdgeLinkOf(undefined);
      driver?.dispose?.();
    }
  });

  it("should draw nothing until the surface says where the ends are", () => {
    const remakes = 0;
    const local = kind?.local?.({ remake: () => {} } as never) as unknown as {
      polylineOf(e: Entity): readonly Point[] | undefined;
    };
    const driver = driversOf(SuiteEdge)?.({
      world: worldOf({}, { count: 0 }),
      local,
    } as never);
    setSuiteEdgeLinkOf(undefined);
    try {
      expect(() => driver?.follow(0)).not.toThrow();
      expect(local.polylineOf(entity)).toBeUndefined();
      expect(remakes).toBe(0);
    } finally {
      driver?.dispose?.();
    }
  });
});

describe("suiteEdgeEntities", () => {
  it("should walk no entities on a world with none of ours", () => {
    const world = {
      entities: () => [],
      isAlive: () => false,
      read: () => undefined,
    };
    expect(suiteEdgeEntities(world as never)).toEqual([]);
  });
});
