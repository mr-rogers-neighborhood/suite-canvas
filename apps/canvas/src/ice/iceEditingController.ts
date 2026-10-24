/**
 * The editable-canvas controller: drag, resize and delete on the frame the
 * camera is inside, wired to the canonical document through the bridge
 * planners.
 *
 * This module is deliberately free of ICE and React imports so the gesture
 * logic is testable in jsdom and cannot pull the engine into the default
 * bundle. `IceSurface` supplies adapters for the camera, the pick, the geometry
 * and the engine's removal path; everything else is canonical.
 *
 * Contract, in order:
 * - pointer-down records the pressed entity and its start box; nothing writes.
 *   A press on a member of the selection records every selected card on the
 *   same frame, each with its own box, so one drag writes them as one commit.
 * - pointer-up reads the entity's box *after* ICE applied its snap, and ends the
 *   gesture with that final rect, so the commit is the snapped geometry.
 * - a press that never travelled, a cancelled pointer and a read-only session
 *   all end without a write.
 * - a drop ICE reports as entering a Board is a cross-Board move: the placement
 *   is moved to the new Board in one commit.
 * - a delete is one `planDelete` write plus the engine's own removal of the
 *   entity, which is projection state, not document state.
 */

import type { Rect } from "@suite/scene";
import {
  applyCanonicalWrite,
  type CanonicalWriter,
  capabilitiesForRole,
  type IceCapabilities,
  type IceCardInstance,
  type IceDropMove,
  type IceInstanceIndex,
  type IcePlan,
  type IceUndoAdapter,
  planBoardNestCommit,
  planBoardRectCommit,
  planDropCommit,
  planResizeCommit,
} from "./iceBridge";
import {
  beginGesture,
  ICE_POINTER_THRESHOLD,
  type IceGestureHandle,
  type IcePick,
  planDeleteGesture,
} from "./iceInteraction";

/** What a projected entity stands for. */
export interface IceEditableSlot {
  readonly cardId: string;
  readonly boardId: string;
  /** What the card says, when the caller knows: the fit reading measures it. */
  readonly text?: string | undefined;
}

/** A Board's mat: the entity is a frame, so its gesture writes the Board's rect. */
export interface IceBoardSlot {
  readonly boardId: string;
  /** The Board that holds this frame; a top-level Board names its View root. */
  readonly parentBoardId: string;
}

/** How the controller reaches the engine and the document. */
export interface IceEditingAdapters {
  /** Scene-style camera: `screen = (world - x) * zoom`. */
  camera(): { x: number; y: number; zoom: number } | null;
  /** The entity under a container-relative screen point, or null. */
  pick(screen: { x: number; y: number }): number | null;
  /** The entity's box in its own frame's units, as ICE reports it. */
  rectOf(entity: number): Rect | null;
  /** One canonical commit per gesture. Null when no workspace is open. */
  writer: CanonicalWriter | null;
  /** A viewer selects but never writes. */
  role: "owner" | "editor" | "viewer";
  /** Removes the entities for cards the document no longer holds. */
  removeCards(cardIds: readonly string[]): void;
  /** Called after a successful commit so the caller can reconcile. */
  afterCommit?(): void;
}

export interface IceEditingOptions extends IceEditingAdapters {
  /** Entity -> canonical ids. Populated by the projection. */
  readonly slots: ReadonlyMap<number, IceEditableSlot>;
  /** The root board whose placements are canonical. */
  readonly rootBoardId: string;
  /**
   * The Board frame the camera is inside, with the Board ids from the root down
   * to it. Absent (or the root) means the camera is on the root plane. ICE
   * reports every box in the *current* frame's coordinates, so this is what
   * decides whether an entity's box is a box this controller can commit.
   */
  readonly currentFrame?: () => { readonly boardId: string; readonly path: readonly string[] };
  /**
   * The Board a drop landed in, when ICE re-parented the entity into a Board's
   * frame. `null` means the entity stayed on the Board it was placed on.
   */
  readonly containerOf?: (entity: number) => string | null;
  /**
   * The canonical selection. Used to resolve a press on a resize handle, which
   * ICE does not report as an object pick: the handles only exist for the
   * selected card, so a null pick with one selected card is that card's resize.
   * A press that lands on a member of the selection drags the whole selection.
   */
  readonly selection?: () => readonly string[];
  /** Marker entity → the Board it frames, so a drag or a handle writes one rect. */
  readonly boardSlots?: ReadonlyMap<number, IceBoardSlot>;
  /** Marker entity → pin id, so a dragged pin writes one `movePin`. */
  readonly pinSlots?: ReadonlyMap<number, string>;
  /** Writes the pin's new point; one call per gesture. */
  readonly movePin?: (pinId: string, point: { x: number; y: number }) => void;
}

/** A container-relative screen point, CSS px. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

const IDENTITY = { scale: 1, x: 0, y: 0 } as const;

/**
 * The Board frame the camera is inside: the deepest entered Board, or the root
 * View when nothing is entered. The path is the chain of Boards from the root
 * down, which is an instance's render identity.
 */
export function currentFrameOf(
  rootBoardId: string,
  frames: readonly { readonly id: string }[],
): { boardId: string; path: readonly string[] } {
  if (frames.length === 0) return { boardId: rootBoardId, path: [rootBoardId] };
  return {
    boardId: frames[frames.length - 1]?.id ?? rootBoardId,
    path: [rootBoardId, ...frames.map((frame) => frame.id)],
  };
}

/**
 * The instance an entity paints on the frame the camera is inside. The frame's
 * own coordinates are what ICE measures in (`world = board`), so the transform
 * is the identity; `path` names the chain of Boards that produced the instance,
 * because that is its render identity.
 */
export function instanceFor(
  slot: IceEditableSlot,
  path: readonly string[],
  rect: Rect | null,
): IceCardInstance {
  return {
    kind: "card",
    instanceKey: `card:${slot.cardId}`,
    path,
    boardId: slot.boardId,
    transform: IDENTITY,
    geometry: rect ?? { x: 0, y: 0, width: 1, height: 1 },
    cardId: slot.cardId,
    ...(slot.text === undefined ? {} : { text: slot.text }),
  };
}

function toCapabilities(role: IceEditingAdapters["role"]): IceCapabilities {
  return capabilitiesForRole(role);
}

/** The index a gesture resolves through: every instance the gesture carries. */
function indexFor(instances: readonly IceCardInstance[]): IceInstanceIndex {
  return {
    instances,
    byKey: new Map(instances.map((instance) => [instance.instanceKey, instance])),
    byCardId: new Map(instances.map((instance) => [instance.cardId, [instance]])),
    bySectionId: new Map(),
  };
}

/** The single selected card's entity, when ICE reports no object under the press. */
function selectedEntity(options: IceEditingOptions): number | null {
  const selected = options.selection?.() ?? [];
  if (selected.length !== 1) return null;
  const cardId = selected[0];
  if (cardId === undefined) return null;
  for (const [entity, slot] of options.slots) {
    if (slot.cardId === cardId) return entity;
  }
  return null;
}

/**
 * Every card a move carries. A press on a member of the selection drags the
 * whole selection — each card with its own start box — so the planner writes
 * them as one `movePlacements`; a press on anything else drags that card alone.
 */
function gestureCards(
  options: IceEditingOptions,
  entity: number,
  pressed: IceCardInstance,
  rect: Rect,
  boardId: string,
): GestureCard[] {
  const selected = options.selection?.() ?? [];
  if (!selected.includes(pressed.cardId)) return [{ entity, instance: pressed }];
  const wanted = new Set(selected);
  const cards = new Map<string, GestureCard>();
  for (const [candidate, slot] of options.slots) {
    if (slot.boardId !== boardId || !wanted.has(slot.cardId)) continue;
    const box = candidate === entity ? rect : options.rectOf(candidate);
    if (box === null) continue;
    if (!cards.has(slot.cardId)) {
      cards.set(slot.cardId, { entity: candidate, instance: instanceFor(slot, pressed.path, box) });
    }
  }
  return cards.size > 0 ? [...cards.values()] : [{ entity, instance: pressed }];
}

/** A press that never travelled writes nothing, whatever ICE may have done. */
function travelled(from: ScreenPoint, to: ScreenPoint): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) > ICE_POINTER_THRESHOLD;
}

function finitePoint(point: { x: number; y: number }): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** A size change is a resize; sub-pixel drift from the camera is not. */
const SIZE_EPSILON = 0.5;

function sizeChanged(start: Rect, next: Rect): boolean {
  return (
    Math.abs(start.width - next.width) > SIZE_EPSILON ||
    Math.abs(start.height - next.height) > SIZE_EPSILON
  );
}

export interface IceEditingController {
  pointerDown(pointerId: number, screen: ScreenPoint): boolean;
  pointerUp(pointerId: number, screen: ScreenPoint, shiftKey?: boolean, altKey?: boolean): boolean;
  pointerCancel(pointerId: number): void;
  /** Delete the current canonical selection through one plan. */
  deleteSelection(selectedCardIds: readonly string[]): boolean;
  /** Undo/redo go through Loro; ICE history is never used. */
  undo(adapter: IceUndoAdapter): boolean;
  redo(adapter: IceUndoAdapter): boolean;
  cancel(): void;
}

interface GestureCard {
  readonly entity: number;
  readonly instance: IceCardInstance;
}

interface Pending {
  readonly pointerId: number;
  readonly entity: number;
  readonly gesture: IceGestureHandle;
  readonly instance: IceCardInstance;
  /** Every card this drag carries, pressed one included. */
  readonly cards: readonly GestureCard[];
}

interface PendingPin {
  readonly pointerId: number;
  readonly entity: number;
  readonly pinId: string;
  readonly start: Rect;
  travelled: boolean;
}

interface PendingBoard {
  readonly pointerId: number;
  readonly entity: number;
  readonly slot: IceBoardSlot;
  /** The frame's rect in its parent's frame, where the write goes. */
  readonly start: Rect;
  readonly startScreen: ScreenPoint;
}

/**
 * Build the controller. All I/O is injected, so tests drive it with plain
 * functions and the surface drives it with ICE adapters.
 */
export function createIceEditingController(options: IceEditingOptions): IceEditingController {
  let pending: Pending | null = null;
  let pendingPin: PendingPin | null = null;
  let pendingBoard: PendingBoard | null = null;
  const capabilities = toCapabilities(options.role);

  const clear = (): void => {
    pending?.gesture.cancel();
    pending = null;
  };

  const commit = (plan: IcePlan | null): boolean => {
    if (plan === null || plan.status !== "commit" || options.writer === null) return false;
    try {
      applyCanonicalWrite(options.writer, plan.write);
      options.afterCommit?.();
      return true;
    } catch {
      // A refused write leaves the document untouched; the caller reconciles
      // and the entity returns to its canonical box.
      return false;
    }
  };

  return {
    pointerDown(pointerId, screen) {
      if (pending !== null) clear();
      if (!finitePoint(screen)) return false;
      const camera = options.camera();
      if (camera === null) return false;
      const picked = options.pick(screen);
      if (picked !== null) {
        const board = options.boardSlots?.get(picked);
        const boardRect = board === undefined ? null : options.rectOf(picked);
        if (board !== undefined && boardRect !== null) {
          // A Board's mat is a frame, not a card: the gesture moves or resizes
          // the frame itself, and the write is one rect in the parent's frame.
          // ICE reports a child's box in exactly that frame, so it is the rect
          // the document stores, with no origin to remove.
          pendingBoard = {
            pointerId,
            entity: picked,
            slot: board,
            start: boardRect,
            startScreen: screen,
          };
          return true;
        }
        const pinId = options.pinSlots?.get(picked);
        const pinRect = options.rectOf(picked);
        if (pinId !== undefined && pinRect !== null) {
          pendingPin = { pointerId, entity: picked, pinId, start: pinRect, travelled: false };
          return true;
        }
      }
      const entity = picked ?? selectedEntity(options);
      if (entity === null) return false;
      const slot = options.slots.get(entity);
      if (slot === undefined) return false;
      const rect = options.rectOf(entity);
      if (rect === null) return false;

      // ICE reports every box in the frame the camera is inside, and that
      // frame's own coordinates are the ones its placements are stored in. An
      // entity on any other Board cannot be committed from here, so its press
      // is refused rather than moved without a write.
      const frame = options.currentFrame?.() ?? {
        boardId: options.rootBoardId,
        path: [options.rootBoardId],
      };
      if (slot.boardId !== frame.boardId) return false;

      const instance = instanceFor(slot, frame.path, rect);
      const cards = gestureCards(options, entity, instance, rect, frame.boardId);
      const instances = cards.map((card) => card.instance);
      const target: IcePick = { entity, type: "suite.card", instance };
      const gesture = beginGesture({
        pointerId,
        screen,
        target,
        camera,
        capabilities,
        geometry: rect,
        view: rect,
        index: indexFor(instances),
        instanceKeys: instances.map((candidate) => candidate.instanceKey),
      });
      if (gesture === null) return false;
      pending = { pointerId, entity, gesture, instance, cards };
      return true;
    },

    pointerUp(pointerId, screen, shiftKey = false, altKey = false) {
      const board = pendingBoard;
      if (board !== null && board.pointerId === pointerId) {
        pendingBoard = null;
        if (!finitePoint(screen)) return false;
        const box = options.rectOf(board.entity);
        if (box === null) return false;
        // A mat dropped into a Board changes its parent; the re-parent and the
        // frame's box land together, in the new parent's frame.
        const landed = options.containerOf?.(board.entity) ?? null;
        if (
          landed !== null &&
          landed !== board.slot.parentBoardId &&
          travelled(board.startScreen, screen)
        ) {
          return commit(
            planBoardNestCommit(
              { boardId: board.slot.boardId, parentBoardId: landed, geometry: box },
              { capabilities },
            ),
          );
        }
        return commit(
          planBoardRectCommit(
            { boardId: board.slot.boardId, start: board.start, final: box },
            { capabilities },
          ),
        );
      }
      const pin = pendingPin;
      if (pin !== null && pin.pointerId === pointerId) {
        pendingPin = null;
        if (!finitePoint(screen)) return false;
        const finalRect = options.rectOf(pin.entity);
        if (finalRect === null) return false;
        const moved =
          Math.abs(finalRect.x - pin.start.x) > 0.5 || Math.abs(finalRect.y - pin.start.y) > 0.5;
        if (!moved) return false;
        options.movePin?.(pin.pinId, {
          x: finalRect.x + finalRect.width / 2,
          y: finalRect.y + finalRect.height / 2,
        });
        return true;
      }
      const current = pending;
      if (current === null || current.pointerId !== pointerId) return false;
      pending = null;
      if (!finitePoint(screen)) {
        current.gesture.cancel();
        return false;
      }
      // ICE has already applied its snap by pointer-up; the entity's geometry is
      // the final rect, and it is the one that gets committed.
      const finalRect = options.rectOf(current.entity);
      if (finalRect === null) {
        current.gesture.cancel();
        return false;
      }

      const start = current.instance.geometry;
      if (sizeChanged(start, finalRect)) {
        // ICE owns the resize handles; the size delta is the evidence that this
        // gesture resized rather than moved, and position+size land together.
        // The gesture carries the reading the user asked for: Shift reflows at
        // the rung it started on, otherwise the rung follows the box.
        const startScale = current.gesture.typeScale ?? undefined;
        current.gesture.cancel();
        return commit(
          planResizeCommit(
            {
              kind: "resize",
              item: { instance: current.instance, startGeometry: start, finalGeometry: finalRect },
              handle: "se",
              worldDelta: { x: 0, y: 0 },
              reflow: shiftKey && !altKey,
              fit: altKey,
              startScale,
            },
            { capabilities },
          ),
        );
      }

      // A drop ICE reported as entering a Board belongs to that Board: the
      // placement moves from the frame the cards came from to the one they
      // landed in, as one write, in the boxes ICE left them at.
      const landed = options.containerOf?.(current.entity) ?? null;
      if (
        landed !== null &&
        landed !== current.instance.boardId &&
        travelled(current.gesture.startScreen, screen)
      ) {
        const drops: IceDropMove[] = [];
        for (const card of current.cards) {
          const target: string | null =
            card.entity === current.entity
              ? landed
              : (options.containerOf?.(card.entity) ?? card.instance.boardId);
          // The drag landed as a set: every card under the same container goes,
          // and one that did not enter it keeps its in-board move.
          if (target !== landed) continue;
          const box = card.entity === current.entity ? finalRect : options.rectOf(card.entity);
          if (box === null) continue;
          drops.push({ instance: card.instance, geometry: box });
        }
        current.gesture.cancel();
        return commit(planDropCommit({ targetBoardId: landed, items: drops }, { capabilities }));
      }

      return commit(current.gesture.end({ screen, finalGeometry: finalRect }));
    },

    pointerCancel(pointerId) {
      if (pendingBoard !== null && pendingBoard.pointerId === pointerId) {
        pendingBoard = null;
        return;
      }
      if (pendingPin !== null && pendingPin.pointerId === pointerId) {
        pendingPin = null;
        return;
      }
      if (pending === null || pending.pointerId !== pointerId) return;
      clear();
    },

    deleteSelection(selectedCardIds) {
      if (selectedCardIds.length === 0) return false;
      const frame = options.currentFrame?.() ?? {
        boardId: options.rootBoardId,
        path: [options.rootBoardId],
      };
      const instances: IceCardInstance[] = [];
      for (const cardId of selectedCardIds) {
        const found = [...options.slots].find(([, slot]) => slot.cardId === cardId);
        const slot = found?.[1] ?? { cardId, boardId: frame.boardId };
        instances.push(
          instanceFor(slot, frame.path, found === undefined ? null : options.rectOf(found[0])),
        );
      }
      const index: IceInstanceIndex = indexFor(instances);
      const plan = planDeleteGesture({
        index,
        instanceKeys: instances.map((instance) => instance.instanceKey),
        capabilities,
      });
      if (!commit(plan)) return false;
      options.removeCards(selectedCardIds);
      return true;
    },

    undo(adapter) {
      if (!adapter.canUndo()) return false;
      adapter.undo();
      options.afterCommit?.();
      return true;
    },

    redo(adapter) {
      if (!adapter.canRedo()) return false;
      adapter.redo();
      options.afterCommit?.();
      return true;
    },

    cancel() {
      clear();
    },
  };
}

/**
 * Attach the controller to a container's pointer events in the capture phase,
 * so ICE's own pointer adapter cannot swallow the press. Returns the detach.
 */
export function attachIcePointerEditing(
  root: HTMLElement,
  controller: IceEditingController,
): () => void {
  const local = (event: PointerEvent): ScreenPoint | null => {
    const bounds = root.getBoundingClientRect();
    const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    return finitePoint(point) ? point : null;
  };

  const onDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const point = local(event);
    if (point !== null) controller.pointerDown(event.pointerId, point);
  };

  const onUp = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const point = local(event);
    // One frame for ICE to settle the entity at its snapped box, then commit.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (point !== null) {
          controller.pointerUp(event.pointerId, point, event.shiftKey, event.altKey);
        }
      });
    });
  };

  const onCancel = (event: PointerEvent): void => {
    controller.pointerCancel(event.pointerId);
  };

  root.addEventListener("pointerdown", onDown, true);
  root.addEventListener("pointerup", onUp, true);
  root.addEventListener("pointercancel", onCancel, true);

  return () => {
    root.removeEventListener("pointerdown", onDown, true);
    root.removeEventListener("pointerup", onUp, true);
    root.removeEventListener("pointercancel", onCancel, true);
  };
}
