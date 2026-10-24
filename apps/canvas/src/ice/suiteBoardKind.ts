/**
 * `suite.board` — a Board's own face at every zoom (ADR-0039, ADR-0036 §5).
 *
 * A Board is a container: a titled, coloured frame that holds cards and other
 * Boards, with its rect expressed in its parent's frame. Up to now that frame
 * was ICE's borrowed `desk.minimat`, which prints its name only past ~5× zoom and
 * sells three vinyls (`sage`, `slate`, `charcoal`) — neither can carry a Board's
 * identity, and the projection's colour map was a workaround, not a design.
 *
 * GPU backing — `minimatKind()` reused under this kind's own name. It is a plain
 * `ObjectKind` that reads only `props.vinyl` and `props.name` (through
 * `stringProp`) and its colours through `theme()`, so no ICE internals are
 * needed: the sheet, the die-cut edge, the slab's shadow and its container face
 * (what a live inside is built through) all come for free, and `hit` is the
 * mat's own SDF, so the Board is pickable on exactly its rect. The vinyl is the
 * nearest of the three the program knows; the Board's actual colour is the DOM
 * face's, which is the only half that can draw six.
 *
 * Visible face — the screen-space layer in `suiteBoardFace.ts`: the name above
 * the mat's top edge (a container's identity outranks its contents at distance),
 * the colour as a stripe and a border, the depth stack behind the mat and chips
 * for child Boards when there is room. It draws *above* the card overlay, because
 * the one thing that must never be hidden by a Board's contents is the Board.
 *
 * Known gap, shared with `suite.typeNode`/`suite.containerNode`: a Board drawn
 * deeper than the surface has its face offset up-left of its footprint (the 2.5D
 * stack) while ICE picks the footprint's own rect. See `suiteTypeNodeKind.ts`.
 *
 * Nothing here writes: a Board's move is a document write the surface owns, so
 * the props are display-only and the kind holds no document coordinate it is
 * allowed to mutate.
 */

import { boardColors } from "@suite/graph";
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
import type { KindLocal } from "@vibecook/ice/desk";
import { CONTAINABLE, DESK_OBJECT, defineObject, type KindDriver } from "@vibecook/ice/desk";
import { MINIMAT, minimatKind, SAGE, VINYLS, type VinylName } from "@vibecook/ice/desk/objects";
import {
  createSuiteBoardFaceLayer,
  type SuiteBoardColor,
  type SuiteBoardFaceLayerHandle,
  type SuiteBoardFaceNode,
} from "./suiteBoardFace";

/**
 * The per-desk tick hook the face rides. ICE ticks a kind's `local` before it
 * builds a frame, so the DOM face is synced from the engine's own loop rather
 * than a private `requestAnimationFrame` — and `due()` keeps the desk asleep
 * when nothing is moving.
 */
interface SuiteBoardLocal extends KindLocal {
  setSink(sink: (() => void) | undefined): void;
}

function createSuiteBoardLocal(base: KindLocal | undefined): SuiteBoardLocal {
  let sink: (() => void) | undefined;
  return {
    ...base,
    setSink: (next) => {
      sink = next;
    },
    tick: (now) => {
      const wants = base?.tick?.(now) ?? false;
      sink?.();
      return wants;
    },
    due: (now) => base?.due?.(now) ?? Number.POSITIVE_INFINITY,
    dispose: () => {
      base?.dispose?.();
      sink = undefined;
    },
  };
}

/** The object type and its kind share the name; both are unique on this desk. */
export const SUITE_BOARD_TYPE = "suite.board";
export const SUITE_BOARD_KIND = "suite.board";

/** A new Board's footprint — the mini mat's own 640 × 480, the surface it replaces. */
export const SUITE_BOARD_SIZE = { w: MINIMAT.size.w, h: MINIMAT.size.h } as const;

/** The Board face draws above the card overlay (2) and level with pins (3). */
export const SUITE_BOARD_LAYER_Z = 3;

/** The name a Board takes when the document has none (`minimatFrom`'s fallback). */
/**
 * The vinyls ICE sells, named here as a runtime list: `/desk/objects` exports the
 * enum only as a type-level const, so the values a spawn may pass are stated
 * once, in one place, and checked against `VinylName` for drift.
 */
export const SUITE_BOARD_VINYLS = [
  "sage",
  "slate",
  "charcoal",
] as const satisfies readonly VinylName[];

export const SUITE_BOARD_DEFAULTS = {
  boardId: "",
  name: "Board",
  depth: 0,
  color: "slate" as SuiteBoardColor,
  cardCount: 0,
  childCount: 0,
  collapsed: false,
  vinyl: SAGE as VinylName,
} as const;

/**
 * Selectable and movable — a Board's move is a document write the surface makes,
 * never a projection fact — never resized yet, snapped on both sides, and
 * containable ("into" is ICE's name for "may be dropped inside a container").
 */
export const SUITE_BOARD_INTERACTION = {
  selectable: true,
  movable: true,
  resizable: false,
  snap: "both",
  drop: "into",
} as const;

/**
 * The three vinyls the reused mat program knows. A Board's palette colour is the
 * DOM face's; this is the material it lies on: cool hues read as the blue-grey
 * mat, green as the desk's own sage, warm ones as the green-black charcoal.
 */
export const SUITE_BOARD_VINYL_BY_COLOR: Readonly<Record<SuiteBoardColor, VinylName>> = {
  slate: "slate",
  blue: "slate",
  violet: "slate",
  green: "sage",
  amber: "charcoal",
  rose: "charcoal",
};

/** The vinyl a Board's colour lies on. An unknown colour is the desk's own mat. */
export function boardVinyl(color: string | undefined): VinylName {
  if (color === undefined) return SAGE;
  if (!Object.hasOwn(SUITE_BOARD_VINYL_BY_COLOR, color)) return SAGE;
  return SUITE_BOARD_VINYL_BY_COLOR[color as SuiteBoardColor];
}

/** Every widget carries `PrefabId`; the face filters it by our type id. */
const WIDGETS = defineQuery([PrefabId]);

/** The paper—the mat—program's geometry (the type is not re-exported as a name). */
type MiniMatKindOf = ReturnType<typeof minimatKind>;

/** What the kind carries about a Board (its `board` group, read as `faceOf`). */
export type SuiteBoardFace = {
  readonly boardId: string;
  readonly name: string;
  readonly depth: number;
  readonly color: SuiteBoardColor;
  readonly cardCount: number;
  readonly childCount: number;
  readonly collapsed: boolean;
};

/** What the projection hands `suiteBoardSpawn`, in the Board's own frame. */
export interface SuiteBoardSpawnInput {
  readonly boardId: string;
  readonly name: string;
  readonly depth: number;
  readonly color: SuiteBoardColor;
  readonly cardCount: number;
  readonly childCount: number;
  readonly collapsed?: boolean | undefined;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What `spawnWidget` takes for one Board, with our type and vinyl filled in. */
export interface SuiteBoardSpawn {
  readonly type: typeof SUITE_BOARD_TYPE;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly props: SuiteBoardFace & { readonly vinyl: VinylName };
}

/**
 * The spawn a Board becomes. The rect is already in the parent's frame (ADR-0039
 * §1), which is exactly what an ICE frame-local child takes, so no scaling or
 * translation is invented here.
 */
export function suiteBoardSpawn(input: SuiteBoardSpawnInput): SuiteBoardSpawn {
  const name = input.name.trim();
  return {
    type: SUITE_BOARD_TYPE,
    x: input.x,
    y: input.y,
    w: input.width,
    h: input.height,
    props: {
      boardId: input.boardId,
      name: name.length > 0 ? name : SUITE_BOARD_DEFAULTS.name,
      depth: input.depth,
      color: input.color,
      cardCount: input.cardCount,
      childCount: input.childCount,
      collapsed: input.collapsed === true,
      vinyl: boardVinyl(input.color),
    },
  };
}

/** What the kind's DOM half needs of the driver: a place to hang its `sync`. */
interface SuiteBoardDriver extends KindDriver {
  attach(layer: SuiteBoardFaceLayerHandle): void;
}

const minimat = minimatKind();

const suiteBoardKind: MiniMatKindOf = {
  ...minimat,
  // The ground compiles one pass per kind name, so the mat's program runs beside
  // the mini mat's own — the same trick `suite.card` plays with the paper.
  name: SUITE_BOARD_KIND,
  local: () => createSuiteBoardLocal(undefined),
  record(geometry, ctx) {
    const record = minimat.record(geometry, ctx);
    // The face owns the name (above the mat's edge, at every zoom), so the mat
    // must not print a second copy in its border foot.
    return { ...record, name: undefined };
  },
};

export const SuiteBoard = defineObject({
  type: SUITE_BOARD_TYPE,
  version: 1,
  props: {
    // The Board this mat is a face of. Display-only: the document owns the truth.
    boardId: p.string({ default: SUITE_BOARD_DEFAULTS.boardId }),
    name: p.string({ default: SUITE_BOARD_DEFAULTS.name }),
    // Nesting below the root plane; the face stacks one plate per level.
    depth: p.number({ default: SUITE_BOARD_DEFAULTS.depth }),
    color: p.enum(boardColors, { default: SUITE_BOARD_DEFAULTS.color }),
    // How many cards the Board holds, and how many Boards sit inside it.
    cardCount: p.number({ default: SUITE_BOARD_DEFAULTS.cardCount }),
    childCount: p.number({ default: SUITE_BOARD_DEFAULTS.childCount }),
    collapsed: p.boolean({ default: SUITE_BOARD_DEFAULTS.collapsed }),
    // Read by the reused mat program for its (visible) vinyl.
    vinyl: p.enum(VINYLS, { default: SUITE_BOARD_DEFAULTS.vinyl }),
  },
  groups: {
    board: ["boardId", "name", "depth", "color", "cardCount", "childCount", "collapsed"],
  },
  size: SUITE_BOARD_SIZE,
  kind: suiteBoardKind,
  interaction: SUITE_BOARD_INTERACTION,
  provides: [DESK_OBJECT],
  // A Board is a container (ADR-0039): it holds what provides `CONTAINABLE` — a
  // note, a card, another Board — and lies inside one by what it provides itself.
  container: {
    accepts: [CONTAINABLE],
    provides: [SUITE_BOARD_TYPE, DESK_OBJECT, CONTAINABLE],
    portal: {
      top: MINIMAT.margin,
      right: MINIMAT.margin,
      bottom: MINIMAT.margin,
      left: MINIMAT.margin,
    },
  },
  drivers: (host) => {
    const local = host.local as SuiteBoardLocal | undefined;
    let attached: SuiteBoardFaceLayerHandle | undefined;
    const driver: SuiteBoardDriver = {
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
      const layer = createSuiteBoardFaceLayer({
        container: host.container,
        nodes: () => boardFaces(host.world),
        camera: () => host.world.getResource(Camera),
        zIndex: SUITE_BOARD_LAYER_Z,
      });
      layer.sync();
      (host.driver as SuiteBoardDriver | undefined)?.attach(layer);
    },
  },
});

/** The `board` group's component — the face read without a registry lookup. */
export const SUITE_BOARD_FACE = groupOf("board") as Component<SuiteBoardFace>;

function groupOf(name: string): Component {
  const group = SuiteBoard.groups.find((candidate) => candidate.name === name);
  if (group === undefined) throw new Error(`suite.board: no "${name}" group`);
  return group.component;
}

function boardEntities(world: World): Entity[] {
  return world.entities(WIDGETS).filter((entity) => {
    if (!world.isAlive(entity)) return false;
    return world.read(entity, PrefabId)?.id === SUITE_BOARD_TYPE;
  });
}

/** The screen-space faces for every live Board — position/size + the group. */
function boardFaces(world: World): SuiteBoardFaceNode[] {
  const nodes: SuiteBoardFaceNode[] = [];
  for (const entity of boardEntities(world)) {
    const position = world.read(entity, Position);
    const size = world.read(entity, Size);
    const face = faceOf(world, entity);
    if (position === undefined || size === undefined || face === undefined) continue;
    nodes.push({
      id: `board:${entity as unknown as number}`,
      rect: { x: position.x, y: position.y, width: size.w, height: size.h },
      depth: face.depth,
      name: face.name,
      color: face.color,
      cardCount: face.cardCount,
      childCount: face.childCount,
      collapsed: face.collapsed,
    });
  }
  return nodes;
}

function faceOf(world: World, entity: Entity): SuiteBoardFace | undefined {
  if (!world.isAlive(entity) || !world.has(entity, SUITE_BOARD_FACE)) return undefined;
  const face = world.read(entity, SUITE_BOARD_FACE);
  return {
    boardId: face.boardId,
    name: face.name,
    depth: face.depth,
    color: face.color,
    cardCount: face.cardCount,
    childCount: face.childCount,
    collapsed: face.collapsed,
  };
}
