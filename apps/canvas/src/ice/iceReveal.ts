/**
 * Revealing an object: the Board doorway, then the camera.
 *
 * `focusCard`/`focusSection` in the shell are one request — "show me this" — and
 * on a nested desk that is two movements: stand in the frame the object lives in
 * (a Board is a doorway, ADR-0039), then fly the camera to its box. This module
 * is the planning half of that, with no engine and no React: it says which Board
 * chain has to be entered and which entity to frame. `useIceBoardGesture` does
 * the entering and the flight.
 *
 * The plan is deliberately honest about what it cannot do:
 *
 * - a Board this seed never drew (a peer's new Board, before a reconcile, or a
 *   Board that was deleted) has no mat and therefore no path — `null`, and the
 *   caller clears the request rather than flying somewhere arbitrary;
 * - a card that is not on the desk at all (an inbox card, a trashed card) has
 *   no slot — also `null`.
 *
 * ## The camera
 *
 * A reveal is a fit, not a zoom-to-100%: the object's box is centred and scaled
 * to sit inside the viewport with a little air around it, and never past 1×, so
 * a small card does not fill the screen and a large Board still reads whole.
 * The framing is the same convention the rest of the surface speaks
 * (`screen = (world - camera) * zoom`, `iceSurfaceCamera.ts`).
 */

import type { Entity } from "@vibecook/ice";

import type { FlightCamera, FlightViewport } from "./iceCameraFlight";
import { clampZoom } from "./iceSurfaceCamera";
import type { BoardMat } from "./iceSurfaceSpawns";

/** A world box, in whatever frame the camera is currently inside. */
export interface RevealRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What the shell asked to reveal; the store's `FocusTarget` satisfies it. */
export interface RevealTarget {
  readonly kind: "card" | "section";
  readonly id: string;
}

/** A card instance the desk holds: the entity, and the Board it is placed on. */
export interface RevealSlot {
  readonly cardId: string;
  readonly boardId: string;
}

/** The Board chain (root-exclusive) that has to be entered to stand in `boardId`. */
export function boardPathTo(input: {
  readonly rootBoardId: string;
  readonly boardId: string;
  readonly mats: ReadonlyMap<Entity, BoardMat>;
}): readonly string[] | null {
  const { rootBoardId, mats } = input;
  // parent by board id; a duplicate id keeps the mat the projection planted.
  const parentOf = new Map<string, string>();
  for (const mat of mats.values()) {
    if (!parentOf.has(mat.boardId)) parentOf.set(mat.boardId, mat.parentBoardId);
  }
  if (input.boardId === rootBoardId) return [];
  const path: string[] = [];
  let boardId: string | undefined = input.boardId;
  // A cycle cannot exist in the document (containment is a tree), but a hand
  // written fixture could name one, and a reveal must never loop the tab.
  while (boardId !== undefined && boardId !== rootBoardId && path.length < 32) {
    if (!parentOf.has(boardId)) return null;
    path.unshift(boardId);
    boardId = parentOf.get(boardId);
  }
  return boardId === rootBoardId ? path : null;
}

/** The mat entity that draws `boardId`, when this seed drew one. */
export function boardMatEntity(
  mats: ReadonlyMap<Entity, BoardMat>,
  boardId: string,
): Entity | null {
  for (const [entity, mat] of mats) {
    if (mat.boardId === boardId) return entity;
  }
  return null;
}

/**
 * What a reveal has to enter and frame.
 *
 * A **card** is framed where it is placed: its own slot names the Board, and the
 * chain down to that Board is the doorway. A **section** is a Board, drawn by
 * its mat on its *parent's* plane — so the chain ends above it, and the mat is
 * the entity to frame. (Framing the Board by entering it would show its
 * interior, which is a different request: "enter" is a double click.)
 */
export function revealPlan(input: {
  readonly target: RevealTarget;
  readonly rootBoardId: string;
  readonly mats: ReadonlyMap<Entity, BoardMat>;
  readonly slots: Iterable<readonly [Entity, RevealSlot]>;
}): { readonly path: readonly string[]; readonly entity: Entity } | null {
  if (input.target.kind === "card") {
    for (const [entity, slot] of input.slots) {
      if (slot.cardId !== input.target.id) continue;
      const path = boardPathTo({
        rootBoardId: input.rootBoardId,
        boardId: slot.boardId,
        mats: input.mats,
      });
      return path === null ? null : { path, entity };
    }
    return null;
  }

  const entity = boardMatEntity(input.mats, input.target.id);
  if (entity === null) return null;
  const mat = input.mats.get(entity);
  if (mat === undefined) return null;
  const path = boardPathTo({
    rootBoardId: input.rootBoardId,
    boardId: mat.parentBoardId,
    mats: input.mats,
  });
  return path === null ? null : { path, entity };
}

/**
 * Where a click on the desk should take the reader, when it hit a pin marker.
 *
 * A pin's marker is drawn by the GPU with a screen-space label, so a click on it
 * arrives as a plain pick: the entity tells us *which* pin (the seed's map), and
 * the document tells us where it is. `null` for every other pick — a card, a
 * mat, empty desk — because those clicks belong to their own gestures.
 */
export function pinFocusPoint(input: {
  readonly entity: Entity | null;
  /** Pin id → the marker entity the projection spawned for it. */
  readonly pinEntities: ReadonlyMap<string, Entity>;
  /** The document's pin, by id: the place the marker stands for. */
  readonly pinOf: (pinId: string) => { readonly x: number; readonly y: number } | undefined;
}): { x: number; y: number } | null {
  if (input.entity === null) return null;
  let pinId: string | undefined;
  for (const [id, entity] of input.pinEntities) {
    if (entity === input.entity) {
      pinId = id;
      break;
    }
  }
  if (pinId === undefined) return null;
  const pin = input.pinOf(pinId);
  if (pin === undefined) return null;
  if (!Number.isFinite(pin.x) || !Number.isFinite(pin.y)) return null;
  return { x: pin.x, y: pin.y };
}

/** Air kept around a revealed box, as a fraction of the viewport per side. */
export const REVEAL_PADDING = 0.12;

/**
 * The camera that centres `rect` in `viewport`.
 *
 * `null` when there is nothing usable to plan with: a degenerate viewport
 * (before the first layout), or a non-finite box (a stale entity). A box with a
 * zero side is still frameable — a marker, a collapsed Board — because the fit
 * only needs one of the two axes to carry it.
 */
export function revealCamera(input: {
  readonly rect: RevealRect;
  readonly viewport: FlightViewport | null;
}): FlightCamera | null {
  const { rect, viewport } = input;
  if (viewport === null) return null;
  const { width, height } = viewport;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  if (![rect.x, rect.y, rect.width, rect.height].every((value) => Number.isFinite(value))) {
    return null;
  }
  const usableWidth = width * (1 - 2 * REVEAL_PADDING);
  const usableHeight = height * (1 - 2 * REVEAL_PADDING);
  const fit = Math.min(
    rect.width > 0 ? usableWidth / rect.width : Number.POSITIVE_INFINITY,
    rect.height > 0 ? usableHeight / rect.height : Number.POSITIVE_INFINITY,
  );
  // Nothing frameable on either axis: keep the scale the reader had, rather
  // than dividing by zero.
  const zoom = clampZoom(Number.isFinite(fit) ? Math.min(fit, 1) : 1);
  return {
    x: rect.x + rect.width / 2 - width / (2 * zoom),
    y: rect.y + rect.height / 2 - height / (2 * zoom),
    zoom,
  };
}
