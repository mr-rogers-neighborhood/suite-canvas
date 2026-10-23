import { Position, PrefabId, Size, type World } from "@vibecook/ice";
import {
  CONTAINABLE,
  DESK_OBJECT,
  driversOf,
  hostOf,
  type ObjectDomHost,
  objectKindOf,
} from "@vibecook/ice/desk";
import { describe, expect, it } from "vitest";
import { graphNodeBacking } from "./suiteGraphFace";
import {
  SUITE_TYPE_NODE_BACKING_ALPHA,
  SUITE_TYPE_NODE_DEFAULTS,
  SUITE_TYPE_NODE_FACE,
  SUITE_TYPE_NODE_INTERACTION,
  SUITE_TYPE_NODE_KIND,
  SUITE_TYPE_NODE_SIZE,
  SUITE_TYPE_NODE_TYPE,
  SuiteTypeNode,
  type SuiteTypeNodeFace,
  suiteTypeNodeSpawn,
} from "./suiteTypeNodeKind";

/**
 * The kind's declared surface, without a desk: the props a projection writes,
 * the flags it declares and the backing rule the reused paper program is put
 * under. Anything that changes here changes what the surface's reconcile has to
 * supply for a cluster.
 */
describe("suite.typeNode kind", () => {
  it("should expose the same type and kind name", () => {
    expect(SuiteTypeNode.type).toBe(SUITE_TYPE_NODE_TYPE);
    // The ground registers the paper program under this name, so they agree.
    expect(SUITE_TYPE_NODE_KIND).toBe(SUITE_TYPE_NODE_TYPE);
  });

  it("should carry the node's whole face on the node group", () => {
    expect(SuiteTypeNode.propToGroup).toMatchObject({
      nodeKey: "node",
      label: "node",
      glyph: "node",
      count: "node",
      depth: "node",
      color: "node",
    });
    expect(SuiteTypeNode.groups.find((group) => group.name === "node")).toBeDefined();
    expect(SUITE_TYPE_NODE_FACE).toBeDefined();
  });

  it("should be display-only: no document coordinates on the kind at all", () => {
    // A graph node is a projection of the board; there is nothing to write back
    // to, so no prop names a card, a board or a section.
    for (const prop of ["cardId", "boardId", "sectionId", "pinId"]) {
      expect(SuiteTypeNode.propToGroup[prop]).toBeUndefined();
    }
    expect(SuiteTypeNode.defaultSize).toEqual(SUITE_TYPE_NODE_SIZE);
  });

  it("should be pickable but never moved, resized, snapped or dropped", () => {
    expect(SUITE_TYPE_NODE_INTERACTION).toEqual({
      selectable: true,
      movable: false,
      resizable: false,
      snap: "none",
      drop: "never",
    });
  });

  it("should hold the reused sheet near zero presence and square to the desk", () => {
    expect(SUITE_TYPE_NODE_BACKING_ALPHA).toBeGreaterThan(0);
    expect(SUITE_TYPE_NODE_BACKING_ALPHA).toBeLessThanOrEqual(0.05);
    const backing = graphNodeBacking(
      { angle: 0.04, cos: 0.999, sin: 0.04, alpha: 1 },
      SUITE_TYPE_NODE_BACKING_ALPHA,
    );
    expect(backing.alpha).toBe(SUITE_TYPE_NODE_BACKING_ALPHA);
    expect(backing.angle).toBe(0);
    expect(backing.cos).toBe(1);
    expect(backing.sin).toBe(0);
  });

  it("should be a desk object that mounts its screen-space face", () => {
    expect(objectKindOf(SuiteTypeNode)?.name).toBe(SUITE_TYPE_NODE_KIND);
    expect(SuiteTypeNode.provides).toContain(DESK_OBJECT);
    // A graph node is not a mat's child: it belongs to the projection.
    expect(SuiteTypeNode.provides).not.toContain(CONTAINABLE);
    // The driver is what hangs the face's `sync` on the kind's tick, and the
    // host half is what creates the layer: both must be declared.
    expect(typeof driversOf(SuiteTypeNode)).toBe("function");
    expect(typeof hostOf(SuiteTypeNode)?.mount).toBe("function");
  });

  it("should mount its face layer and paint the node it finds in the world", () => {
    const container = document.createElement("div");
    const face: SuiteTypeNodeFace = {
      nodeKey: "type:container:c1:t1",
      label: "Concept",
      glyph: "◆",
      count: 7,
      depth: 0,
      color: "violet",
    };
    const components = new Map<unknown, unknown>([
      [PrefabId, { id: SUITE_TYPE_NODE_TYPE }],
      [Position, { x: 100, y: 50 }],
      [Size, { w: 96, h: 64 }],
      [SUITE_TYPE_NODE_FACE, face],
    ]);
    const world = {
      entities: () => [1],
      isAlive: () => true,
      has: (_entity: unknown, component: unknown) => components.has(component),
      read: (_entity: unknown, component: unknown) => components.get(component),
      getResource: () => ({ x: 0, y: 0, zoom: 0.1 }),
    } as unknown as World;
    const mount = hostOf(SuiteTypeNode)?.mount;
    expect(mount).toBeDefined();
    mount?.({ container, world } as unknown as ObjectDomHost);

    const layer = container.querySelector('[data-testid="suite-graph-face-layer"]');
    expect(layer).not.toBeNull();
    const painted = container.querySelector<HTMLElement>('[data-testid="suite-graph-face"]');
    expect(painted?.textContent).toContain("Concept");
    expect(painted?.textContent).toContain("◆");
    expect(painted?.textContent).toContain("7");
    // The chip is drawn at its legible floor, not at 96 × 0.1 px.
    expect(painted?.style.width).toBe("64px");
  });

  it("should spawn from a graph node with its own rect as the footprint", () => {
    const spawn = suiteTypeNodeSpawn({
      key: "type:container:c1:t1",
      label: "Concept",
      glyph: "◆",
      count: 7,
      x: 120,
      y: 60,
      width: 96,
      height: 64,
      depth: 2,
      color: "violet",
    });
    expect(spawn).toEqual({
      type: "suite.typeNode",
      x: 120,
      y: 60,
      w: 96,
      h: 64,
      props: {
        nodeKey: "type:container:c1:t1",
        label: "Concept",
        glyph: "◆",
        count: 7,
        depth: 2,
        color: "violet",
      },
    });
    // The props' defaults are the same shape, so a bare spawn is a valid node.
    expect(Object.keys(spawn.props).sort()).toEqual(Object.keys(SUITE_TYPE_NODE_DEFAULTS).sort());
  });

  it("should spawn a colourless node with no colour token", () => {
    const spawn = suiteTypeNodeSpawn({
      key: "type:container:c1:t2",
      label: "Actor",
      glyph: "●",
      count: 0,
      x: 0,
      y: 0,
      width: 96,
      height: 64,
      depth: 0,
    });
    expect(spawn.props.color).toBe(SUITE_TYPE_NODE_DEFAULTS.color);
    expect(spawn.props.depth).toBe(0);
  });
});
