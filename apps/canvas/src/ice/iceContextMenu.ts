/**
 * Pick → context-menu mapping for the ICE canvas.
 *
 * The ICE surface owns picks, the camera and the DOM overlay; the shared
 * `buildCanvasMenuItems` owns the entries. This module is only the join between
 * the two:
 *
 * - {@link menuTargetFromPick} turns one raw ICE pick into a {@link MenuTarget}
 *   by looking the entity up in the maps the surface already keeps.
 * - {@link contextMenuStateFor} turns a right-click plus that target into the
 *   `ContextMenuState` the existing `ContextMenu` renders — the same shape the
 *   scene surface opens, so both surfaces share one menu.
 * - {@link menuItemsAvailable} states which menu sections a target can offer, as
 *   data, so a parity test has something to compare against without a second
 *   builder growing here.
 *
 * Three rules hold the mapping together:
 *
 * - **A picked part beats its card.** ICE reports the sub-part under the pointer
 *   in `part`; `connector:<id>` names a card's connector, so the menu opens on
 *   that connector instead of the card.
 * - **The card wins over the section under it.** A section is a backdrop; a
 *   right-click that lands on a card belongs to the card.
 * - **A pin or a portal opens the canvas menu.** The shared menu has no pin or
 *   portal kind yet (`ContextMenuState.kind` is
 *   `canvas | node | section | edge | connector`), so a pin or a portal mat opens
 *   the canvas menu at the pointer. The canonical ids stay on the target, so a
 *   future pin/portal kind needs no new pick plumbing.
 *
 * ## Coordinates
 *
 * The menu renders in client (screen) space: `ContextMenu` is portalled and
 * `position: fixed`, so `x`/`y` are the raw client coordinates. `flowPosition`
 * is the board point under the pointer instead — the surface container's
 * viewport rect is subtracted, then the camera is undone
 * (`board = (screen - camera) / zoom`). ICE nests boards inside portal mats, but
 * this mapping is identity on the root board: an instance transform is the
 * surface's business, and the shared menu acts on the active board, whose
 * coordinates at the root are the same numbers.
 *
 * ## Purity
 *
 * No React, no DOM, no ICE runtime import. `ContextMenuState` is a type-only
 * import, so it is erased and this module runs on plain maps in a test.
 */
import type { ContextMenuState } from "../store/useUiStore";

/** The instance key prefix ICE uses for a connector handle on a card. */
export const CONNECTOR_PART_PREFIX = "connector:";

/** One raw ICE pick, structural: no ICE entity type is imported. */
export interface MenuPick {
  readonly entity: number;
  readonly type: string;
  /** The picked sub-part, e.g. `connector:<id>` or a mini-mat header. */
  readonly part?: string | undefined;
}

/** A card instance on any board: the placement the pick resolved to. */
export interface MenuCardSlot {
  readonly cardId: string;
  readonly boardId: string;
}

/** A portal mat: a mini mat drawn for the portal card that opens its board. */
export interface MenuPortalSlot {
  readonly portalCardId: string;
  readonly boardId: string;
}

export interface MenuSectionSlot {
  readonly sectionId: string;
  readonly boardId: string;
}

export interface MenuEdgeSlot {
  readonly edgeId: string;
  readonly boardId: string;
}

/**
 * What a pick resolved to. `kind` is the menu's own vocabulary plus the two
 * kinds the shared menu cannot express yet (`pin`, `portal`).
 */
export type MenuTargetKind =
  | "canvas"
  | "node"
  | "section"
  | "edge"
  | "connector"
  | "pin"
  | "portal";

export interface MenuTarget {
  readonly kind: MenuTargetKind;
  /** The canonical card id: a card, a connector's card, or a portal's card. */
  readonly cardId?: string | undefined;
  readonly sectionId?: string | undefined;
  readonly edgeId?: string | undefined;
  readonly connectorId?: string | undefined;
  readonly pinId?: string | undefined;
  /**
   * The board the target lives on. `null` when the target names no board: the
   * canvas itself, or a pin, whose map carries only the id.
   */
  readonly boardId: string | null;
}

export interface MenuTargetInput {
  readonly pick: MenuPick | null;
  /** Card instances the surface spawned, keyed by entity. */
  readonly slots: ReadonlyMap<number, MenuCardSlot>;
  /** Pin id by entity. */
  readonly pins: ReadonlyMap<number, string>;
  readonly portals: ReadonlyMap<number, MenuPortalSlot>;
  readonly sections: ReadonlyMap<number, MenuSectionSlot>;
  readonly edges: ReadonlyMap<number, MenuEdgeSlot>;
}

/**
 * The connector a `part` names, or null when the part is not a connector part
 * (or names an empty id). One parser for both the mapping and a caller that
 * wants to know whether a pick landed on a handle.
 */
export function connectorIdFromPart(part: string | undefined): string | null {
  if (part === undefined || !part.startsWith(CONNECTOR_PART_PREFIX)) return null;
  const id = part.slice(CONNECTOR_PART_PREFIX.length);
  return id.length > 0 ? id : null;
}

/**
 * Resolve one pick to the menu target it belongs to.
 *
 * Lookup order is the precedence: connector part on a card, card, pin, portal,
 * section, edge, then canvas. A pick that names nothing the surface knows — a
 * stale entity, a widget with no menu, or `null` — is the canvas at worst; a
 * `null` pick is `null`, because there is nothing to open a menu on.
 */
export function menuTargetFromPick(input: MenuTargetInput): MenuTarget | null {
  const pick = input.pick;
  if (pick === null) return null;

  const card = input.slots.get(pick.entity);
  if (card !== undefined) {
    const connectorId = connectorIdFromPart(pick.part);
    if (connectorId !== null) {
      return {
        kind: "connector",
        cardId: card.cardId,
        connectorId,
        boardId: card.boardId,
      };
    }
    return { kind: "node", cardId: card.cardId, boardId: card.boardId };
  }

  const pinId = input.pins.get(pick.entity);
  if (pinId !== undefined) {
    // The pin map is entity → id only; a pin's board lives in the document.
    return { kind: "pin", pinId, boardId: null };
  }

  const portal = input.portals.get(pick.entity);
  if (portal !== undefined) {
    // Keep the canonical card id: the mat is a view of the portal card.
    return { kind: "portal", cardId: portal.portalCardId, boardId: portal.boardId };
  }

  const section = input.sections.get(pick.entity);
  if (section !== undefined) {
    return { kind: "section", sectionId: section.sectionId, boardId: section.boardId };
  }

  const edge = input.edges.get(pick.entity);
  if (edge !== undefined) {
    return { kind: "edge", edgeId: edge.edgeId, boardId: edge.boardId };
  }

  return { kind: "canvas", boardId: null };
}

/* ------------------------------------------------------------- availability */

/**
 * One menu section a target can offer. Sections, not entries: an entry's label
 * and its capability gate stay in `buildCanvasMenuItems`, which is the only
 * builder.
 */
export type MenuSectionId =
  | "create-card"
  | "create-portal"
  | "arrange-fractally"
  | "create-section"
  | "share"
  | "info"
  | "duplicate"
  | "move"
  | "remove"
  | "trash"
  | "connectors"
  | "rename"
  | "color"
  | "layer"
  | "description"
  | "delete"
  | "reposition";

/** The canvas menu: creation in place, layout, and the share entry. */
const CANVAS_SECTIONS: readonly MenuSectionId[] = [
  // New note, new whiteboard.
  "create-card",
  // New portal to an existing board, and new board + portal.
  "create-portal",
  // Arrange fractally, one entry per layout pattern.
  "arrange-fractally",
  // New section, and new section from the current selection: a section is drawn
  // around content in place, so nothing is cut and pasted.
  "create-section",
  "share",
];

/**
 * Which sections each target can offer, capability-neutral: a viewer still gets
 * the same shape, and the builder drops what the session may not do.
 *
 * A pin or a portal mat opens the canvas menu (see the module note), so both
 * offer the canvas sections; `menuItemsAvailable` answers for the menu that will
 * actually open, not for the target's theoretical kind.
 */
export const MENU_SECTIONS: Readonly<Record<MenuTargetKind, readonly MenuSectionId[]>> = {
  canvas: CANVAS_SECTIONS,
  node: [
    // "Card info" on the card chrome's own menu.
    "info",
    "duplicate",
    // Move to board.
    "move",
    // Remove from board.
    "remove",
    "trash",
    // Add connector.
    "connectors",
  ],
  section: ["rename", "color", "layer", "trash"],
  edge: ["description", "delete"],
  connector: ["reposition", "delete"],
  pin: CANVAS_SECTIONS,
  portal: CANVAS_SECTIONS,
};

/**
 * The sections the menu for `target` can offer. An absent target is no menu at
 * all, matching `buildCanvasMenuItems` returning `[]` for a closed menu.
 */
export function menuItemsAvailable(target: MenuTarget | null): readonly MenuSectionId[] {
  if (target === null) return [];
  return MENU_SECTIONS[target.kind];
}

/* ------------------------------------------------------------ context menu */

/** A client-space point; the same space the portalled menu positions in. */
export interface MenuClientPoint {
  readonly x: number;
  readonly y: number;
}

/** The surface container's viewport rect; a `DOMRect` satisfies it. */
export interface MenuContainerRect {
  readonly left: number;
  readonly top: number;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

/** ICE's camera: world = screen / zoom + translate, inverse of the projection. */
export interface MenuCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface ContextMenuStateInput {
  /** The pointer's client coordinates, as the `contextmenu` event reports them. */
  readonly client: MenuClientPoint;
  /** The surface container; absent geometry falls back to a zero origin. */
  readonly container: MenuContainerRect | null | undefined;
  /** The ICE camera; absent geometry falls back to an identity camera. */
  readonly camera: MenuCamera | null | undefined;
  readonly target: MenuTarget | null;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Screen → world → board, identity on the root board. Missing geometry degrades
 * to a zero-origin container and an identity camera rather than to `NaN`, so a
 * menu opened during a resize still lands somewhere sane.
 */
function boardPointOf(input: ContextMenuStateInput, client: MenuClientPoint): MenuClientPoint {
  const zoom = finiteOr(input.camera?.zoom, 1);
  const scale = zoom > 0 ? zoom : 1;
  const left = finiteOr(input.container?.left, 0);
  const top = finiteOr(input.container?.top, 0);
  const cameraX = finiteOr(input.camera?.x, 0);
  const cameraY = finiteOr(input.camera?.y, 0);
  return {
    x: (client.x - left - cameraX) / scale,
    y: (client.y - top - cameraY) / scale,
  };
}

/**
 * The `ContextMenuState` for a right-click on the ICE surface.
 *
 * `x`/`y` stay in client space (the menu is portalled at the pointer) and
 * `flowPosition` is the board point under it, so a create or arrange entry acts
 * where the user clicked.
 *
 * The kind mapping is deliberately lossy: a pin or a portal mat opens the canvas
 * menu, because the shared `ContextMenuState` has no pin or portal kind yet.
 * That keeps the ICE surface on the same builder the scene uses; when the shared
 * menu gains those kinds, only this switch changes.
 */
export function contextMenuStateFor(input: ContextMenuStateInput): ContextMenuState {
  const client = {
    x: finiteOr(input.client.x, 0),
    y: finiteOr(input.client.y, 0),
  };
  const flowPosition = boardPointOf(input, client);
  const target = input.target;

  if (target === null) {
    return { x: client.x, y: client.y, kind: "canvas", flowPosition };
  }

  switch (target.kind) {
    case "node":
      return {
        x: client.x,
        y: client.y,
        kind: "node",
        ...(target.cardId === undefined ? {} : { nodeId: target.cardId }),
        flowPosition,
      };
    case "connector":
      // The shared connector menu reads the card from `nodeId`.
      return {
        x: client.x,
        y: client.y,
        kind: "connector",
        ...(target.cardId === undefined ? {} : { nodeId: target.cardId }),
        ...(target.connectorId === undefined ? {} : { connectorId: target.connectorId }),
        flowPosition,
      };
    case "section":
      return {
        x: client.x,
        y: client.y,
        kind: "section",
        ...(target.sectionId === undefined ? {} : { sectionId: target.sectionId }),
        flowPosition,
      };
    case "edge":
      return {
        x: client.x,
        y: client.y,
        kind: "edge",
        ...(target.edgeId === undefined ? {} : { edgeId: target.edgeId }),
        flowPosition,
      };
    case "pin":
    case "portal":
    case "canvas":
      break;
  }

  // A pin, a portal mat and empty canvas all open the canvas menu; the target's
  // canonical ids are not forwarded, because the canvas menu would ignore them.
  return { x: client.x, y: client.y, kind: "canvas", flowPosition };
}
