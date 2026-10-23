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
import {
  SUITE_CONTAINER_NODE_BACKING_ALPHA,
  SUITE_CONTAINER_NODE_DEFAULTS,
  SUITE_CONTAINER_NODE_FACE,
  SUITE_CONTAINER_NODE_INTERACTION,
  SUITE_CONTAINER_NODE_KIND,
  SUITE_CONTAINER_NODE_LAYER_Z,
  SUITE_CONTAINER_NODE_SIZE,
  SUITE_CONTAINER_NODE_TYPE,
  SUITE_CONTAINER_NODE_UNFILED,
  SuiteContainerNode,
  type SuiteContainerNodeFace,
  suiteContainerNodeSpawn,
} from "./suiteContainerNodeKind";
import { graphNodeBacking } from "./suiteGraphFace";
import { SUITE_TYPE_NODE_LAYER_Z } from "./suiteTypeNodeKind";

/**
 * The frame's declared surface, without a desk: the props a projection writes,
 * the flags it declares and the backing rule the reused paper program is put
 * under.
 */
describe("suite.containerNode kind", () => {
  it("should expose the same type and kind name", () => {
    expect(SuiteContainerNode.type).toBe(SUITE_CONTAINER_NODE_TYPE);
    // The ground registers the paper program under this name, so they agree.
    expect(SUITE_CONTAINER_NODE_KIND).toBe(SUITE_CONTAINER_NODE_TYPE);
  });

  it("should carry the frame's whole face on the frame group", () => {
    expect(SuiteContainerNode.propToGroup).toMatchObject({
      containerKey: "frame",
      label: "frame",
      count: "frame",
      depth: "frame",
      color: "frame",
    });
    expect(SuiteContainerNode.groups.find((group) => group.name === "frame")).toBeDefined();
    expect(SUITE_CONTAINER_NODE_FACE).toBeDefined();
  });

  it("should be display-only: no document coordinates on the kind at all", () => {
    for (const prop of ["sectionId", "boardId", "cardId", "pinId"]) {
      expect(SuiteContainerNode.propToGroup[prop]).toBeUndefined();
    }
    expect(SuiteContainerNode.defaultSize).toEqual(SUITE_CONTAINER_NODE_SIZE);
  });

  it("should be pickable but never moved, resized, snapped or dropped", () => {
    expect(SUITE_CONTAINER_NODE_INTERACTION).toEqual({
      selectable: true,
      movable: false,
      resizable: false,
      snap: "none",
      drop: "never",
    });
  });

  it("should draw below the type nodes it holds", () => {
    expect(SUITE_CONTAINER_NODE_LAYER_Z).toBeLessThan(SUITE_TYPE_NODE_LAYER_Z);
  });

  it("should hold the reused sheet near zero presence and square to the desk", () => {
    expect(SUITE_CONTAINER_NODE_BACKING_ALPHA).toBeGreaterThan(0);
    expect(SUITE_CONTAINER_NODE_BACKING_ALPHA).toBeLessThanOrEqual(0.05);
    const backing = graphNodeBacking(
      { angle: 0.04, cos: 0.999, sin: 0.04, alpha: 1 },
      SUITE_CONTAINER_NODE_BACKING_ALPHA,
    );
    expect(backing.alpha).toBe(SUITE_CONTAINER_NODE_BACKING_ALPHA);
    expect(backing.angle).toBe(0);
    expect(backing.cos).toBe(1);
    expect(backing.sin).toBe(0);
  });

  it("should be a desk object that mounts its screen-space face", () => {
    expect(objectKindOf(SuiteContainerNode)?.name).toBe(SUITE_CONTAINER_NODE_KIND);
    expect(SuiteContainerNode.provides).toContain(DESK_OBJECT);
    // A frame is not a container object: its members are a projection, not
    // children in a mat.
    expect(SuiteContainerNode.provides).not.toContain(CONTAINABLE);
    expect(typeof driversOf(SuiteContainerNode)).toBe("function");
    expect(typeof hostOf(SuiteContainerNode)?.mount).toBe("function");
  });

  it("should mount its frame layer and name an empty title Unfiled", () => {
    const container = document.createElement("div");
    const face: SuiteContainerNodeFace = {
      containerKey: "container:__loose__:board-1",
      label: "",
      count: 3,
      depth: 0,
      color: "",
    };
    const components = new Map<unknown, unknown>([
      [PrefabId, { id: SUITE_CONTAINER_NODE_TYPE }],
      [Position, { x: 0, y: 0 }],
      [Size, { w: 400, h: 300 }],
      [SUITE_CONTAINER_NODE_FACE, face],
    ]);
    const world = {
      entities: () => [7],
      isAlive: () => true,
      has: (_entity: unknown, component: unknown) => components.has(component),
      read: (_entity: unknown, component: unknown) => components.get(component),
      getResource: () => ({ x: 0, y: 0, zoom: 0.5 }),
    } as unknown as World;
    const mount = hostOf(SuiteContainerNode)?.mount;
    expect(mount).toBeDefined();
    mount?.({ container, world } as unknown as ObjectDomHost);

    const painted = container.querySelector<HTMLElement>('[data-testid="suite-graph-face"]');
    expect(painted?.dataset.kind).toBe("container");
    expect(painted?.textContent).toContain(SUITE_CONTAINER_NODE_UNFILED);
    expect(painted?.textContent).toContain("3");
    expect(painted?.style.width).toBe("200px");
  });

  it("should spawn from a graph container with its own rect as the footprint", () => {
    const spawn = suiteContainerNodeSpawn({
      key: "container:c1",
      label: "Reading room",
      count: 12,
      x: 40,
      y: 30,
      width: 520,
      height: 360,
      depth: 1,
      color: "sage",
    });
    expect(spawn).toEqual({
      type: "suite.containerNode",
      x: 40,
      y: 30,
      w: 520,
      h: 360,
      props: {
        containerKey: "container:c1",
        label: "Reading room",
        count: 12,
        depth: 1,
        color: "sage",
      },
    });
    expect(Object.keys(spawn.props).sort()).toEqual(
      Object.keys(SUITE_CONTAINER_NODE_DEFAULTS).sort(),
    );
  });

  it("should name the bucket no section holds Unfiled", () => {
    const loose = suiteContainerNodeSpawn({
      key: "container:__loose__:board-1",
      label: "",
      count: 3,
      x: 0,
      y: 0,
      width: 72,
      height: 52,
      depth: 0,
    });
    expect(loose.props.label).toBe(SUITE_CONTAINER_NODE_UNFILED);
    expect(SUITE_CONTAINER_NODE_UNFILED).toBe("Unfiled");
    expect(loose.props.color).toBe(SUITE_CONTAINER_NODE_DEFAULTS.color);
  });
});
