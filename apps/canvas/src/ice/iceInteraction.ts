/**
 * The ICE pointer adapter: a screen-space press, a canonical gesture, a plan.
 *
 * This is the layer between ICE's raw pointer stream and `iceBridge`. It owns
 * exactly the things the bridge does not:
 * - **Picking.** A raw ICE pick (`entity` + `type` + the instance key ICE
 *   carries) resolves to one canonical instance through the bridge's index; a
 *   stale entity resolves to nothing, never to a guessed instance.
 * - **The press threshold.** A press that travels less than
 *   `ICE_POINTER_THRESHOLD` screen pixels is a click: it never becomes a move,
 *   however zoomed-in the camera is. A gesture is only a gesture once the
 *   pointer has really travelled.
 * - **One gesture at a time.** `beginGesture` refuses while another gesture is
 *   active, and a finished gesture can never produce a second plan.
 * - **Screen → world → board.** The camera maps the pointer into ICE world
 *   space; the instance transform maps that into the owning board's space,
 *   exactly as `iceBridge` writes it.
 *
 * It never writes. `end` returns the bridge's plan (`commit` | `skip` |
 * `denied`) so the caller performs the one canonical write, and a cancelled or
 * sub-threshold gesture returns no plan at all. ICE's own history is never
 * consulted; undo and redo are Loro's, routed by `routeIceHistory`.
 *
 * Everything below is pure data and pure functions over structural inputs
 * (`PickResultLike`, `GeometryLike`, `CameraLike`). There is no React, DOM, ICE
 * or `loro-crdt` import: `@suite/scene` and `./iceBridge` are type-only or
 * dependency-free.
 *
 * ## A card resize is a similarity transform (Shift reflows)
 *
 * A card's type size is its *kind's* (`layoutText` reads the kind's `law.size`),
 * so the only way to grow a card's writing with its box is to move it along the
 * type ladder in `./suiteCardScale`. A resize drag therefore does both at once:
 *
 * - **Default (similarity).** The box scales from the handle and the rung is
 *   read back from that box with `scaleForExtent` — the same mapping the
 *   projection applies to a placement — so the two can never disagree. As the
 *   box crosses a rung's threshold the card steps to its neighbouring rung.
 * - **Shift (reflow).** The modifier — read off the pointer event by the caller
 *   and handed in as `shiftKey` — pins the rung to the one the gesture started
 *   on, so the box changes and the text reflows inside it.
 *
 * The modifier is read when the gesture ends, because nothing is written before
 * that: motion only updates the ephemeral `live` preview, and `end()` returns
 * the one plan (one geometry write) that the caller commits at pointer-up.
 */
import type { Point, Rect, ResizeHandle } from "@suite/scene";
import {
  boardRectToWorld,
  EMPTY_SELECTION,
  ICE_GESTURE_EPSILON,
  ICE_MIN_CARD_SIZE,
  ICE_MIN_SECTION_SIZE,
  type IceCapabilities,
  type IceGestureItem,
  type IceGestureKind,
  type IceInstanceIndex,
  type IceInstanceRef,
  type IcePlan,
  type IcePlanContext,
  type IceSectionMember,
  type IceSelection,
  type IceUndoAdapter,
  planDelete,
  planIntent,
  planSelection,
  resolveInstance,
  resolveMoveGeometry,
  resolveResizeGeometry,
  runIceHistory,
  screenToWorld,
  worldToBoard,
} from "./iceBridge";
import {
  type CardTypeScale,
  cardScaleForResize,
  clampCardTypeScale,
  scaleForExtent,
} from "./suiteCardScale";

export { ICE_NATIVE_HISTORY_ENABLED } from "./iceBridge";

/* --------------------------------------------------------------- primitives */

/** Screen-space travel before a press counts as a drag; mirrors the scene surface. */
export const ICE_POINTER_THRESHOLD = 3;

/** The camera slice the adapter needs; a `Camera` is assignable. */
export interface CameraLike {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** The box slice the adapter needs; a `Rect` is assignable. */
export interface GeometryLike {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function finitePoint(point: Point): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Normalizes a camera so a degenerate zoom can never divide the mapping. */
function normalizeCamera(camera: CameraLike): CameraLike {
  return {
    x: Number.isFinite(camera.x) ? camera.x : 0,
    y: Number.isFinite(camera.y) ? camera.y : 0,
    zoom: Number.isFinite(camera.zoom) && camera.zoom > 0 ? camera.zoom : 1,
  };
}

function toRect(value: GeometryLike): Rect | null {
  const rect = { x: value.x, y: value.y, width: value.width, height: value.height };
  if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) return null;
  if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
  if (rect.width < 0 || rect.height < 0) return null;
  return rect;
}

const RESIZE_HANDLES: ReadonlySet<string> = new Set(["n", "ne", "e", "se", "s", "sw", "w", "nw"]);

function normalizeHandle(handle: ResizeHandle | null | undefined): ResizeHandle | null {
  return handle && RESIZE_HANDLES.has(handle) ? handle : null;
}

/** The canonical selection of a set of instances, target (first) as primary. */
export function selectionOfInstances(instances: readonly IceInstanceRef[]): IceSelection {
  const cardIds: string[] = [];
  const sectionIds: string[] = [];
  for (const instance of instances) {
    if (instance.kind === "card") {
      if (!cardIds.includes(instance.cardId)) cardIds.push(instance.cardId);
    } else if (!sectionIds.includes(instance.sectionId)) {
      sectionIds.push(instance.sectionId);
    }
  }
  const primary = instances[0] ?? null;
  return {
    cardIds,
    sectionIds,
    primaryCardId: primary?.kind === "card" ? primary.cardId : (cardIds.at(-1) ?? null),
    primarySectionId: primary?.kind === "section" ? primary.sectionId : (sectionIds.at(-1) ?? null),
  };
}

/* -------------------------------------------------------------------- picks */

/** One raw ICE pick, structural: no ICE entity type is imported. */
export interface PickResultLike {
  readonly entity: number;
  readonly type: string;
  /** The instance key ICE carries on the picked object, when it has one. */
  readonly instanceKey?: string | undefined;
  /** The picked sub-part, e.g. a mini-mat header. */
  readonly part?: string | undefined;
}

/** A raw pick with the canonical instance behind it. */
export interface IcePick {
  readonly entity: number;
  readonly type: string;
  readonly instance: IceInstanceRef;
  readonly part?: string | undefined;
}

/** The press target a gesture starts on: a resolved pick. */
export type IcePressTarget = IcePick;

export interface IcePickOptions {
  /**
   * Maps a raw pick to the instance key the index holds, for picks that carry
   * none. An ICE object id or a widget prop both work, as long as the index is
   * keyed the same way. Returning null makes the pick unresolved.
   */
  readonly instanceKeyOf?: ((pick: PickResultLike) => string | null | undefined) | undefined;
}

/**
 * Resolves a raw pick to its canonical instance. A pick that names no instance,
 * or names one the ECS has already recycled, resolves to null — never to a
 * neighbour, so a stale entity can never drag the wrong card.
 */
export function resolvePick(
  pick: PickResultLike,
  index: IceInstanceIndex,
  options?: IcePickOptions,
): IcePick | null {
  const key = pick.instanceKey ?? options?.instanceKeyOf?.(pick) ?? null;
  if (!key) return null;
  const instance = resolveInstance(index, key);
  if (!instance) return null;
  return {
    entity: pick.entity,
    type: pick.type,
    instance,
    ...(pick.part === undefined ? {} : { part: pick.part }),
  };
}

/* --------------------------------------------------------------- text focus */

/** Marks the DOM half of a live editor; a key inside it belongs to the editor. */
export const ICE_EDITOR_ATTRIBUTE = "data-ice-editor";

const EDITABLE_TAGS: ReadonlySet<string> = new Set(["INPUT", "TEXTAREA"]);
const EDITABLE_SELECTOR = `[${ICE_EDITOR_ATTRIBUTE}]`;

/** The DOM slice `hasEditableFocus` reads; an `Element`/`Text` satisfies it. */
interface EditableNodeLike {
  readonly tagName?: string | undefined;
  readonly isContentEditable?: boolean | undefined;
  readonly parentElement?: EditableNodeLike | null | undefined;
  readonly parentNode?: unknown;
  closest?: (selector: string) => EditableNodeLike | null;
  getAttribute?: (name: string) => string | null;
}

function asEditableNode(target: unknown): EditableNodeLike | null {
  let node = target as EditableNodeLike | null | undefined;
  for (let depth = 0; depth < 8 && node; depth += 1) {
    if (typeof node.tagName === "string" || typeof node.getAttribute === "function") return node;
    node = (node.parentElement ??
      (node.parentNode as EditableNodeLike | null | undefined)) as EditableNodeLike | null;
  }
  return null;
}

function attributeOf(node: EditableNodeLike, name: string): string | null {
  return typeof node.getAttribute === "function" ? node.getAttribute(name) : null;
}

/**
 * True when a keyboard event's target is a text surface: a contenteditable host,
 * an input/textarea, or anything inside a `[data-ice-editor]` subtree. A text
 * node resolves through its parent element. The key belongs to the editor then,
 * and neither the canvas nor Loro may act on it.
 */
export function hasEditableFocus(target: unknown): boolean {
  const node = asEditableNode(target);
  if (!node) return false;
  const tag = (node.tagName ?? "").toUpperCase();
  if (EDITABLE_TAGS.has(tag)) return true;
  if (node.isContentEditable === true) return true;
  if (attributeOf(node, "contenteditable") === "true") return true;
  if (attributeOf(node, ICE_EDITOR_ATTRIBUTE) !== null) return true;
  if (typeof node.closest === "function" && node.closest(EDITABLE_SELECTOR)) return true;
  return false;
}

/* ----------------------------------------------------------------- history */

/** Where a history shortcut went: an editor, Loro, or nowhere. */
export type IceHistoryRoute = "editor" | "undo" | "redo" | "none";

/** The keyboard slice `routeIceHistory` needs; a `KeyboardEvent` satisfies it. */
export interface HistoryKeyLike {
  readonly key: string;
  readonly metaKey?: boolean | undefined;
  readonly ctrlKey?: boolean | undefined;
  readonly shiftKey?: boolean | undefined;
  readonly altKey?: boolean | undefined;
  readonly defaultPrevented?: boolean | undefined;
  readonly target?: unknown;
  preventDefault?: (() => void) | undefined;
}

function historyActionOf(event: HistoryKeyLike): "undo" | "redo" | null {
  if (event.altKey) return null;
  if (!event.metaKey && !event.ctrlKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y") return "redo";
  return null;
}

/**
 * Routes Cmd/Ctrl+Z (Shift for redo) and Cmd/Ctrl+Y to Loro.
 *
 * A key typed into a text surface returns `"editor"` and touches nothing. A
 * key that is not a history chord, was already handled, or has nothing to undo
 * returns `"none"`. Only `@suite/graph`'s `UndoManager` is called: ICE's native
 * history stays disabled (`ICE_NATIVE_HISTORY_ENABLED`), because a second stack
 * would undo a move without undoing the canonical placement.
 */
export function routeIceHistory(event: HistoryKeyLike, adapter: IceUndoAdapter): IceHistoryRoute {
  const action = historyActionOf(event);
  if (!action) return "none";
  if (hasEditableFocus(event.target)) return "editor";
  if (event.defaultPrevented) return "none";
  if (!runIceHistory(adapter, action)) return "none";
  event.preventDefault?.();
  return action;
}

/* ----------------------------------------------------------------- gestures */

/** What a finished gesture resolves to. Delete is a drop on a trash affordance. */
export type IceInteractionIntent = IceGestureKind | "delete";

/** A gesture's lifetime. `ended` and `cancelled` gestures produce no further plan. */
export type IceInteractionStatus = "active" | "ended" | "cancelled";

/** One instance's ephemeral preview: board-space box plus the world box ICE paints. */
export interface IceLiveItemGeometry {
  readonly instanceKey: string;
  readonly boardId: string;
  readonly geometry: Rect;
  readonly view: Rect | null;
  /**
   * The card rung the previewed box would commit. Only a card resize carries
   * one: similarity reads it from the box, Shift pins it to the start rung.
   */
  readonly typeScale?: CardTypeScale | undefined;
}

/**
 * The live preview of a gesture. Ephemeral: it is what the overlay paints while
 * the pointer moves, never document truth.
 */
export interface IceLiveGeometry {
  readonly kind: IceGestureKind;
  readonly moved: boolean;
  /** The instance under the pointer; first of `items`. */
  readonly target: IceLiveItemGeometry;
  readonly items: readonly IceLiveItemGeometry[];
}

export interface IceGestureBeginInput {
  readonly pointerId: number;
  /** Pointer-down in screen (CSS px) space. */
  readonly screen: Point;
  /** The instance under the pointer, already resolved. */
  readonly target: IcePick;
  /** Camera-like mapping for screen → ICE world. */
  readonly camera: CameraLike;
  readonly capabilities: IceCapabilities;
  /** Board-space start box; defaults to the instance's canonical geometry. */
  readonly geometry?: GeometryLike | undefined;
  /** World-space start box; defaults to the transformed start box. */
  readonly view?: GeometryLike | undefined;
  /** A resize handle when the press landed on one; absent starts a move. */
  readonly handle?: ResizeHandle | null | undefined;
  /**
   * The type rung the card is on at pointer-down, when the caller knows it from
   * the document. Defaults to the rung its start box takes, which is what the
   * projection would have picked for it.
   */
  readonly typeScale?: number | undefined;
  /** Instance index used to expand a multi-selection press. */
  readonly index?: IceInstanceIndex | undefined;
  /** Further instances in the same selection; only same-board, same-kind ones join. */
  readonly instanceKeys?: readonly string[] | undefined;
  /** Canonical selection the press belongs to, when the caller already has it. */
  readonly selection?: IceSelection | undefined;
  /** Section members at pointer-down, so a section drag carries them. */
  readonly members?: readonly IceSectionMember[] | undefined;
  /** World-space travel below which a gesture writes nothing. */
  readonly epsilon?: number | undefined;
  /** Screen-space press threshold; defaults to `ICE_POINTER_THRESHOLD`. */
  readonly threshold?: number | undefined;
  /** Start timestamp; defaults to `Date.now()`. */
  readonly now?: number | undefined;
}

export interface IceGestureUpdateInput {
  /** Pointer position; only used when `worldDelta` is absent. */
  readonly screen?: Point | undefined;
  /** Cumulative world-space delta since pointer down, not a per-frame delta. */
  readonly worldDelta?: Point | undefined;
  /**
   * The pointer event's Shift state. On a card resize it means *reflow*: the
   * box changes and the type rung stays where it was. Held for the rest of the
   * gesture — the last sample wins, and `end()` reads it as the commit's mode.
   */
  readonly shiftKey?: boolean | undefined;
  /**
   * The pointer event's Alt state. On a card resize it means *fit*: the writing
   * decides, so the rung may step down and the box may grow rather than clip.
   */
  readonly altKey?: boolean | undefined;
  /** ICE's post-snap view rect for the pressed instance. */
  readonly finalGeometry?: GeometryLike | undefined;
  /** Post-snap view rects for every instance in the gesture. */
  readonly snapped?:
    | readonly { readonly instanceKey: string; readonly rect: GeometryLike }[]
    | undefined;
}

export interface IceGestureEndInput extends IceGestureUpdateInput {
  /** Drops the gesture: nothing is written and no plan is returned. */
  readonly cancelled?: boolean | undefined;
  /** Overrides the spatial intent; `delete` is the drag-to-trash path. */
  readonly intent?: IceInteractionIntent | undefined;
  /** Canonical selection for a delete; defaults to the one captured at press. */
  readonly selection?: IceSelection | undefined;
  /** Edges whose endpoints are leaving; the projection supplies them. */
  readonly edgeIds?: readonly string[] | undefined;
}

/** The handle `beginGesture` returns: one pointer's gesture, and its one plan. */
export interface IceGestureHandle {
  readonly pointerId: number;
  readonly kind: IceGestureKind;
  readonly target: IcePick;
  /** Timestamp at pointer-down. */
  readonly startedAt: number;
  readonly startScreen: Point;
  readonly startWorld: Point;
  /** Pointer-down in the instance's board coordinates. */
  readonly startBoard: Point;
  /** Canonical selection the press belongs to. */
  readonly selection: IceSelection;
  readonly status: IceInteractionStatus;
  /** True once the pointer travelled past the screen threshold. */
  readonly moved: boolean;
  /** Cumulative world delta since pointer down. */
  readonly worldDelta: Point;
  /** Ephemeral preview; the start box once the gesture is over. */
  readonly live: IceLiveGeometry;
  /** True while Shift is held on a card resize: the box changes, the hand stays. */
  readonly reflow: boolean;
  /** True while a card resize is being read as *fit* (Alt held). */
  readonly fit: boolean;
  /** The card rung this gesture would commit; null unless it is a card resize. */
  readonly typeScale: CardTypeScale | null;
  /** Records motion. Ephemeral: this never plans and never writes. */
  update(input?: IceGestureUpdateInput): IceLiveGeometry;
  /** Ends the gesture and returns its one plan, or null when nothing happened. */
  end(input?: IceGestureEndInput): IcePlan | null;
  /** Abandons the gesture. Nothing is written and no plan survives. */
  cancel(): void;
}

/**
 * Starts a gesture at a pointer-down.
 *
 * Returns null when another gesture is still active, when the pointer or camera
 * is not finite, when the instance transform is degenerate, or when the start
 * box is invalid — a gesture is never started without a coordinate system to
 * commit in. A viewer's gesture starts (it paints nothing) and ends `denied`.
 */
export function beginGesture(
  input: IceGestureBeginInput,
  current?: IceGestureHandle | null,
): IceGestureHandle | null {
  if (current && current.status === "active") return null;

  const instance = input.target.instance;
  const camera = normalizeCamera(input.camera);
  if (!finitePoint(input.screen)) return null;
  const startScreen = { x: input.screen.x, y: input.screen.y };

  const startWorld = screenToWorld(camera, startScreen);
  const startBoard = worldToBoard(instance.transform, startWorld);
  if (!startBoard) return null;

  const geometry = toRect(input.geometry ?? instance.geometry);
  if (!geometry) return null;
  const view = input.view ? toRect(input.view) : boardRectToWorld(instance.transform, geometry);
  if (!view) return null;

  const handle = normalizeHandle(input.handle);
  const kind: IceGestureKind =
    instance.kind === "card"
      ? handle
        ? "resize"
        : "move"
      : handle
        ? "section-resize"
        : "section-move";

  // A resize has exactly one item; a move carries the whole same-board selection.
  const items: IceGestureItem[] = [{ instance, startGeometry: geometry, startView: view }];
  if (!handle) {
    for (const key of new Set(input.instanceKeys ?? [])) {
      if (key === instance.instanceKey) continue;
      const extra = input.index ? resolveInstance(input.index, key) : null;
      // One gesture lives in one board instance: an instance that cannot move
      // with the pressed one is left out rather than voiding the whole commit.
      if (!extra || extra.kind !== instance.kind || extra.boardId !== instance.boardId) continue;
      const extraView = boardRectToWorld(extra.transform, extra.geometry);
      if (!extraView) continue;
      items.push({ instance: extra, startGeometry: extra.geometry, startView: extraView });
    }
  }

  const selection = input.selection ?? selectionOfInstances(items.map((item) => item.instance));
  const members = input.members ?? [];
  const epsilon = finiteOr(input.epsilon, ICE_GESTURE_EPSILON);
  const threshold = finiteOr(input.threshold, ICE_POINTER_THRESHOLD);
  const context: IcePlanContext = { capabilities: input.capabilities, epsilon };

  let status: IceInteractionStatus = "active";
  let delta: Point = { x: 0, y: 0 };
  let travel = 0;
  let sawWorldOnly = false;
  /** The live Shift state: reflow for a card resize, ignored for everything else. */
  let shiftKey = false;
  /** The live Alt state: fit for a card resize, ignored for everything else. */
  let fitKey = false;
  /** The rung the resize committed, frozen at `end()` so it survives the reset. */
  let committedScale: CardTypeScale | null = null;
  /** The rung the card is on at pointer-down; the anchor a reflow drag holds. */
  const startScale: CardTypeScale = clampCardTypeScale(input.typeScale ?? scaleForExtent(geometry));
  const snapped = new Map<string, Rect>();

  /** The hand a previewed box would commit: similarity, or the pinned rung. */
  const handFor = (box: GeometryLike): CardTypeScale =>
    cardScaleForResize({ extent: box, reflow: shiftKey, startScale });

  const record = (update: IceGestureUpdateInput): void => {
    if (update.shiftKey !== undefined) shiftKey = update.shiftKey;
    if (update.altKey !== undefined) fitKey = update.altKey;
    if (update.screen && finitePoint(update.screen)) {
      travel = Math.max(travel, distance(startScreen, update.screen));
    }
    if (update.worldDelta && finitePoint(update.worldDelta)) {
      delta = { x: update.worldDelta.x, y: update.worldDelta.y };
      if (!update.screen) sawWorldOnly = true;
    } else if (update.screen && finitePoint(update.screen)) {
      const world = screenToWorld(camera, update.screen);
      delta = { x: world.x - startWorld.x, y: world.y - startWorld.y };
    }
    if (update.finalGeometry) {
      const rect = toRect(update.finalGeometry);
      if (rect) snapped.set(instance.instanceKey, rect);
    }
    for (const entry of update.snapped ?? []) {
      const rect = toRect(entry.rect);
      if (rect) snapped.set(entry.instanceKey, rect);
    }
  };

  /**
   * Sub-threshold presses write nothing. A gesture that only ever received
   * world deltas has no screen samples to measure, so the document epsilon is
   * the evidence of travel instead.
   */
  const isMoved = (): boolean => {
    if (travel > threshold) return true;
    return sawWorldOnly && Math.hypot(delta.x, delta.y) > epsilon;
  };

  const withSnap = (item: IceGestureItem): IceGestureItem => {
    const rect = snapped.get(item.instance.instanceKey);
    return rect ? { ...item, finalGeometry: rect } : item;
  };

  const startLive: IceLiveItemGeometry = {
    instanceKey: instance.instanceKey,
    boardId: instance.boardId,
    geometry,
    view,
    ...(kind === "resize" ? { typeScale: startScale } : {}),
  };

  const liveItems = (): IceLiveItemGeometry[] => {
    const resizing = kind === "resize" || kind === "section-resize";
    const minSize = kind === "section-resize" ? ICE_MIN_SECTION_SIZE : ICE_MIN_CARD_SIZE;
    const result: IceLiveItemGeometry[] = [];
    for (const item of items) {
      const resolved = withSnap(item);
      const next = resizing
        ? resolveResizeGeometry(resolved, handle ?? "se", delta, minSize)
        : resolveMoveGeometry(resolved, delta);
      if (!next) continue;
      result.push({
        instanceKey: item.instance.instanceKey,
        boardId: item.instance.boardId,
        geometry: next,
        view: boardRectToWorld(item.instance.transform, next),
        // A section is not a card: only a card resize moves along the ladder.
        ...(kind === "resize" ? { typeScale: handFor(next) } : {}),
      });
    }
    return result;
  };

  const liveGeometry = (): IceLiveGeometry => {
    if (status !== "active") {
      return { kind, moved: false, target: startLive, items: [startLive] };
    }
    const list = liveItems();
    const targetItem =
      list.find((entry) => entry.instanceKey === instance.instanceKey) ?? list[0] ?? startLive;
    return {
      kind,
      moved: isMoved(),
      target: targetItem,
      items: list.length > 0 ? list : [startLive],
    };
  };

  const planFor = (): IcePlan => {
    const resolved = items.map(withSnap);
    switch (kind) {
      case "move":
        return planIntent({ kind: "move", items: resolved, worldDelta: delta }, context);
      case "section-move":
        return planIntent(
          { kind: "section-move", items: resolved, worldDelta: delta, members },
          context,
        );
      case "resize": {
        const [item] = resolved;
        if (!item || !handle) return { status: "skip", reason: "no-instance" };
        // The modifier is part of the intent, not of the box: Shift reflows at
        // the rung the gesture started on, and the plan has to be told so.
        return planIntent(
          {
            kind: "resize",
            item,
            handle,
            worldDelta: delta,
            reflow: shiftKey,
            startScale,
            fit: fitKey,
          },
          context,
        );
      }
      case "section-resize": {
        const [item] = resolved;
        if (!item || !handle) return { status: "skip", reason: "no-instance" };
        return planIntent({ kind: "section-resize", item, handle, worldDelta: delta }, context);
      }
      default:
        return { status: "skip", reason: "no-instance" };
    }
  };

  const end = (endInput: IceGestureEndInput = {}): IcePlan | null => {
    if (status !== "active") return null;
    record(endInput);
    if (endInput.cancelled) {
      status = "cancelled";
      return null;
    }
    if (endInput.intent === "delete") {
      status = "ended";
      return planDelete(
        {
          kind: "delete",
          selection: endInput.selection ?? selection,
          ...(endInput.edgeIds ? { edgeIds: endInput.edgeIds } : {}),
        },
        context,
      );
    }
    if (!isMoved()) {
      status = "ended";
      return null;
    }
    // Freeze the rung the commit carries: a similarity drag follows the box it
    // is about to write, a reflow drag keeps the rung it started on.
    if (kind === "resize") {
      committedScale = handFor(liveItems()[0]?.geometry ?? geometry);
    }
    status = "ended";
    return planFor();
  };

  return {
    pointerId: input.pointerId,
    kind,
    target: input.target,
    startedAt: input.now ?? Date.now(),
    startScreen,
    startWorld,
    startBoard,
    selection,
    get status() {
      return status;
    },
    get moved() {
      return status === "active" && isMoved();
    },
    get worldDelta() {
      return delta;
    },
    get live() {
      return liveGeometry();
    },
    get reflow() {
      return kind === "resize" && shiftKey;
    },
    get fit() {
      return kind === "resize" && fitKey;
    },
    get typeScale(): CardTypeScale | null {
      if (kind !== "resize") return null;
      if (committedScale !== null) return committedScale;
      return liveGeometry().target.typeScale ?? startScale;
    },
    update(next: IceGestureUpdateInput = {}) {
      if (status === "active") record(next);
      return liveGeometry();
    },
    end,
    cancel() {
      if (status === "active") status = "cancelled";
    },
  };
}

/** The free-function form of `gesture.update` for a ref-held gesture. */
export function updateGesture(
  gesture: IceGestureHandle,
  input?: IceGestureUpdateInput,
): IceLiveGeometry {
  return gesture.update(input);
}

/** The free-function form of `gesture.end`; null-safe for a ref-held gesture. */
export function endGesture(
  gesture: IceGestureHandle | null | undefined,
  input?: IceGestureEndInput,
): IcePlan | null {
  return gesture ? gesture.end(input) : null;
}

/* ------------------------------------------------------------------ deletes */

export interface IceDeleteSelectionInput {
  /** Instance index the keys resolve through. */
  readonly index: IceInstanceIndex;
  /** Instance keys ICE reports as selected, picked or marquee-selected. */
  readonly instanceKeys: readonly string[];
  readonly capabilities: IceCapabilities;
  /** Canonical fallback for when ICE reports no instance at all. */
  readonly current?: IceSelection | undefined;
  /** Edges whose endpoints are leaving; the projection supplies them. */
  readonly edgeIds?: readonly string[] | undefined;
}

/**
 * The Delete-key path: ICE instance keys → canonical selection → one delete
 * write. Stale entity keys drop out through `planSelection`, so a recycled ECS
 * entity can never delete a card it no longer paints.
 */
export function planDeleteGesture(input: IceDeleteSelectionInput): IcePlan {
  const selection =
    input.instanceKeys.length > 0
      ? planSelection({
          index: input.index,
          instanceKeys: input.instanceKeys,
          mode: "replace",
        }).selection
      : (input.current ?? EMPTY_SELECTION);

  return planDelete(
    {
      kind: "delete",
      selection,
      ...(input.edgeIds ? { edgeIds: input.edgeIds } : {}),
    },
    { capabilities: input.capabilities },
  );
}
