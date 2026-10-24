/**
 * The bridge between ICE gestures and the canonical Loro workspace.
 *
 * One direction only: `ICE intent → bridge → WorkspaceDocument → Loro → projection`.
 * The ICE ECS is a renderer with a disposable entity list; it is never document
 * truth. Everything below is pure data and pure functions, with one stateful
 * helper (`IceGestureSession`) whose only side effect is the single canonical
 * write it performs on commit.
 *
 * Invariants this module enforces:
 * - **One gesture, one commit.** A drag or resize updates ephemeral preview
 *   geometry on every pointer move and writes once, on release. A cancelled
 *   gesture, a pointer that stayed inside `ICE_GESTURE_EPSILON`, or an intent
 *   that names no resolvable instance writes nothing.
 * - **Snap is ICE's.** ICE owns snap guides, equal-spacing bars and
 *   auto-alignment. When ICE reports the rect it settled on (`finalGeometry`),
 *   that rect is inverse-transformed into board coordinates and committed; the
 *   bridge never derives a position from the raw pointer delta alone and never
 *   grows a second alignment system.
 * - **Selection is canonical.** A selection stores card and section ids, never
 *   instance keys. One card may paint through several portal instances; every
 *   instance of a selected id is reported so all of them repaint.
 * - **Coordinates are board coordinates.** ICE world (= page) geometry is
 *   mapped through the instance transform into the owning board's space before
 *   any write. Nested containers compose; rotation is supported.
 * - **Read-only sessions may select, never write.** Every planner takes the
 *   session capabilities and refuses writes for a viewer.
 * - **Loro is the only history.** `ICE_NATIVE_HISTORY_ENABLED` is false; ICE's
 *   own undo stack must not record document objects. `IceUndoAdapter` is the
 *   narrow slice of `UndoManager` the integration routes Ctrl/Cmd+Z to, and
 *   `WorkspaceDocument` already satisfies it structurally.
 *
 * The module deliberately imports nothing at runtime: `@suite/graph` and
 * `@suite/scene` are type-only, and there is no React, DOM or ICE import.
 */
import type { EdgeKind } from "@suite/graph";
import type { Camera, Point, Rect, ResizeHandle, Size, Transform } from "@suite/scene";
import { cardScaleForResize } from "./suiteCardScale";

/* --------------------------------------------------------------- constants */

/**
 * World-space travel below which a gesture writes nothing. Half a world unit is
 * sub-pixel at the zooms where a card is legible; ICE's own snap still wins,
 * because a snapped rect that differs from the start rect commits regardless.
 */
export const ICE_GESTURE_EPSILON = 0.5;

/** Coordinates are rounded to 1/1000 of a unit so repeated snaps are idempotent. */
export const ICE_COORDINATE_PRECISION = 1000;

/** Board-space floor for a card resize; mirrors the card chrome's usable size. */
export const ICE_MIN_CARD_SIZE: Size = { width: 48, height: 32 };

/** Board-space floor for a section, matching `WorkspaceDocument.updateSectionGeometry`. */
export const ICE_MIN_SECTION_SIZE: Size = { width: 80, height: 60 };

/** Commit origin used by the write adapter, so Loro history is attributable. */
export const ICE_WRITE_ORIGIN = "ice-bridge";

/**
 * ICE's native history is disabled for document objects from the first write.
 * It only ever covered the throwaway ICE document, and two stacks would let a
 * user undo a move without undoing the canonical placement.
 */
export const ICE_NATIVE_HISTORY_ENABLED = false;

/* ---------------------------------------------------------------- geometry */

/**
 * One instance's mapping from its board's coordinates into ICE world (page)
 * coordinates: `world = rotate(board * scale, rotation) + (x, y)`.
 *
 * `Transform` is the scene projection's scale+translation. ICE nests and can
 * rotate a container, so the bridge carries an optional rotation on top; absent
 * means zero, which makes a scene `Transform` assignable as-is.
 */
export interface IceInstanceTransform extends Transform {
  /** Radians, applied about the instance origin. Absent means 0. */
  readonly rotation?: number | undefined;
}

const DEGENERATE_SCALE = 1e-9;

function rotationOf(transform: IceInstanceTransform): number {
  const rotation = transform.rotation ?? 0;
  return Number.isFinite(rotation) ? rotation : 0;
}

function isUsableTransform(transform: IceInstanceTransform): boolean {
  return (
    Number.isFinite(transform.scale) &&
    Math.abs(transform.scale) >= DEGENERATE_SCALE &&
    Number.isFinite(transform.x) &&
    Number.isFinite(transform.y) &&
    Number.isFinite(transform.rotation ?? 0)
  );
}

function rotate(target: Point, angle: number): Point {
  if (angle === 0) return target;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: target.x * cos - target.y * sin, y: target.x * sin + target.y * cos };
}

function corners(value: Rect): readonly Point[] {
  return [
    { x: value.x, y: value.y },
    { x: value.x + value.width, y: value.y },
    { x: value.x, y: value.y + value.height },
    { x: value.x + value.width, y: value.y + value.height },
  ];
}

function boundsOf(points: readonly Point[]): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Board -> world for one instance. Null for a degenerate transform. */
export function boardToWorld(transform: IceInstanceTransform, target: Point): Point | null {
  if (!isUsableTransform(transform)) return null;
  const scaled = { x: target.x * transform.scale, y: target.y * transform.scale };
  const rotated = rotate(scaled, rotationOf(transform));
  return { x: rotated.x + transform.x, y: rotated.y + transform.y };
}

/** World -> board for one instance. Null for a degenerate transform. */
export function worldToBoard(transform: IceInstanceTransform, target: Point): Point | null {
  if (!isUsableTransform(transform)) return null;
  const moved = { x: target.x - transform.x, y: target.y - transform.y };
  const rotated = rotate(moved, -rotationOf(transform));
  return { x: rotated.x / transform.scale, y: rotated.y / transform.scale };
}

/**
 * A world-space delta expressed in the owning board's units. Rotation and scale
 * are divided out; translation cancels, so this is exact for any rotation.
 */
export function worldDeltaToBoardDelta(
  transform: IceInstanceTransform,
  delta: Point,
): Point | null {
  if (!isUsableTransform(transform)) return null;
  const rotated = rotate(delta, -rotationOf(transform));
  return { x: rotated.x / transform.scale, y: rotated.y / transform.scale };
}

/** `outer ∘ inner`: a child board's coordinates through its container into world. */
export function composeInstanceTransforms(
  outer: IceInstanceTransform,
  inner: IceInstanceTransform,
): IceInstanceTransform {
  const scale = outer.scale * inner.scale;
  const rotation = rotationOf(outer) + rotationOf(inner);
  const offset = rotate({ x: inner.x * outer.scale, y: inner.y * outer.scale }, rotationOf(outer));
  return { scale, rotation, x: offset.x + outer.x, y: offset.y + outer.y };
}

/** Inverse of `boardToWorld`, shaped as another instance transform. */
export function invertInstanceTransform(
  transform: IceInstanceTransform,
): IceInstanceTransform | null {
  if (!isUsableTransform(transform)) return null;
  const scale = 1 / transform.scale;
  const rotation = -rotationOf(transform);
  const moved = rotate({ x: -transform.x, y: -transform.y }, rotation);
  return { scale, rotation, x: moved.x * scale, y: moved.y * scale };
}

function cameraZoom(camera: Camera): number {
  return Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1;
}

/** Screen -> ICE world (page): `screen = world * zoom + offset`. */
export function screenToWorld(camera: Camera, target: Point): Point {
  const zoom = cameraZoom(camera);
  return { x: (target.x - camera.x) / zoom, y: (target.y - camera.y) / zoom };
}

/** ICE world (page) -> screen. */
export function worldToScreen(camera: Camera, target: Point): Point {
  const zoom = cameraZoom(camera);
  return { x: target.x * zoom + camera.x, y: target.y * zoom + camera.y };
}

/** Screen -> one instance's board coordinates, through the camera and the transform. */
export function screenToBoard(
  camera: Camera,
  transform: IceInstanceTransform,
  target: Point,
): Point | null {
  return worldToBoard(transform, screenToWorld(camera, target));
}

/** One instance's board coordinates -> screen. */
export function boardToScreen(
  camera: Camera,
  transform: IceInstanceTransform,
  target: Point,
): Point | null {
  const world = boardToWorld(transform, target);
  return world ? worldToScreen(camera, world) : null;
}

/**
 * Axis-aligned bounds of a board rect in world space. Unrotated instances map
 * exactly; a rotated one yields the world AABB, which is what a snap guide
 * aligns to.
 */
export function boardRectToWorld(transform: IceInstanceTransform, rect: Rect): Rect | null {
  const mapped: Point[] = [];
  for (const corner of corners(rect)) {
    const point = boardToWorld(transform, corner);
    if (!point) return null;
    mapped.push(point);
  }
  return boundsOf(mapped);
}

/**
 * A world rect expressed in board coordinates. This is the inverse of
 * `boardRectToWorld`; for a rotated instance it is the board AABB of the view
 * rect, which is the canonical box a snap-aligned view box stands for.
 */
export function worldRectToBoard(transform: IceInstanceTransform, rect: Rect): Rect | null {
  const mapped: Point[] = [];
  for (const corner of corners(rect)) {
    const point = worldToBoard(transform, corner);
    if (!point) return null;
    mapped.push(point);
  }
  return boundsOf(mapped);
}

function roundCoordinate(value: number): number {
  return Math.round(value * ICE_COORDINATE_PRECISION) / ICE_COORDINATE_PRECISION;
}

function finitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function samePoint(a: Point, b: Point, tolerance: number): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance;
}

function sameRect(a: Rect, b: Rect, tolerance: number): boolean {
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.width - b.width) <= tolerance &&
    Math.abs(a.height - b.height) <= tolerance
  );
}

/** A world-space epsilon expressed in one instance's board units. */
export function boardTolerance(
  transform: IceInstanceTransform,
  epsilon = ICE_GESTURE_EPSILON,
): number {
  const scale = Math.abs(transform.scale);
  return scale >= DEGENERATE_SCALE ? epsilon / scale : epsilon;
}

/* --------------------------------------------------------------- instances */

/**
 * One painted instance of canonical content.
 *
 * `instanceKey` and `path` are render identity (a card can paint once per
 * portal that opens its board); `boardId` + `cardId`/`sectionId` are canonical
 * identity. `geometry` is the canonical board-space box at resolve time and is
 * the baseline a gesture delta is applied to.
 */
interface IceInstanceBase {
  readonly instanceKey: string;
  /** Board ids from the root down to the instance's board. */
  readonly path: readonly string[];
  readonly boardId: string;
  readonly transform: IceInstanceTransform;
  readonly geometry: Rect;
}

export interface IceCardInstance extends IceInstanceBase {
  readonly kind: "card";
  readonly cardId: string;
}

export interface IceSectionInstance extends IceInstanceBase {
  readonly kind: "section";
  readonly sectionId: string;
}

export type IceInstanceRef = IceCardInstance | IceSectionInstance;

/** The canonical id an instance paints. */
export function canonicalIdOf(instance: IceInstanceRef): string {
  return instance.kind === "card" ? instance.cardId : instance.sectionId;
}

/** Instance key -> instance, plus canonical id -> every instance of it. */
export interface IceInstanceIndex {
  readonly instances: readonly IceInstanceRef[];
  readonly byKey: ReadonlyMap<string, IceInstanceRef>;
  readonly byCardId: ReadonlyMap<string, readonly IceInstanceRef[]>;
  readonly bySectionId: ReadonlyMap<string, readonly IceInstanceRef[]>;
}

function appendToBucket(
  buckets: Map<string, IceInstanceRef[]>,
  id: string,
  instance: IceInstanceRef,
): void {
  const bucket = buckets.get(id);
  if (bucket) bucket.push(instance);
  else buckets.set(id, [instance]);
}

/** Builds the lookup a gesture resolver needs. Duplicate instance keys keep the first. */
export function buildInstanceIndex(instances: readonly IceInstanceRef[]): IceInstanceIndex {
  const byKey = new Map<string, IceInstanceRef>();
  const byCardId = new Map<string, IceInstanceRef[]>();
  const bySectionId = new Map<string, IceInstanceRef[]>();
  const kept: IceInstanceRef[] = [];
  for (const instance of instances) {
    if (byKey.has(instance.instanceKey)) continue;
    byKey.set(instance.instanceKey, instance);
    kept.push(instance);
    if (instance.kind === "card") appendToBucket(byCardId, instance.cardId, instance);
    else appendToBucket(bySectionId, instance.sectionId, instance);
  }
  return { instances: kept, byKey, byCardId, bySectionId };
}

/** The instance an ICE entity points at; null once the ECS entity is stale. */
export function resolveInstance(
  index: IceInstanceIndex,
  instanceKey: string,
): IceInstanceRef | null {
  return index.byKey.get(instanceKey) ?? null;
}

/** Every instance that paints one canonical card. */
export function instancesOfCard(
  index: IceInstanceIndex,
  cardId: string,
): readonly IceInstanceRef[] {
  return index.byCardId.get(cardId) ?? [];
}

/** Every instance that paints one canonical section. */
export function instancesOfSection(
  index: IceInstanceIndex,
  sectionId: string,
): readonly IceInstanceRef[] {
  return index.bySectionId.get(sectionId) ?? [];
}

/* ------------------------------------------------------------ capabilities */

export type IceSessionRole = "owner" | "editor" | "viewer";

/** What a session may do. Selection is always allowed; writes are not. */
export interface IceCapabilities {
  readonly select: boolean;
  readonly write: boolean;
}

export const ICE_EDIT_CAPABILITIES: IceCapabilities = { select: true, write: true };
export const ICE_VIEW_CAPABILITIES: IceCapabilities = { select: true, write: false };

/** A viewer selects but never moves, resizes, creates, deletes or connects. */
export function capabilitiesForRole(role: IceSessionRole): IceCapabilities {
  return role === "viewer" ? ICE_VIEW_CAPABILITIES : ICE_EDIT_CAPABILITIES;
}

/* --------------------------------------------------------------- selection */

/**
 * Canonical selection. Ids, not instances: the same selection paints through
 * every visible instance and survives an instance being recycled.
 */
export interface IceSelection {
  readonly cardIds: readonly string[];
  readonly sectionIds: readonly string[];
  readonly primaryCardId: string | null;
  readonly primarySectionId: string | null;
}

export const EMPTY_SELECTION: IceSelection = {
  cardIds: [],
  sectionIds: [],
  primaryCardId: null,
  primarySectionId: null,
};

export type IceSelectionMode = "replace" | "add" | "remove" | "toggle";

export interface IceSelectionInput {
  readonly index: IceInstanceIndex;
  /** Instances ICE reports as hit or marquee-selected. */
  readonly instanceKeys: readonly string[];
  readonly current?: IceSelection | undefined;
  readonly mode?: IceSelectionMode | undefined;
  /** The instance under the pointer; becomes the primary when it resolves. */
  readonly primaryKey?: string | undefined;
}

export interface IceSelectionPlan {
  readonly selection: IceSelection;
  /** Instance keys the input named that resolved. */
  readonly resolvedKeys: readonly string[];
  /** Instance keys with no instance behind them (recycled ECS entities). */
  readonly missingKeys: readonly string[];
  /** Every instance that paints the new selection, so all of them repaint. */
  readonly instanceKeys: readonly string[];
  readonly changed: boolean;
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    kept.push(id);
  }
  return kept;
}

function toggleId(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id];
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Every instance painting a canonical selection, deduped by instance key. */
export function selectionInstances(
  index: IceInstanceIndex,
  selection: IceSelection,
): readonly IceInstanceRef[] {
  const seen = new Set<string>();
  const result: IceInstanceRef[] = [];
  for (const cardId of selection.cardIds) {
    for (const instance of instancesOfCard(index, cardId)) {
      if (seen.has(instance.instanceKey)) continue;
      seen.add(instance.instanceKey);
      result.push(instance);
    }
  }
  for (const sectionId of selection.sectionIds) {
    for (const instance of instancesOfSection(index, sectionId)) {
      if (seen.has(instance.instanceKey)) continue;
      seen.add(instance.instanceKey);
      result.push(instance);
    }
  }
  return result;
}

/**
 * Applies a click, marquee or shift-click to the canonical selection.
 *
 * Two instances of one card collapse to one id, and the plan names every
 * instance that has to repaint — including the ones the user did not click.
 */
export function planSelection(input: IceSelectionInput): IceSelectionPlan {
  const mode = input.mode ?? "replace";
  const current = input.current ?? EMPTY_SELECTION;
  const resolvedKeys: string[] = [];
  const missingKeys: string[] = [];
  const pickedCards: string[] = [];
  const pickedSections: string[] = [];

  for (const instanceKey of uniqueIds(input.instanceKeys)) {
    const instance = resolveInstance(input.index, instanceKey);
    if (!instance) {
      missingKeys.push(instanceKey);
      continue;
    }
    resolvedKeys.push(instanceKey);
    if (instance.kind === "card") pickedCards.push(instance.cardId);
    else pickedSections.push(instance.sectionId);
  }

  const nextCards = uniqueIds(pickedCards);
  const nextSections = uniqueIds(pickedSections);
  let cardIds: string[];
  let sectionIds: string[];

  switch (mode) {
    case "replace":
      cardIds = nextCards;
      sectionIds = nextSections;
      break;
    case "add":
      cardIds = uniqueIds([...current.cardIds, ...nextCards]);
      sectionIds = uniqueIds([...current.sectionIds, ...nextSections]);
      break;
    case "remove": {
      const dropCards = new Set(nextCards);
      const dropSections = new Set(nextSections);
      cardIds = current.cardIds.filter((id) => !dropCards.has(id));
      sectionIds = current.sectionIds.filter((id) => !dropSections.has(id));
      break;
    }
    case "toggle": {
      cardIds = [...current.cardIds];
      for (const id of nextCards) cardIds = toggleId(cardIds, id);
      sectionIds = [...current.sectionIds];
      for (const id of nextSections) sectionIds = toggleId(sectionIds, id);
      break;
    }
  }

  const primary = input.primaryKey ? resolveInstance(input.index, input.primaryKey) : null;
  const primaryCardId =
    primary?.kind === "card" && cardIds.includes(primary.cardId)
      ? primary.cardId
      : (cardIds.at(-1) ?? null);
  const primarySectionId =
    primary?.kind === "section" && sectionIds.includes(primary.sectionId)
      ? primary.sectionId
      : (sectionIds.at(-1) ?? null);

  const selection: IceSelection = { cardIds, sectionIds, primaryCardId, primarySectionId };
  const changed =
    !sameIds(current.cardIds, cardIds) ||
    !sameIds(current.sectionIds, sectionIds) ||
    current.primaryCardId !== primaryCardId ||
    current.primarySectionId !== primarySectionId;

  return {
    selection,
    resolvedKeys,
    missingKeys,
    instanceKeys: selectionInstances(input.index, selection).map(
      (instance) => instance.instanceKey,
    ),
    changed,
  };
}

/* ------------------------------------------------------- intents and plans */

/** A gesture item: one instance plus the geometry ICE reported for it. */
export interface IceGestureItem {
  readonly instance: IceInstanceRef;
  /** Board-space box at pointer-down; defaults to `instance.geometry`. */
  readonly startGeometry?: Rect | undefined;
  /** View-space box at pointer-down; defaults to the transformed start box. */
  readonly startView?: Rect | undefined;
  /**
   * The view-space box ICE settled on after its own snap guides, equal-spacing
   * bars or auto-alignment. When present this is authoritative: the bridge
   * inverse-transforms it and commits it, never the raw pointer position.
   */
  readonly finalGeometry?: Rect | undefined;
}

export interface IceSectionMember {
  readonly cardId: string;
  /** Board-space box at pointer-down; the section delta is added to it. */
  readonly startGeometry: Rect;
}

export interface IceMoveIntent {
  readonly kind: "move";
  readonly items: readonly IceGestureItem[];
  /** Cumulative world-space delta since pointer down. */
  readonly worldDelta: Point;
}

export interface IceResizeIntent {
  readonly kind: "resize";
  readonly item: IceGestureItem;
  readonly handle: ResizeHandle;
  readonly worldDelta: Point;
  /** Shift held at pointer-up: reflow at the starting rung instead of rescaling it. */
  readonly reflow?: boolean | undefined;
  /** The rung the gesture began on, so a reflow holds it. */
  readonly startScale?: number | undefined;
}

export interface IceSectionMoveIntent {
  readonly kind: "section-move";
  readonly items: readonly IceGestureItem[];
  readonly worldDelta: Point;
  /** Contained cards at pointer-down, supplied by the projection. */
  readonly members?: readonly IceSectionMember[] | undefined;
}

export interface IceSectionResizeIntent {
  readonly kind: "section-resize";
  readonly item: IceGestureItem;
  readonly handle: ResizeHandle;
  readonly worldDelta: Point;
}

export interface IceCreateIntent {
  readonly kind: "create";
  /** Instance the pointer landed in; omitted for the root board. */
  readonly instance?: IceInstanceRef | null | undefined;
  /** Required when `instance` is absent. */
  readonly boardId?: string | undefined;
  /** Mints the canonical id; the writer mints one when omitted. */
  readonly cardId?: string | undefined;
  readonly typeId?: string | undefined;
  /** Pointer-up position in ICE world coordinates. */
  readonly world: Point;
  /** ICE's post-snap box for the new object; its origin wins over `world`. */
  readonly finalGeometry?: Rect | undefined;
  readonly size?: Size | undefined;
}

export interface IceDeleteIntent {
  readonly kind: "delete";
  readonly selection: IceSelection;
  /** Edges whose endpoints are leaving; the projection supplies them. */
  readonly edgeIds?: readonly string[] | undefined;
}

export interface IceEdgeEnd {
  readonly cardId: string;
  readonly connectorId?: string | undefined;
}

export interface IceEdgeCreateIntent {
  readonly kind: "edge-create";
  readonly boardId: string;
  readonly source: IceEdgeEnd;
  readonly target: IceEdgeEnd;
  /** Defaults to the document's own default edge kind. */
  readonly edgeKind?: EdgeKind | undefined;
}

export interface IceEdgeDeleteIntent {
  readonly kind: "edge-delete";
  readonly edgeIds: readonly string[];
}

export type IceIntent =
  | IceMoveIntent
  | IceResizeIntent
  | IceSectionMoveIntent
  | IceSectionResizeIntent
  | IceCreateIntent
  | IceDeleteIntent
  | IceEdgeCreateIntent
  | IceEdgeDeleteIntent;

/* ------------------------------------------------------------ canonical IO */

export interface IcePlacementMove {
  readonly cardId: string;
  readonly x: number;
  readonly y: number;
}

export interface IceCreateCardWrite {
  readonly boardId: string;
  readonly cardId?: string | undefined;
  readonly typeId?: string | undefined;
  readonly position: Point;
  readonly size?: Size | undefined;
}

export interface IceSectionGeometryWrite {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

/** A member card moved with its section; the board is explicit per member. */
export interface IceSectionPlacementMove {
  readonly boardId: string;
  readonly cardId: string;
  readonly x: number;
  readonly y: number;
}

export interface IceSectionMoveWrite {
  readonly sections: readonly IceSectionGeometryWrite[];
  readonly placements?: readonly IceSectionPlacementMove[] | undefined;
}

export interface IceAddEdgeWrite {
  readonly boardId: string;
  readonly source: string;
  readonly target: string;
  readonly sourceConnector?: string | undefined;
  readonly targetConnector?: string | undefined;
  readonly kind?: EdgeKind | undefined;
}

/**
 * One canonical operation. Every variant maps to exactly one commit, so a plan
 * that carries one write carries exactly one history step.
 */
export type CanonicalWrite =
  | {
      readonly kind: "movePlacements";
      readonly boardId: string;
      readonly moves: readonly IcePlacementMove[];
    }
  | {
      readonly kind: "resizePlacement";
      readonly boardId: string;
      readonly cardId: string;
      readonly geometry: Rect;
      /** The type rung the resize settles on; absent means "derive it from the box". */
      readonly typeScale?: number | undefined;
    }
  | { readonly kind: "createCard"; readonly input: IceCreateCardWrite }
  | {
      readonly kind: "delete";
      readonly cardIds: readonly string[];
      readonly sectionIds: readonly string[];
      readonly edgeIds: readonly string[];
    }
  | { readonly kind: "moveSections"; readonly input: IceSectionMoveWrite }
  | { readonly kind: "resizeSection"; readonly sectionId: string; readonly geometry: Rect }
  | { readonly kind: "addEdge"; readonly input: IceAddEdgeWrite }
  | { readonly kind: "removeEdges"; readonly edgeIds: readonly string[] };

/**
 * The document operations the bridge needs. The integration implements this
 * over `WorkspaceDocument` — `workspaceWriter` below is the reference adapter —
 * and every method must land as **one** commit. The multi-id methods exist so a
 * multi-select gesture is one step; an adapter that loops them without batching
 * breaks the one-gesture-one-commit rule.
 */
export interface CanonicalWriter {
  movePlacements(boardId: string, moves: readonly IcePlacementMove[]): void;
  updatePlacementGeometry(
    boardId: string,
    cardId: string,
    geometry: Rect,
    typeScale?: number | undefined,
  ): void;
  /** The card and its size must land in the same commit. */
  createCard(input: IceCreateCardWrite): void;
  trashCards(cardIds: readonly string[]): void;
  moveSections(input: IceSectionMoveWrite): void;
  updateSectionGeometry(sectionId: string, geometry: Rect): void;
  deleteSections(sectionIds: readonly string[]): void;
  addEdge(input: IceAddEdgeWrite): void;
  removeEdges(edgeIds: readonly string[]): void;
  /** Optional: groups several writer calls into one history step. */
  batch?<T>(origin: string, fn: () => T): T;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled ICE bridge variant: ${String(value)}`);
}

/** Applies one canonical write. Writes never nest; a delete is one batch. */
export function applyCanonicalWrite(writer: CanonicalWriter, write: CanonicalWrite): void {
  switch (write.kind) {
    case "movePlacements":
      writer.movePlacements(write.boardId, write.moves);
      return;
    case "resizePlacement":
      writer.updatePlacementGeometry(write.boardId, write.cardId, write.geometry, write.typeScale);
      return;
    case "createCard":
      writer.createCard(write.input);
      return;
    case "delete": {
      const apply = () => {
        if (write.cardIds.length > 0) writer.trashCards(write.cardIds);
        if (write.sectionIds.length > 0) writer.deleteSections(write.sectionIds);
        if (write.edgeIds.length > 0) writer.removeEdges(write.edgeIds);
      };
      if (writer.batch) writer.batch(`${ICE_WRITE_ORIGIN}:delete`, apply);
      else apply();
      return;
    }
    case "moveSections":
      writer.moveSections(write.input);
      return;
    case "resizeSection":
      writer.updateSectionGeometry(write.sectionId, write.geometry);
      return;
    case "addEdge":
      writer.addEdge(write.input);
      return;
    case "removeEdges":
      writer.removeEdges(write.edgeIds);
      return;
    default:
      assertNever(write);
  }
}

/* ------------------------------------------------------------------ plans */

/** Why a plan writes nothing. `read-only` is the capability gate. */
export type IceRefusalReason =
  | "read-only"
  | "no-instance"
  | "wrong-instance"
  | "invalid-transform"
  | "sub-epsilon"
  | "no-change"
  | "mixed-boards"
  | "empty-selection"
  | "same-card"
  | "missing-writer"
  | "not-active"
  | "already-finished";

export interface IceCommitPlan {
  readonly status: "commit";
  readonly write: CanonicalWrite;
}

export interface IceRefusedPlan {
  readonly status: "skip" | "denied";
  readonly reason: IceRefusalReason;
}

export type IcePlan = IceCommitPlan | IceRefusedPlan;

export interface IcePlanContext {
  readonly capabilities: IceCapabilities;
  /** World-space travel below which a gesture writes nothing. */
  readonly epsilon?: number | undefined;
  /** Board-space floor for a card resize; defaults to `ICE_MIN_CARD_SIZE`. */
  readonly minSize?: Size | undefined;
}

function commitPlan(write: CanonicalWrite): IceCommitPlan {
  return { status: "commit", write };
}

function skipPlan(reason: IceRefusalReason): IceRefusedPlan {
  return { status: "skip", reason };
}

function deniedPlan(): IceRefusedPlan {
  return { status: "denied", reason: "read-only" };
}

function planEpsilon(context: IcePlanContext): number {
  const epsilon = context.epsilon ?? ICE_GESTURE_EPSILON;
  return Number.isFinite(epsilon) && epsilon >= 0 ? epsilon : ICE_GESTURE_EPSILON;
}

/* -------------------------------------------------------- resolved geometry */

function startGeometryOf(item: IceGestureItem): Rect {
  return item.startGeometry ?? item.instance.geometry;
}

function startViewOf(item: IceGestureItem): Rect | null {
  if (item.startView) return item.startView;
  return boardRectToWorld(item.instance.transform, startGeometryOf(item));
}

/**
 * The board-space delta an item resolves to. ICE's snapped rect wins: its
 * origin is compared with the pointer-down view rect and the difference is
 * mapped through the instance transform, which is exact under rotation.
 */
export function resolveBoardDelta(item: IceGestureItem, worldDelta: Point): Point | null {
  if (item.finalGeometry) {
    const startView = startViewOf(item);
    if (!startView) return null;
    const delta = {
      x: item.finalGeometry.x - startView.x,
      y: item.finalGeometry.y - startView.y,
    };
    return worldDeltaToBoardDelta(item.instance.transform, delta);
  }
  return worldDeltaToBoardDelta(item.instance.transform, worldDelta);
}

/** The board-space box a move resolves to; size is untouched. */
export function resolveMoveGeometry(item: IceGestureItem, worldDelta: Point): Rect | null {
  const start = startGeometryOf(item);
  const delta = resolveBoardDelta(item, worldDelta);
  if (!delta || !finitePoint(delta)) return null;
  const geometry = {
    x: start.x + delta.x,
    y: start.y + delta.y,
    width: start.width,
    height: start.height,
  };
  return finitePoint(geometry) ? geometry : null;
}

function applyResizeHandle(start: Rect, handle: ResizeHandle, delta: Point, minSize: Size): Rect {
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  const minWidth = minSize.width > 0 ? minSize.width : 1;
  const minHeight = minSize.height > 0 ? minSize.height : 1;

  let x = start.x;
  let y = start.y;
  let width = start.width;
  let height = start.height;

  if (handle.includes("w")) {
    x = Math.min(start.x + delta.x, right - minWidth);
    width = right - x;
  } else if (handle.includes("e")) {
    width = Math.max(minWidth, start.width + delta.x);
  }

  if (handle.includes("n")) {
    y = Math.min(start.y + delta.y, bottom - minHeight);
    height = bottom - y;
  } else if (handle.includes("s")) {
    height = Math.max(minHeight, start.height + delta.y);
  }

  return { x, y, width, height };
}

function floorRect(rect: Rect, minSize: Size): Rect {
  return {
    x: rect.x,
    y: rect.y,
    width: Math.max(minSize.width > 0 ? minSize.width : 1, rect.width),
    height: Math.max(minSize.height > 0 ? minSize.height : 1, rect.height),
  };
}

/**
 * The board-space box a resize resolves to. A snapped view rect is mapped back
 * through the transform; otherwise the handle delta is applied and clamped to
 * `minSize` with the opposite edge anchored.
 */
export function resolveResizeGeometry(
  item: IceGestureItem,
  handle: ResizeHandle,
  worldDelta: Point,
  minSize: Size = ICE_MIN_CARD_SIZE,
): Rect | null {
  const start = startGeometryOf(item);
  if (item.finalGeometry) {
    const snapped = worldRectToBoard(item.instance.transform, item.finalGeometry);
    return snapped ? floorRect(snapped, minSize) : null;
  }
  const delta = worldDeltaToBoardDelta(item.instance.transform, worldDelta);
  if (!delta || !finitePoint(delta)) return null;
  const geometry = applyResizeHandle(start, handle, delta, minSize);
  return finitePoint(geometry) ? geometry : null;
}

function roundRectGeometry(rect: Rect): Rect {
  return {
    x: roundCoordinate(rect.x),
    y: roundCoordinate(rect.y),
    width: roundCoordinate(rect.width),
    height: roundCoordinate(rect.height),
  };
}

/* ---------------------------------------------------------------- planners */

function worldTravel(worldDelta: Point): number {
  return Math.hypot(worldDelta.x, worldDelta.y);
}

/**
 * Plans a card drag. Every item resolves to the same board (a gesture lives in
 * one board instance); duplicate canonical placements collapse to one move, so
 * a card painted through two instances is written once and both repaint.
 */
export function planMoveCommit(intent: IceMoveIntent, context: IcePlanContext): IcePlan {
  if (!context.capabilities.write) return deniedPlan();

  const cards = intent.items.filter(
    (item): item is IceGestureItem & { instance: IceCardInstance } => item.instance.kind === "card",
  );
  if (cards.length === 0) return skipPlan("no-instance");

  const epsilon = planEpsilon(context);
  const snapped = cards.some((item) => item.finalGeometry !== undefined);
  const travel = worldTravel(intent.worldDelta);
  if (!snapped && (!Number.isFinite(travel) || travel < epsilon)) {
    return skipPlan("sub-epsilon");
  }

  const boards = new Set<string>();
  const moves = new Map<string, IcePlacementMove>();
  let moved = false;

  for (const item of cards) {
    const { instance } = item;
    const start = startGeometryOf(item);
    const geometry = resolveMoveGeometry(item, intent.worldDelta);
    if (!geometry) return skipPlan("invalid-transform");

    const tolerance = boardTolerance(instance.transform, epsilon);
    if (!samePoint(geometry, start, tolerance)) moved = true;

    boards.add(instance.boardId);
    const key = `${instance.boardId}\u001f${instance.cardId}`;
    if (moves.has(key)) continue;
    moves.set(key, {
      cardId: instance.cardId,
      x: roundCoordinate(geometry.x),
      y: roundCoordinate(geometry.y),
    });
  }

  if (boards.size > 1) return skipPlan("mixed-boards");
  if (!moved) return skipPlan(snapped ? "no-change" : "sub-epsilon");

  const [boardId] = boards;
  if (!boardId) return skipPlan("no-instance");
  return commitPlan({ kind: "movePlacements", boardId, moves: [...moves.values()] });
}

/** Plans a card resize. Position and size land in one write. */
export function planResizeCommit(intent: IceResizeIntent, context: IcePlanContext): IcePlan {
  if (!context.capabilities.write) return deniedPlan();
  const { instance } = intent.item;
  if (instance.kind !== "card") return skipPlan("wrong-instance");

  const epsilon = planEpsilon(context);
  const minSize = context.minSize ?? ICE_MIN_CARD_SIZE;
  const start = startGeometryOf(intent.item);
  const geometry = resolveResizeGeometry(intent.item, intent.handle, intent.worldDelta, minSize);
  if (!geometry) return skipPlan("invalid-transform");

  const snapped = intent.item.finalGeometry !== undefined;
  const tolerance = boardTolerance(instance.transform, epsilon);
  if (sameRect(geometry, start, tolerance)) {
    return skipPlan(snapped ? "no-change" : "sub-epsilon");
  }

  const rounded = roundRectGeometry(geometry);
  // One policy decides the rung: similarity reads it off the resolved box (the
  // same `scaleForExtent` the projection uses, so box and rung cannot disagree),
  // a reflow holds the rung the gesture started on.
  return commitPlan({
    kind: "resizePlacement",
    boardId: instance.boardId,
    cardId: instance.cardId,
    geometry: rounded,
    typeScale: cardScaleForResize({
      extent: rounded,
      reflow: intent.reflow === true,
      startScale: intent.startScale,
    }),
  });
}

/**
 * Plans a section drag. The section and every member card it contains move in
 * one `moveSections` write, because membership is derived from geometry: moving
 * the region without its cards would silently break it.
 */
export function planSectionMoveCommit(
  intent: IceSectionMoveIntent,
  context: IcePlanContext,
): IcePlan {
  if (!context.capabilities.write) return deniedPlan();

  const sections = intent.items.filter(
    (item): item is IceGestureItem & { instance: IceSectionInstance } =>
      item.instance.kind === "section",
  );
  if (sections.length === 0) return skipPlan("no-instance");

  const epsilon = planEpsilon(context);
  const snapped = sections.some((item) => item.finalGeometry !== undefined);
  const travel = worldTravel(intent.worldDelta);
  if (!snapped && (!Number.isFinite(travel) || travel < epsilon)) {
    return skipPlan("sub-epsilon");
  }

  const boards = new Set<string>();
  const writes: IceSectionGeometryWrite[] = [];
  let moved = false;
  let primaryDelta: Point | null = null;

  for (const item of sections) {
    const { instance } = item;
    const start = startGeometryOf(item);
    const geometry = resolveMoveGeometry(item, intent.worldDelta);
    if (!geometry) return skipPlan("invalid-transform");
    const delta = resolveBoardDelta(item, intent.worldDelta);
    if (!delta) return skipPlan("invalid-transform");
    primaryDelta ??= delta;

    const tolerance = boardTolerance(instance.transform, epsilon);
    if (!samePoint(geometry, start, tolerance)) moved = true;

    boards.add(instance.boardId);
    writes.push({
      id: instance.sectionId,
      x: roundCoordinate(geometry.x),
      y: roundCoordinate(geometry.y),
    });
  }

  if (boards.size > 1) return skipPlan("mixed-boards");
  if (!moved) return skipPlan(snapped ? "no-change" : "sub-epsilon");

  const [boardId] = boards;
  if (!boardId || !primaryDelta) return skipPlan("no-instance");

  const members = intent.members ?? [];
  const placements =
    members.length > 0
      ? members.map((member) => ({
          boardId,
          cardId: member.cardId,
          x: roundCoordinate(member.startGeometry.x + primaryDelta.x),
          y: roundCoordinate(member.startGeometry.y + primaryDelta.y),
        }))
      : undefined;

  return commitPlan({
    kind: "moveSections",
    input: { sections: writes, ...(placements ? { placements } : {}) },
  });
}

/** Plans a section resize, clamped to the document's own section floor. */
export function planSectionResizeCommit(
  intent: IceSectionResizeIntent,
  context: IcePlanContext,
): IcePlan {
  if (!context.capabilities.write) return deniedPlan();
  const { instance } = intent.item;
  if (instance.kind !== "section") return skipPlan("wrong-instance");

  const epsilon = planEpsilon(context);
  const start = startGeometryOf(intent.item);
  const geometry = resolveResizeGeometry(
    intent.item,
    intent.handle,
    intent.worldDelta,
    ICE_MIN_SECTION_SIZE,
  );
  if (!geometry) return skipPlan("invalid-transform");

  const snapped = intent.item.finalGeometry !== undefined;
  const tolerance = boardTolerance(instance.transform, epsilon);
  if (sameRect(geometry, start, tolerance)) {
    return skipPlan(snapped ? "no-change" : "sub-epsilon");
  }

  return commitPlan({
    kind: "resizeSection",
    sectionId: instance.sectionId,
    geometry: roundRectGeometry(geometry),
  });
}

/**
 * Plans card creation at the point the pointer landed. A snapped or
 * auto-laid-out rect decides the position when ICE reports one; the created
 * card and its size are one write, so undo removes it whole.
 */
export function planCreate(intent: IceCreateIntent, context: IcePlanContext): IcePlan {
  if (!context.capabilities.write) return deniedPlan();

  const transform = intent.instance?.transform ?? null;
  const boardId = intent.instance?.boardId ?? intent.boardId ?? null;
  if (!boardId) return skipPlan("no-instance");

  let position: Point | null;
  if (intent.finalGeometry) {
    position = transform
      ? worldToBoard(transform, { x: intent.finalGeometry.x, y: intent.finalGeometry.y })
      : { x: intent.finalGeometry.x, y: intent.finalGeometry.y };
  } else {
    position = transform ? worldToBoard(transform, intent.world) : intent.world;
  }
  if (!position || !finitePoint(position)) return skipPlan("invalid-transform");

  return commitPlan({
    kind: "createCard",
    input: {
      boardId,
      ...(intent.cardId ? { cardId: intent.cardId } : {}),
      ...(intent.typeId ? { typeId: intent.typeId } : {}),
      position: { x: roundCoordinate(position.x), y: roundCoordinate(position.y) },
      ...(intent.size ? { size: intent.size } : {}),
    },
  });
}

/** Plans deleting the selected cards, sections and edges as one write. */
export function planDelete(intent: IceDeleteIntent, context: IcePlanContext): IcePlan {
  if (!context.capabilities.write) return deniedPlan();

  const cardIds = uniqueIds(intent.selection.cardIds);
  const sectionIds = uniqueIds(intent.selection.sectionIds);
  const edgeIds = uniqueIds(intent.edgeIds ?? []);
  if (cardIds.length === 0 && sectionIds.length === 0 && edgeIds.length === 0) {
    return skipPlan("empty-selection");
  }

  return commitPlan({ kind: "delete", cardIds, sectionIds, edgeIds });
}

/** Plans a new edge between two cards on one board. */
export function planEdgeCreate(intent: IceEdgeCreateIntent, context: IcePlanContext): IcePlan {
  if (!context.capabilities.write) return deniedPlan();
  if (intent.source.cardId === intent.target.cardId) return skipPlan("same-card");

  return commitPlan({
    kind: "addEdge",
    input: {
      boardId: intent.boardId,
      source: intent.source.cardId,
      target: intent.target.cardId,
      ...(intent.source.connectorId ? { sourceConnector: intent.source.connectorId } : {}),
      ...(intent.target.connectorId ? { targetConnector: intent.target.connectorId } : {}),
      ...(intent.edgeKind ? { kind: intent.edgeKind } : {}),
    },
  });
}

/** Plans removing edges as one write. */
export function planEdgeDelete(intent: IceEdgeDeleteIntent, context: IcePlanContext): IcePlan {
  if (!context.capabilities.write) return deniedPlan();
  const edgeIds = uniqueIds(intent.edgeIds);
  if (edgeIds.length === 0) return skipPlan("empty-selection");
  return commitPlan({ kind: "removeEdges", edgeIds });
}

/** Dispatches one intent to its planner. */
export function planIntent(intent: IceIntent, context: IcePlanContext): IcePlan {
  switch (intent.kind) {
    case "move":
      return planMoveCommit(intent, context);
    case "resize":
      return planResizeCommit(intent, context);
    case "section-move":
      return planSectionMoveCommit(intent, context);
    case "section-resize":
      return planSectionResizeCommit(intent, context);
    case "create":
      return planCreate(intent, context);
    case "delete":
      return planDelete(intent, context);
    case "edge-create":
      return planEdgeCreate(intent, context);
    case "edge-delete":
      return planEdgeDelete(intent, context);
    default: {
      const exhaustive: never = intent;
      return exhaustive;
    }
  }
}

/* --------------------------------------------------------- gesture session */

export type IceGestureKind = "move" | "resize" | "section-move" | "section-resize";

export type IceGestureStatus = "idle" | "active" | "committed" | "cancelled";

export interface IceGestureStart {
  readonly kind: IceGestureKind;
  /** One item for a resize, the whole selection for a move. */
  readonly items: readonly IceGestureItem[];
  /** Required for the resize kinds. */
  readonly handle?: ResizeHandle | undefined;
  /** Section members at pointer-down, for a section move. */
  readonly members?: readonly IceSectionMember[] | undefined;
}

export interface IceGestureUpdate {
  /** Cumulative world-space delta since pointer down, not a per-frame delta. */
  readonly worldDelta?: Point | undefined;
  /** ICE's post-snap view rects for this frame, keyed by instance key. */
  readonly finalGeometry?:
    | readonly { readonly instanceKey: string; readonly rect: Rect }[]
    | undefined;
}

/** Ephemeral preview geometry: board-space box plus the view box to paint. */
export interface IceLiveItem {
  readonly instanceKey: string;
  readonly boardId: string;
  readonly geometry: Rect;
  readonly view: Rect | null;
}

export type IceCommitOutcome =
  | { readonly status: "committed"; readonly plan: IceCommitPlan }
  | { readonly status: "refused"; readonly reason: IceRefusalReason };

export interface IceGestureSessionOptions {
  /** Null before the integration installs a bridge: nothing can be written. */
  readonly writer: CanonicalWriter | null;
  readonly capabilities: IceCapabilities;
  readonly epsilon?: number | undefined;
  readonly minSize?: Size | undefined;
}

interface ActiveGesture {
  readonly start: IceGestureStart;
  readonly handle: ResizeHandle | null;
}

function refusal(reason: IceRefusalReason): IceCommitOutcome {
  return { status: "refused", reason };
}

/**
 * One pointer gesture. `update` only recomputes preview geometry; `commit`
 * writes at most once, from the start geometry plus the latest delta or the
 * snapped rect ICE reported. The session is finished after either commit or
 * cancel, so a stray second release cannot double-write.
 */
export class IceGestureSession {
  private readonly writer: CanonicalWriter | null;
  private readonly capabilities: IceCapabilities;
  private readonly epsilon: number;
  private readonly minSize: Size;
  private state: IceGestureStatus = "idle";
  private active: ActiveGesture | null = null;
  private delta: Point = { x: 0, y: 0 };
  private readonly snapped = new Map<string, Rect>();
  private liveItems: readonly IceLiveItem[] = [];

  constructor(options: IceGestureSessionOptions) {
    this.writer = options.writer;
    this.capabilities = options.capabilities;
    this.epsilon = options.epsilon ?? ICE_GESTURE_EPSILON;
    this.minSize = options.minSize ?? ICE_MIN_CARD_SIZE;
  }

  get status(): IceGestureStatus {
    return this.state;
  }

  get isActive(): boolean {
    return this.state === "active";
  }

  /** Cumulative world delta since pointer down. */
  get worldDelta(): Point {
    return this.delta;
  }

  /** Ephemeral preview, never document truth. Empty once the gesture finishes. */
  get live(): readonly IceLiveItem[] {
    return this.liveItems;
  }

  /**
   * Starts a gesture. Returns false — and writes nothing later — when the
   * intent cannot name an instance, when a resize has no single item or handle,
   * or when another gesture is still active.
   */
  begin(start: IceGestureStart): boolean {
    if (this.state === "active") return false;
    const isResize = start.kind === "resize" || start.kind === "section-resize";
    if (isResize && (start.items.length !== 1 || !start.handle)) return false;
    if (!isResize && start.items.length === 0) return false;

    this.state = "active";
    this.active = { start, handle: start.handle ?? null };
    this.delta = { x: 0, y: 0 };
    this.snapped.clear();
    for (const item of start.items) {
      if (item.finalGeometry) {
        this.snapped.set(item.instance.instanceKey, item.finalGeometry);
      }
    }
    this.refreshLive();
    return true;
  }

  /** Records motion. Ephemeral: this never touches the writer. */
  update(update: IceGestureUpdate): void {
    if (this.state !== "active") return;
    if (update.worldDelta) this.delta = update.worldDelta;
    for (const entry of update.finalGeometry ?? []) {
      this.snapped.set(entry.instanceKey, entry.rect);
    }
    this.refreshLive();
  }

  /**
   * Ends the gesture and performs its single commit. An optional final update
   * lets the integration hand over the release frame's snapped rects in the
   * same call.
   */
  commit(update?: IceGestureUpdate): IceCommitOutcome {
    if (this.state === "committed" || this.state === "cancelled") {
      return refusal("already-finished");
    }
    if (this.state !== "active" || !this.active) return refusal("not-active");
    if (update) this.update(update);

    this.state = "committed";
    const active = this.active;
    this.active = null;
    this.liveItems = [];

    if (!this.writer) return refusal("missing-writer");

    const intent = this.intentFor(active);
    if (!intent) return refusal("no-instance");

    const plan = planIntent(intent, {
      capabilities: this.capabilities,
      epsilon: this.epsilon,
      minSize: this.minSize,
    });
    if (plan.status !== "commit") return refusal(plan.reason);

    applyCanonicalWrite(this.writer, plan.write);
    return { status: "committed", plan };
  }

  /** Abandons the gesture. Nothing is written and no preview survives. */
  cancel(): void {
    if (this.state !== "active") return;
    this.state = "cancelled";
    this.active = null;
    this.liveItems = [];
  }

  private withSnapped(item: IceGestureItem): IceGestureItem {
    const rect = this.snapped.get(item.instance.instanceKey);
    return rect ? { ...item, finalGeometry: rect } : item;
  }

  private intentFor(active: ActiveGesture): IceIntent | null {
    const items = active.start.items.map((item) => this.withSnapped(item));
    switch (active.start.kind) {
      case "move": {
        return { kind: "move", items, worldDelta: this.delta };
      }
      case "resize": {
        const [item] = items;
        if (!item || !active.handle) return null;
        return { kind: "resize", item, handle: active.handle, worldDelta: this.delta };
      }
      case "section-move": {
        return {
          kind: "section-move",
          items,
          worldDelta: this.delta,
          ...(active.start.members ? { members: active.start.members } : {}),
        };
      }
      case "section-resize": {
        const [item] = items;
        if (!item || !active.handle) return null;
        return {
          kind: "section-resize",
          item,
          handle: active.handle,
          worldDelta: this.delta,
        };
      }
      default: {
        const exhaustive: never = active.start.kind;
        return exhaustive;
      }
    }
  }

  private refreshLive(): void {
    const active = this.active;
    if (!active) {
      this.liveItems = [];
      return;
    }
    const isResize = active.start.kind === "resize" || active.start.kind === "section-resize";
    const live: IceLiveItem[] = [];

    for (const raw of active.start.items) {
      const item = this.withSnapped(raw);
      const geometry = isResize
        ? resolveResizeGeometry(
            item,
            active.handle ?? "se",
            this.delta,
            active.start.kind === "section-resize" ? ICE_MIN_SECTION_SIZE : this.minSize,
          )
        : resolveMoveGeometry(item, this.delta);
      if (!geometry) continue;
      live.push({
        instanceKey: item.instance.instanceKey,
        boardId: item.instance.boardId,
        geometry,
        view: boardRectToWorld(item.instance.transform, geometry),
      });
    }
    this.liveItems = live;
  }
}

/* ----------------------------------------------------------------- history */

/**
 * The narrow slice of Loro's `UndoManager` the bridge needs. `WorkspaceDocument`
 * exposes exactly these four methods, so no `loro-crdt` import is required here
 * and the integration can pass the document itself.
 */
export interface IceUndoAdapter {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

export type IceHistoryAction = "undo" | "redo";

/**
 * Routes a history shortcut to Loro. ICE's own history is never consulted for a
 * document gesture (`ICE_NATIVE_HISTORY_ENABLED` is false); returns false when
 * there is nothing to undo or redo so the surface can leave the key unhandled.
 */
export function runIceHistory(adapter: IceUndoAdapter, action: IceHistoryAction): boolean {
  if (action === "undo") {
    if (!adapter.canUndo()) return false;
    adapter.undo();
    return true;
  }
  if (!adapter.canRedo()) return false;
  adapter.redo();
  return true;
}

/* ------------------------------------------------------- workspace adapter */

/**
 * The slice of `WorkspaceDocument` the reference adapter uses. Declared
 * structurally so this module never imports the document (or loro-crdt) at
 * runtime; `WorkspaceDocument` satisfies it as-is.
 */
export interface WorkspaceDocumentLike {
  movePlacements(boardId: string, moves: { cardId: string; x: number; y: number }[]): void;
  updatePlacementGeometry(
    boardId: string,
    cardId: string,
    geometry: { x: number; y: number; width: number; height: number },
    typeScale?: number | null,
  ): void;
  createCard(input: {
    id?: string;
    typeId?: string;
    boardId?: string;
    position?: { x: number; y: number };
  }): { id: string };
  trashCard(cardId: string): void;
  moveSectionsBatch(input: {
    sections: { id: string; x: number; y: number; width?: number; height?: number }[];
    placements?: { boardId: string; cardId: string; x: number; y: number }[];
  }): void;
  updateSectionGeometry(
    sectionId: string,
    rect: { x: number; y: number; width: number; height: number },
  ): void;
  deleteSection(sectionId: string): void;
  addEdge(input: {
    boardId: string;
    source: string;
    target: string;
    sourceConnector?: string;
    targetConnector?: string;
    kind?: EdgeKind;
  }): unknown;
  removeEdge(edgeId: string): void;
  batch<T>(origin: string, fn: () => T): T;
}

/**
 * The reference `CanonicalWriter` over a real document. Every method is one
 * commit: multi-entity operations run inside `doc.batch`, which joins nested
 * batches, so a create-with-size or a multi-select delete is one history step.
 */
export function workspaceWriter(doc: WorkspaceDocumentLike): CanonicalWriter {
  return {
    movePlacements(boardId, moves) {
      doc.movePlacements(
        boardId,
        moves.map((move) => ({ cardId: move.cardId, x: move.x, y: move.y })),
      );
    },
    updatePlacementGeometry(boardId, cardId, geometry, typeScale) {
      doc.updatePlacementGeometry(
        boardId,
        cardId,
        { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
        typeScale ?? null,
      );
    },
    createCard(input) {
      doc.batch(ICE_WRITE_ORIGIN, () => {
        const card = doc.createCard({
          ...(input.cardId ? { id: input.cardId } : {}),
          ...(input.typeId ? { typeId: input.typeId } : {}),
          boardId: input.boardId,
          position: { x: input.position.x, y: input.position.y },
        });
        if (input.size) {
          doc.updatePlacementGeometry(input.boardId, input.cardId ?? card.id, {
            x: input.position.x,
            y: input.position.y,
            width: input.size.width,
            height: input.size.height,
          });
        }
      });
    },
    trashCards(cardIds) {
      doc.batch(ICE_WRITE_ORIGIN, () => {
        for (const cardId of cardIds) doc.trashCard(cardId);
      });
    },
    moveSections(input) {
      doc.moveSectionsBatch({
        sections: input.sections.map((section) => ({
          id: section.id,
          x: section.x,
          y: section.y,
          ...(section.width !== undefined ? { width: section.width } : {}),
          ...(section.height !== undefined ? { height: section.height } : {}),
        })),
        ...(input.placements
          ? {
              placements: input.placements.map((placement) => ({
                boardId: placement.boardId,
                cardId: placement.cardId,
                x: placement.x,
                y: placement.y,
              })),
            }
          : {}),
      });
    },
    updateSectionGeometry(sectionId, geometry) {
      doc.updateSectionGeometry(sectionId, {
        x: geometry.x,
        y: geometry.y,
        width: geometry.width,
        height: geometry.height,
      });
    },
    deleteSections(sectionIds) {
      doc.batch(ICE_WRITE_ORIGIN, () => {
        for (const sectionId of sectionIds) doc.deleteSection(sectionId);
      });
    },
    addEdge(input) {
      doc.addEdge({
        boardId: input.boardId,
        source: input.source,
        target: input.target,
        ...(input.sourceConnector ? { sourceConnector: input.sourceConnector } : {}),
        ...(input.targetConnector ? { targetConnector: input.targetConnector } : {}),
        ...(input.kind ? { kind: input.kind } : {}),
      });
    },
    removeEdges(edgeIds) {
      doc.batch(ICE_WRITE_ORIGIN, () => {
        for (const edgeId of edgeIds) doc.removeEdge(edgeId);
      });
    },
    batch(origin, fn) {
      return doc.batch(origin, fn);
    },
  };
}
