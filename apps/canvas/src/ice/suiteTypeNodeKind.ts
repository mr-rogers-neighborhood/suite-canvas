/**
 * `suite.typeNode` — one cluster of the type graph on the ICE desk (ADR-0036 §5,
 * ADR-0037). Display-only: it is a projection of the board's own layout, never a
 * document object, and nothing here writes.
 *
 * GPU backing — the built-in paper program (`paperKind()`), reused under this
 * kind's own name, exactly as `suite.pin` does. There is no cluster/marker
 * program in `@vibecook/ice/desk/objects`, and the note's program is the smallest
 * one that draws a small, square, pickable body; no WGSL is invented. `resolve`
 * drops the note's seeded tilt and holds its presence at
 * `SUITE_TYPE_NODE_BACKING_ALPHA`, so no sticky sheet, ink or shadow shows
 * behind the face, while `hit` (the program's own SDF) still answers a press on
 * exactly the node's rect.
 *
 * Visible face — the screen-space layer in `suiteGraphFace.ts`: the type's glyph,
 * its name and its count, laid out in CSS pixels so they stay legible at graph
 * zoom, with the derived depth drawn as a stack of plates behind the face. The
 * long form of that choice (why not the paper's text path, and why not a DOM
 * overlay per node) is documented at the top of that module.
 *
 * Interaction: readable and pickable, never moved or resized. A graph node's
 * position *is* the projection of its members' positions, so dragging one would
 * promise a write the graph cannot make; `snap: "none"` keeps the guides out of
 * a face that never moves. A selection is a camera/read action the surface
 * decides on — the kind carries no gesture of its own.
 *
 * Known gap, shared with `suite.containerNode`: a node drawn deeper than the
 * surface has its face offset up-left of its footprint (the 2.5D stack), while
 * ICE picks the footprint's own rect. The two agree at depth 0 and drift by at
 * most `GRAPH_DEPTH_STEP_PX × GRAPH_DEPTH_MAX` (30 px) at the deepest level; a
 * surface that wants them to coincide can spawn the object at the offset rect,
 * or this kind can grow a `hit` that covers the stack once a gesture needs it.
 */

import {
  Camera,
  type Component,
  defineQuery,
  type Entity,
  Position,
  PrefabId,
  p,
  Size,
  type World,
} from "@vibecook/ice";
import { DESK_OBJECT, defineObject, type KindDriver } from "@vibecook/ice/desk";
import { PENS, paperKind } from "@vibecook/ice/desk/objects";
import {
  createSuiteGraphFaceLayer,
  createSuiteGraphFaceLocal,
  graphNodeBacking,
  type SuiteGraphFaceLayerHandle,
  type SuiteGraphFaceLocal,
  type SuiteGraphFaceNode,
} from "./suiteGraphFace";

/** The object type and its kind share the name; both are unique on this desk. */
export const SUITE_TYPE_NODE_TYPE = "suite.typeNode";
export const SUITE_TYPE_NODE_KIND = "suite.typeNode";

/** A type node's world footprint — the graph's own cell (`typeGraph.ts` `CELL`). */
export const SUITE_TYPE_NODE_SIZE = { w: 96, h: 64 } as const;

/**
 * The reused sheet is a footprint, not paper: its presence is held this close to
 * zero so the note's sheet, ink and shadow stay invisible behind the face.
 */
export const SUITE_TYPE_NODE_BACKING_ALPHA = 0.02;

/** The face's stacking order among the desk's screen-space halves. */
export const SUITE_TYPE_NODE_LAYER_Z = 2;

/** Props carry the node's whole face, so the kind can be spawned without a lookup. */
export const SUITE_TYPE_NODE_DEFAULTS = {
  nodeKey: "",
  label: "",
  glyph: "",
  count: 0,
  depth: 0,
  color: "",
} as const;

/**
 * Readable and pickable; never moved, never resized, never dropped into a
 * container (a graph node belongs to the projection, not to a mat).
 */
export const SUITE_TYPE_NODE_INTERACTION = {
  selectable: true,
  movable: false,
  resizable: false,
  snap: "none",
  drop: "never",
} as const;

/** Every widget carries `PrefabId`; the face filters it by our type id. */
const WIDGETS = defineQuery([PrefabId]);

/** What the kind carries about the node (its `node` group, read as `faceOf`). */
export interface SuiteTypeNodeFace {
  readonly nodeKey: string;
  readonly label: string;
  readonly glyph: string;
  readonly count: number;
  readonly depth: number;
  readonly color: string;
}

/** The paper program's geometry (the type is not re-exported by the objects package). */
type PaperKindOf = ReturnType<typeof paperKind>;

/** What the DOM half needs of the kind's driver: a place to hang the face's sync. */
interface SuiteGraphDriver extends KindDriver {
  attach(layer: SuiteGraphFaceLayerHandle): void;
}

/** The subset of a `TypeGraphNode` a type node is spawned from. */
export interface SuiteTypeNodeInput {
  readonly key: string;
  readonly label: string;
  readonly glyph: string;
  readonly count: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly color?: string | undefined;
}

/** What `spawnWidget` takes for one type node, with our type filled in. */
export interface SuiteTypeNodeSpawn {
  readonly type: typeof SUITE_TYPE_NODE_TYPE;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly props: SuiteTypeNodeFace;
}

/**
 * The spawn a type-graph node becomes. Pure, so the surface's projection can be
 * asserted without a desk: the node's own rect is the footprint (ICE picks it),
 * and its face is the props.
 */
export function suiteTypeNodeSpawn(node: SuiteTypeNodeInput): SuiteTypeNodeSpawn {
  return {
    type: SUITE_TYPE_NODE_TYPE,
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
  };
}

const paper = paperKind();

const suiteTypeNodeKind: PaperKindOf = {
  ...paper,
  name: SUITE_TYPE_NODE_KIND,
  resolve(ctx) {
    return graphNodeBacking(paper.resolve(ctx), SUITE_TYPE_NODE_BACKING_ALPHA);
  },
  local: (host) => createSuiteGraphFaceLocal(paper.local?.(host)),
};

export const SuiteTypeNode = defineObject({
  type: SUITE_TYPE_NODE_TYPE,
  version: 1,
  props: {
    // The graph node's stable key (`container:<id>` / `type:<container>:<type>`).
    // Display only: the surface reconciles its own projection against it.
    nodeKey: p.string({ default: SUITE_TYPE_NODE_DEFAULTS.nodeKey }),
    label: p.string({ default: SUITE_TYPE_NODE_DEFAULTS.label }),
    glyph: p.string({ default: SUITE_TYPE_NODE_DEFAULTS.glyph }),
    count: p.number({ default: SUITE_TYPE_NODE_DEFAULTS.count }),
    // Derived nesting (`TypeGraphNode.depth`) — the plate the stack is drawn at.
    depth: p.number({ default: SUITE_TYPE_NODE_DEFAULTS.depth }),
    // A section swatch name; empty falls back to the shell accent.
    color: p.string({ default: SUITE_TYPE_NODE_DEFAULTS.color }),
    // Read by the reused paper kind for its (invisible) sheet and ink.
    paper: p.enum(["yellow"] as const, { default: "yellow" }),
    pen: p.enum(PENS, { default: "fountain" }),
    seed: p.number({ default: 0 }),
  },
  groups: { node: ["nodeKey", "label", "glyph", "count", "depth", "color"] },
  size: SUITE_TYPE_NODE_SIZE,
  kind: suiteTypeNodeKind,
  interaction: SUITE_TYPE_NODE_INTERACTION,
  provides: [DESK_OBJECT],
  drivers: (host) => {
    const local = host.local as SuiteGraphFaceLocal | undefined;
    let attached: SuiteGraphFaceLayerHandle | undefined;
    const driver: SuiteGraphDriver = {
      follow: () => {},
      idle: () => true,
      attach: (layer) => {
        attached = layer;
        local?.setSink(layer.sync);
        layer.sync();
      },
      dispose: () => {
        local?.setSink(undefined);
        attached?.dispose();
        attached = undefined;
      },
    };
    return driver;
  },
  host: {
    mount: (host) => {
      const layer = createSuiteGraphFaceLayer({
        container: host.container,
        nodes: () => typeNodeFaces(host.world),
        camera: () => host.world.getResource(Camera),
        zIndex: SUITE_TYPE_NODE_LAYER_Z,
      });
      layer.sync();
      (host.driver as SuiteGraphDriver | undefined)?.attach(layer);
    },
  },
});

/** The `node` group's component — the face read without a second registry. */
export const SUITE_TYPE_NODE_FACE = groupOf("node") as Component<SuiteTypeNodeFace>;

function groupOf(name: string): Component {
  const group = SuiteTypeNode.groups.find((candidate) => candidate.name === name);
  if (group === undefined) throw new Error(`suite.typeNode: no "${name}" group`);
  return group.component;
}

function suiteTypeNodeEntities(world: World): Entity[] {
  return world.entities(WIDGETS).filter((entity) => {
    if (!world.isAlive(entity)) return false;
    return world.read(entity, PrefabId)?.id === SUITE_TYPE_NODE_TYPE;
  });
}

/** The screen-space faces for every live type node — position/size + the group. */
function typeNodeFaces(world: World): SuiteGraphFaceNode[] {
  const nodes: SuiteGraphFaceNode[] = [];
  for (const entity of suiteTypeNodeEntities(world)) {
    const position = world.read(entity, Position);
    const size = world.read(entity, Size);
    const face = faceOf(world, entity);
    if (position === undefined || size === undefined || face === undefined) continue;
    nodes.push({
      id: `type:${entity as unknown as number}`,
      kind: "type",
      rect: { x: position.x, y: position.y, width: size.w, height: size.h },
      depth: face.depth,
      label: face.label,
      glyph: face.glyph,
      count: face.count,
      color: face.color.length === 0 ? undefined : face.color,
    });
  }
  return nodes;
}

function faceOf(world: World, entity: Entity): SuiteTypeNodeFace | undefined {
  if (!world.isAlive(entity) || !world.has(entity, SUITE_TYPE_NODE_FACE)) return undefined;
  const face = world.read(entity, SUITE_TYPE_NODE_FACE);
  return {
    nodeKey: face.nodeKey,
    label: face.label,
    glyph: face.glyph,
    count: face.count,
    depth: face.depth,
    color: face.color,
  };
}
