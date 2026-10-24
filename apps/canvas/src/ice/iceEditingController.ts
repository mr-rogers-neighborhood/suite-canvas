/**
 * The editable-canvas controller: root-board drag, resize and delete, wired to
 * the canonical document through the bridge planners.
 *
 * This module is deliberately free of ICE and React imports so the gesture
 * logic is testable in jsdom and cannot pull the engine into the default
 * bundle. `IceSurface` supplies adapters for the camera, the pick, the geometry
 * and the engine's removal path; everything else is canonical.
 *
 * Contract, in order:
 * - pointer-down records the pressed entity and its start box; nothing writes.
 * - pointer-up reads the entity's box *after* ICE applied its snap, and ends the
 *   gesture with that final rect, so the commit is the snapped geometry.
 * - a press that never travelled, a cancelled pointer and a read-only session
 *   all end without a write.
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
  type IceInstanceIndex,
  type IcePlan,
  type IceUndoAdapter,
  planBoardRectCommit,
  planResizeCommit,
} from "./iceBridge";
import {
  beginGesture,
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
  /** The entity's box in board units (root board: world == board). */
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
  /** The root board whose placements are canonical; one board this phase. */
  readonly rootBoardId: string;
  /**
   * The canonical selection. Used to resolve a press on a resize handle, which
   * ICE does not report as an object pick: the handles only exist for the
   * selected card, so a null pick with one selected card is that card's resize.
   */
  readonly selection?: () => readonly string[];
  /** Marker entity → the Board it frames, so a drag or a handle writes one rect. */
  readonly boardSlots?: ReadonlyMap<number, IceBoardSlot>;
  /**
   * A Board's parent frame origin in world units — the frame's rect is stored
   * in its parent's frame, while ICE reports the mat's box in the world.
   */
  readonly frameOriginOf?: (parentBoardId: string) => { x: number; y: number };
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

/** The instance a root-board entity paints. Root board geometry *is* board geometry. */
export function instanceFor(
  slot: IceEditableSlot,
  rootBoardId: string,
  rect: Rect | null,
): IceCardInstance {
  return {
    kind: "card",
    instanceKey: `card:${slot.cardId}`,
    path: [rootBoardId],
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

/** The one-entity index a gesture resolves through. */
function indexFor(instance: IceCardInstance): IceInstanceIndex {
  return {
    instances: [instance],
    byKey: new Map([[instance.instanceKey, instance]]),
    byCardId: new Map([[instance.cardId, [instance]]]),
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

interface Pending {
  readonly pointerId: number;
  readonly entity: number;
  readonly gesture: IceGestureHandle;
  readonly instance: IceCardInstance;
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
          const origin = options.frameOriginOf?.(board.parentBoardId) ?? { x: 0, y: 0 };
          pendingBoard = {
            pointerId,
            entity: picked,
            slot: board,
            start: {
              x: boardRect.x - origin.x,
              y: boardRect.y - origin.y,
              width: boardRect.width,
              height: boardRect.height,
            },
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

      const instance = instanceFor(slot, options.rootBoardId, rect);
      // ONE instance this phase: a gesture inside a portal is refused until the
      // instance transform is wired, so a nested drag cannot move the wrong board.
      if (slot.boardId !== options.rootBoardId) return false;

      const target: IcePick = { entity, type: "suite.card", instance };
      const gesture = beginGesture({
        pointerId,
        screen,
        target,
        camera,
        capabilities,
        geometry: rect,
        view: rect,
        index: indexFor(instance),
      });
      if (gesture === null) return false;
      pending = { pointerId, entity, gesture, instance };
      return true;
    },

    pointerUp(pointerId, screen, shiftKey = false, altKey = false) {
      const board = pendingBoard;
      if (board !== null && board.pointerId === pointerId) {
        pendingBoard = null;
        if (!finitePoint(screen)) return false;
        const box = options.rectOf(board.entity);
        if (box === null) return false;
        const origin = options.frameOriginOf?.(board.slot.parentBoardId) ?? { x: 0, y: 0 };
        return commit(
          planBoardRectCommit(
            {
              boardId: board.slot.boardId,
              start: board.start,
              final: {
                x: box.x - origin.x,
                y: box.y - origin.y,
                width: box.width,
                height: box.height,
              },
            },
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
      const instances: IceCardInstance[] = [];
      for (const cardId of selectedCardIds) {
        const entity = [...options.slots].find(([, slot]) => slot.cardId === cardId)?.[0];
        instances.push(
          instanceFor(
            { cardId, boardId: options.rootBoardId },
            options.rootBoardId,
            entity === undefined ? null : options.rectOf(entity),
          ),
        );
      }
      const index: IceInstanceIndex = {
        instances,
        byKey: new Map(instances.map((instance) => [instance.instanceKey, instance])),
        byCardId: new Map(instances.map((instance) => [instance.cardId, [instance]])),
        bySectionId: new Map(),
      };
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
