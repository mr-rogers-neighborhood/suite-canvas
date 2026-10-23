/**
 * `suite.containerNode` — the frame a cluster of type nodes sits in (ADR-0036
 * §5, ADR-0037). Display-only, like `suite.typeNode`: the frame is a projection
 * of the section that holds the cards, not a section object, and nothing here
 * writes.
 *
 * GPU backing — the same reused paper program as every graph kind
 * (`paperKind()`), square to the desk and held at near-zero presence, so the
 * frame is pickable on exactly its rect and no sheet shows through it.
 *
 * Visible face — the screen-space layer in `suiteGraphFace.ts`, in its `frame`
 * form: a bordered rect with the container's title (or "Unfiled") and its total
 * count, drawn in CSS pixels so both stay legible at graph zoom, with the
 * section's derived depth stacked behind it. This layer sits *below* the type
 * nodes' (`SUITE_CONTAINER_NODE_LAYER_Z`), so a cluster's chips read on top of
 * the frame that holds them.
 *
 * Interaction: readable and pickable, never moved or resized — a frame's rect is
 * the union of its members' own positions, so dragging it would promise a write
 * the projection cannot make. `snap: "none"`: a face that never moves takes no
 * guides.
 *
 * Known gap, shared with `suite.typeNode`: a frame drawn deeper than the surface
 * has its face offset up-left of its footprint (the 2.5D stack) while ICE picks
 * the footprint's own rect; see the note in `suiteTypeNodeKind.ts`.
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
export const SUITE_CONTAINER_NODE_TYPE = "suite.containerNode";
export const SUITE_CONTAINER_NODE_KIND = "suite.containerNode";

/** A frame's spawn footprint — a section's smallest readable frame (`typeGraph.ts`). */
export const SUITE_CONTAINER_NODE_SIZE = { w: 360, h: 240 } as const;

/**
 * The reused sheet is a footprint, not paper: its presence is held this close to
 * zero so the note's sheet, ink and shadow stay invisible behind the frame.
 */
export const SUITE_CONTAINER_NODE_BACKING_ALPHA = 0.02;

/** The frame draws below the type nodes it holds. */
export const SUITE_CONTAINER_NODE_LAYER_Z = 1;

/** The label of the bucket that holds cards no section does (`LOOSE_CONTAINER_LABEL`). */
export const SUITE_CONTAINER_NODE_UNFILED = "Unfiled";

/** Props carry the frame's whole face, so the kind can be spawned without a lookup. */
export const SUITE_CONTAINER_NODE_DEFAULTS = {
  containerKey: "",
  label: SUITE_CONTAINER_NODE_UNFILED,
  count: 0,
  depth: 0,
  color: "",
} as const;

/**
 * Readable and pickable; never moved, never resized, never dropped into a
 * container (a frame is not a card).
 */
export const SUITE_CONTAINER_NODE_INTERACTION = {
  selectable: true,
  movable: false,
  resizable: false,
  snap: "none",
  drop: "never",
} as const;

/** Every widget carries `PrefabId`; the face filters it by our type id. */
const WIDGETS = defineQuery([PrefabId]);

/** What the kind carries about the frame (its `frame` group, read as `faceOf`). */
export interface SuiteContainerNodeFace {
  readonly containerKey: string;
  readonly label: string;
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

/** The subset of a `TypeGraphNode` a container frame is spawned from. */
export interface SuiteContainerNodeInput {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly color?: string | undefined;
}

/** What `spawnWidget` takes for one container frame, with our type filled in. */
export interface SuiteContainerNodeSpawn {
  readonly type: typeof SUITE_CONTAINER_NODE_TYPE;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly props: SuiteContainerNodeFace;
}

/**
 * The spawn a type-graph container becomes. An empty title is the unfiled
 * bucket — the frame never draws a border with nothing to name it.
 */
export function suiteContainerNodeSpawn(node: SuiteContainerNodeInput): SuiteContainerNodeSpawn {
  return {
    type: SUITE_CONTAINER_NODE_TYPE,
    x: node.x,
    y: node.y,
    w: node.width,
    h: node.height,
    props: {
      containerKey: node.key,
      label: node.label.length > 0 ? node.label : SUITE_CONTAINER_NODE_UNFILED,
      count: node.count,
      depth: node.depth,
      color: node.color ?? "",
    },
  };
}

const paper = paperKind();

const suiteContainerNodeKind: PaperKindOf = {
  ...paper,
  name: SUITE_CONTAINER_NODE_KIND,
  resolve(ctx) {
    return graphNodeBacking(paper.resolve(ctx), SUITE_CONTAINER_NODE_BACKING_ALPHA);
  },
  local: (host) => createSuiteGraphFaceLocal(paper.local?.(host)),
};

export const SuiteContainerNode = defineObject({
  type: SUITE_CONTAINER_NODE_TYPE,
  version: 1,
  props: {
    // The container's graph key (`container:<id>` / `container:__loose__:<board>`).
    containerKey: p.string({ default: SUITE_CONTAINER_NODE_DEFAULTS.containerKey }),
    // The section's title, or "Unfiled" for the bucket no section holds.
    label: p.string({ default: SUITE_CONTAINER_NODE_DEFAULTS.label }),
    // Every card inside the frame, not just the ones a type chip counts.
    count: p.number({ default: SUITE_CONTAINER_NODE_DEFAULTS.count }),
    depth: p.number({ default: SUITE_CONTAINER_NODE_DEFAULTS.depth }),
    color: p.string({ default: SUITE_CONTAINER_NODE_DEFAULTS.color }),
    // Read by the reused paper kind for its (invisible) sheet and ink.
    paper: p.enum(["yellow"] as const, { default: "yellow" }),
    pen: p.enum(PENS, { default: "fountain" }),
    seed: p.number({ default: 0 }),
  },
  groups: { frame: ["containerKey", "label", "count", "depth", "color"] },
  size: SUITE_CONTAINER_NODE_SIZE,
  kind: suiteContainerNodeKind,
  interaction: SUITE_CONTAINER_NODE_INTERACTION,
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
        nodes: () => containerNodeFaces(host.world),
        camera: () => host.world.getResource(Camera),
        zIndex: SUITE_CONTAINER_NODE_LAYER_Z,
      });
      layer.sync();
      (host.driver as SuiteGraphDriver | undefined)?.attach(layer);
    },
  },
});

/** The `frame` group's component — the face read without a second registry. */
export const SUITE_CONTAINER_NODE_FACE = groupOf("frame") as Component<SuiteContainerNodeFace>;

function groupOf(name: string): Component {
  const group = SuiteContainerNode.groups.find((candidate) => candidate.name === name);
  if (group === undefined) throw new Error(`suite.containerNode: no "${name}" group`);
  return group.component;
}

function containerNodeEntities(world: World): Entity[] {
  return world.entities(WIDGETS).filter((entity) => {
    if (!world.isAlive(entity)) return false;
    return world.read(entity, PrefabId)?.id === SUITE_CONTAINER_NODE_TYPE;
  });
}

/** The screen-space frames for every live container — position/size + the group. */
function containerNodeFaces(world: World): SuiteGraphFaceNode[] {
  const nodes: SuiteGraphFaceNode[] = [];
  for (const entity of containerNodeEntities(world)) {
    const position = world.read(entity, Position);
    const size = world.read(entity, Size);
    const face = faceOf(world, entity);
    if (position === undefined || size === undefined || face === undefined) continue;
    nodes.push({
      id: `container:${entity as unknown as number}`,
      kind: "container",
      rect: { x: position.x, y: position.y, width: size.w, height: size.h },
      depth: face.depth,
      label: face.label.length > 0 ? face.label : SUITE_CONTAINER_NODE_UNFILED,
      glyph: "",
      count: face.count,
      color: face.color.length === 0 ? undefined : face.color,
    });
  }
  return nodes;
}

function faceOf(world: World, entity: Entity): SuiteContainerNodeFace | undefined {
  if (!world.isAlive(entity) || !world.has(entity, SUITE_CONTAINER_NODE_FACE)) return undefined;
  const face = world.read(entity, SUITE_CONTAINER_NODE_FACE);
  return {
    containerKey: face.containerKey,
    label: face.label,
    count: face.count,
    depth: face.depth,
    color: face.color,
  };
}
