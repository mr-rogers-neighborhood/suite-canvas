import { describe, expect, it } from "vitest";
import { GRAPH_DEPTH_MAX, graphDepthOffset } from "./suiteGraphDepth";
import {
  createSuiteGraphFaceLayer,
  graphCount,
  graphNodeBacking,
  SUITE_GRAPH_FACE_BOUNDS,
  type SuiteGraphFaceNode,
  suiteGraphFacePlacement,
} from "./suiteGraphFace";

/** A type node's cell at world (100, 50), 96 × 64 — the graph's own `CELL`. */
const rect = { x: 100, y: 50, width: 96, height: 64 };
const camera = { x: 0, y: 0, zoom: 1 };

function node(overrides: Partial<SuiteGraphFaceNode> = {}): SuiteGraphFaceNode {
  return {
    id: "type:1",
    kind: "type",
    rect,
    depth: 0,
    label: "Concept",
    glyph: "◆",
    count: 4,
    ...overrides,
  };
}

describe("graphCount", () => {
  it("should round a count and never draw a negative or broken one", () => {
    expect(graphCount(4)).toBe(4);
    expect(graphCount(4.4)).toBe(4);
    expect(graphCount(-2)).toBe(0);
    expect(graphCount(Number.NaN)).toBe(0);
    expect(graphCount(undefined)).toBe(0);
  });
});

describe("graphNodeBacking", () => {
  it("should square the reused sheet and hold its presence near zero", () => {
    const backing = graphNodeBacking({ angle: 0.2, cos: 0.98, sin: 0.199, alpha: 1 }, 0.02);
    expect(backing).toEqual({ angle: 0, cos: 1, sin: 0, alpha: 0.02 });
    // A sheet that is already fading keeps its own (lower) presence.
    expect(graphNodeBacking({ angle: 0, cos: 1, sin: 0, alpha: 0 }, 0.02).alpha).toBe(0);
    // Fields the program also reads survive the rewrite.
    expect(graphNodeBacking({ angle: 0, cos: 1, sin: 0, alpha: 1, lift: 3 }, 0.02).lift).toBe(3);
  });
});

describe("suiteGraphFacePlacement", () => {
  it("should be the identity over the footprint at depth zero and zoom one", () => {
    const placement = suiteGraphFacePlacement(rect, camera, 0, "type");
    expect(placement).not.toBeNull();
    expect(placement?.face).toEqual({
      left: 100,
      top: 50,
      width: 96,
      height: 64,
      level: 0,
      shadow: 0,
    });
    expect(placement?.stack).toEqual([]);
  });

  it("should project from the camera: text stays put while the camera moves", () => {
    const placement = suiteGraphFacePlacement(rect, { x: 20, y: 10, zoom: 2 }, 0, "type");
    // 96 × 2 = 192 px wide, above the chip's ceiling: clamped to the max width.
    expect(placement?.face.width).toBe(SUITE_GRAPH_FACE_BOUNDS.type.maxWidth);
    expect(placement?.face.left).toBe(
      (100 + 48 - 20) * 2 - SUITE_GRAPH_FACE_BOUNDS.type.maxWidth / 2,
    );
    expect(placement?.face.top).toBe(
      (50 + 32 - 10) * 2 - SUITE_GRAPH_FACE_BOUNDS.type.maxHeight / 2,
    );
  });

  it("should clamp a footprint too small to read up to a legible chip", () => {
    // 96 × 0.05 = 4.8 px: the graph band draws a chip, not a dot.
    const far = suiteGraphFacePlacement(rect, { ...camera, zoom: 0.05 }, 0, "type");
    expect(far?.face.width).toBe(SUITE_GRAPH_FACE_BOUNDS.type.minWidth);
    expect(far?.face.height).toBe(SUITE_GRAPH_FACE_BOUNDS.type.minHeight);
    // And it is the same size across the whole band, so nothing resizes while
    // the camera flies — the text never scales with the world.
    const nearer = suiteGraphFacePlacement(rect, { ...camera, zoom: 0.3 }, 0, "type");
    expect(nearer?.face.width).toBe(far?.face.width);
    expect(nearer?.face.height).toBe(far?.face.height);
  });

  it("should frame a container with its own footprint and a floor that fits a chip", () => {
    const section = { x: 0, y: 0, width: 400, height: 300 };
    const framed = suiteGraphFacePlacement(section, { ...camera, zoom: 0.5 }, 0, "container");
    expect(framed?.face).toMatchObject({ left: 0, top: 0, width: 200, height: 150 });
    const tiny = suiteGraphFacePlacement(
      { x: 0, y: 0, width: 10, height: 10 },
      camera,
      0,
      "container",
    );
    expect(tiny?.face.width).toBe(SUITE_GRAPH_FACE_BOUNDS.container.minWidth);
    expect(tiny?.face.height).toBe(SUITE_GRAPH_FACE_BOUNDS.container.minHeight);
    expect(SUITE_GRAPH_FACE_BOUNDS.container.minWidth).toBeGreaterThanOrEqual(
      SUITE_GRAPH_FACE_BOUNDS.type.minWidth,
    );
  });

  it("should stack one plate per shallower level, each a step below and right", () => {
    const placement = suiteGraphFacePlacement(rect, camera, 2, "type");
    expect(placement?.face.level).toBe(2);
    expect(placement?.stack.map((plate) => plate.level)).toEqual([0, 1]);
    const [surface, middle] = placement?.stack ?? [];
    expect(surface).toBeDefined();
    expect(middle).toBeDefined();
    if (placement === null || surface === undefined || middle === undefined) return;
    // The face is the most up-left and the smallest; the surface plate is the
    // footprint itself.
    expect(placement.face.left).toBeLessThan(middle.left);
    expect(middle.left).toBeLessThan(surface.left);
    expect(placement.face.shadow).toBeGreaterThan(middle.shadow);
    expect(placement.face.width).toBeLessThan(surface.width);
    expect(placement.stack).toHaveLength(2);
  });

  it("should clamp the stack at the deepest drawn level", () => {
    const deep = suiteGraphFacePlacement(rect, camera, GRAPH_DEPTH_MAX + 4, "type");
    expect(deep?.face.level).toBe(GRAPH_DEPTH_MAX);
    expect(deep?.stack).toHaveLength(GRAPH_DEPTH_MAX);
    expect(deep).toEqual(suiteGraphFacePlacement(rect, camera, GRAPH_DEPTH_MAX, "type"));
  });

  it("should draw nothing without usable geometry or a live camera", () => {
    expect(suiteGraphFacePlacement(null, camera, 0, "type")).toBeNull();
    expect(suiteGraphFacePlacement(undefined, camera, 0, "type")).toBeNull();
    expect(suiteGraphFacePlacement(rect, null, 0, "type")).toBeNull();
    expect(suiteGraphFacePlacement(rect, { ...camera, zoom: 0 }, 0, "type")).toBeNull();
    expect(suiteGraphFacePlacement(rect, { ...camera, zoom: Number.NaN }, 0, "type")).toBeNull();
    expect(suiteGraphFacePlacement({ ...rect, x: Number.NaN }, camera, 0, "type")).toBeNull();
  });
});

describe("createSuiteGraphFaceLayer", () => {
  function mount(nodes: SuiteGraphFaceNode[], zoom = 0.1) {
    const container = document.createElement("div");
    const current = { camera: { x: 0, y: 0, zoom } as { x: number; y: number; zoom: number } };
    const layer = createSuiteGraphFaceLayer({
      container,
      nodes: () => nodes,
      camera: () => current.camera,
    });
    return { container, layer, current };
  }

  it("should paint one face per node in screen pixels and tear it down when it goes", () => {
    const nodes = [node(), node({ id: "type:2", rect: { ...rect, x: 300 }, label: "Actor" })];
    const { container, layer } = mount(nodes, 1);
    layer.sync();
    expect(layer.visibleCount()).toBe(2);

    const faces = container.querySelectorAll('[data-testid="suite-graph-face"]');
    expect(faces).toHaveLength(2);
    const first = faces[0] as HTMLElement;
    expect(first.style.left).toBe("100px");
    expect(first.style.top).toBe("50px");
    expect(first.style.width).toBe("96px");
    expect(first.textContent).toContain("Concept");
    expect(first.textContent).toContain("4");
    expect(first.querySelector('[data-testid="suite-graph-face__glyph"]')?.textContent).toBe("◆");

    // One node leaves: its element is destroyed, not hidden.
    nodes.pop();
    layer.sync();
    expect(layer.visibleCount()).toBe(1);
    expect(container.querySelectorAll('[data-testid="suite-graph-face"]')).toHaveLength(1);

    layer.dispose();
    expect(container.querySelector('[data-testid="suite-graph-face-layer"]')).toBeNull();
  });

  it("should draw the depth stack behind the face and drop it when the node surfaces", () => {
    const nodes = [node({ depth: 2 })];
    const { container, layer } = mount(nodes);
    layer.sync();
    expect(container.querySelectorAll('[data-testid="suite-graph-face__plate"]')).toHaveLength(2);

    nodes[0] = node({ depth: 0 });
    layer.sync();
    expect(container.querySelectorAll('[data-testid="suite-graph-face__plate"]')).toHaveLength(2);
    for (const plate of container.querySelectorAll('[data-testid="suite-graph-face__plate"]')) {
      expect((plate as HTMLElement).style.display).toBe("none");
    }
    layer.dispose();
  });

  it("should mark the two faces differently and keep a container title in the frame", () => {
    const nodes = [
      node({ id: "container:1", kind: "container", label: "", glyph: "", count: 9 }),
      node({ id: "container:2", kind: "container", label: "Reading", glyph: "", count: 1 }),
    ];
    const { container, layer } = mount(nodes);
    layer.sync();
    const faces = container.querySelectorAll<HTMLElement>('[data-testid="suite-graph-face"]');
    expect(faces[0]?.dataset.kind).toBe("container");
    // An empty title is the unfiled bucket by the time it reaches the layer.
    expect(faces[0]?.textContent).toContain("9");
    expect(faces[1]?.textContent).toContain("Reading");
    expect(faces[1]?.title).toBe("Reading — 1 card");
    expect(faces[0]?.title).toBe("9 cards");
    layer.dispose();
  });

  it("should hide a face whose camera is dead rather than draw it at zero", () => {
    const { layer, current } = mount([node()]);
    layer.sync();
    expect(layer.visibleCount()).toBe(1);
    current.camera = { x: 0, y: 0, zoom: 0 };
    layer.sync();
    expect(layer.visibleCount()).toBe(0);
    layer.dispose();
  });

  it("should keep a swatch name as a token and refuse arbitrary CSS", () => {
    const nodes = [node({ color: "rose" })];
    const { container, layer } = mount(nodes);
    layer.sync();
    const face = container.querySelector<HTMLElement>('[data-testid="suite-graph-face"]');
    expect(face?.style.getPropertyValue("--suite-graph-accent")).toContain("--section-rose");
    expect(face?.dataset.color).toBe("rose");

    nodes[0] = node({ color: "url(javascript:alert(1))" });
    layer.sync();
    expect(face?.style.getPropertyValue("--suite-graph-accent")).not.toContain("javascript");
    expect(face?.style.getPropertyValue("--suite-graph-accent")).toContain("--accent");
    layer.dispose();
  });

  it("should place a face with the depth offset from the shared helper", () => {
    const nodes = [node({ depth: 2 })];
    const { container, layer } = mount(nodes);
    layer.sync();
    const face = container.querySelector<HTMLElement>('[data-testid="suite-graph-face"]');
    const offset = graphDepthOffset(2);
    // The chip is clamped to 64 × 34 at this zoom, and the face is the scaled,
    // offset plate of level 2.
    const width = SUITE_GRAPH_FACE_BOUNDS.type.minWidth * offset.scale;
    const height = SUITE_GRAPH_FACE_BOUNDS.type.minHeight * offset.scale;
    expect(face?.style.width).toBe(`${width}px`);
    expect(face?.style.height).toBe(`${height}px`);
    expect(face?.style.left).toBe(`${(100 + 48) * 0.1 - width / 2 + offset.dx}px`);
    layer.dispose();
  });
});
