/**
 * What an entity on the desk *is*, read from the entity itself.
 *
 * The surface spawns the objects a Board holds, but ICE is free to show them in
 * more than one frame: the plane draws a card inside a mat's face, and entering
 * the Board draws it as a member of that frame. A picked entity therefore is not
 * necessarily the one this surface spawned, so an entity → id table built at
 * spawn time answers nothing for a pick inside a Board.
 *
 * The object carries its own coordinates instead: every rung of `suite.card`
 * has a `face` group holding `cardId`/`boardId`, and `suite.board`'s `board`
 * group holds `boardId`. This module is the one lookup that reads those facts,
 * across every rung, so a card the surface never spawned is still a card here.
 *
 * The per-type face lookup is memoised: a resolver called from a rAF loop must
 * not walk the ladder on every call.
 */

import { ChildOf, type Component, type Entity, PrefabId, type World } from "@vibecook/ice";

import type { IceEditableSlot } from "./iceEditingController";
import { SUITE_BOARD_FACE, SUITE_BOARD_TYPE, type SuiteBoardFace } from "./suiteBoardKind";
import { SUITE_CARD_RUNGS } from "./suiteCardKind";
import type { SuiteCardFace } from "./suiteCardOverlay";

/** The workspace card an entity draws, and the Board that placement sits on. */
export interface IceCardIdentity {
  readonly cardId: string;
  readonly boardId: string;
}

/** Prefab type → that rung's face component. Filled once; a rung set is static. */
const cardFaces = new Map<string, Component<SuiteCardFace>>();

/**
 * The `face` group of the card rung `type` names, if the desk knows that rung.
 * `suite.card` has one object per rung and each carries its own component, so a
 * larger card is missable by the base rung's component alone.
 */
export function cardFaceFor(type: string): Component<SuiteCardFace> | undefined {
  const known = cardFaces.get(type);
  if (known !== undefined) return known;
  const rung = SUITE_CARD_RUNGS.find((candidate) => candidate.type === type);
  if (rung === undefined) return undefined;
  cardFaces.set(type, rung.face);
  return rung.face;
}

/** The desk object's own type id, or `undefined` when the entity is gone. */
function typeOf(world: World, entity: Entity): string | undefined {
  try {
    if (!world.isAlive(entity)) return undefined;
    const id = world.read(entity, PrefabId)?.id;
    return id === null || id === undefined || id.length === 0 ? undefined : id;
  } catch {
    return undefined;
  }
}

function readFace<S>(world: World, entity: Entity, face: Component<S>): S | undefined {
  try {
    if (!world.isAlive(entity) || !world.has(entity, face)) return undefined;
    return world.read(entity, face);
  } catch {
    return undefined;
  }
}

/**
 * The card an entity draws, wherever it lives: the `suite.card` rung's own face
 * decides, so a card spawned on any rung answers — on the plane, inside an
 * entered Board, or in a frame this surface never seeded.
 */
export function cardIdOf(world: World, entity: Entity): IceCardIdentity | null {
  const type = typeOf(world, entity);
  if (type === undefined) return null;
  const face = cardFaceFor(type);
  if (face === undefined) return null;
  const value = readFace(world, entity, face);
  if (value === undefined) return null;
  const cardId = value.cardId?.trim() ?? "";
  if (cardId.length === 0) return null;
  return { cardId, boardId: value.boardId ?? "" };
}

/** The Board a mat entity stands for, or `null` when the entity is not one. */
export function matBoardOf(world: World, entity: Entity): string | null {
  if (typeOf(world, entity) !== SUITE_BOARD_TYPE) return null;
  const face = readFace<SuiteBoardFace>(world, entity, SUITE_BOARD_FACE);
  const boardId = face?.boardId.trim() ?? "";
  return boardId.length === 0 ? null : boardId;
}

/**
 * Everything an entity stands for, as one answer: a card, a mat, or nothing.
 * Shared by the pick probes and the gesture hooks that need both facts.
 */
export function identityOf(
  world: World,
  entity: Entity,
): { readonly cardId: string | null; readonly boardId: string | null } {
  const card = cardIdOf(world, entity);
  if (card !== null) return { cardId: card.cardId, boardId: card.boardId };
  return { cardId: null, boardId: matBoardOf(world, entity) };
}

/** How far the container chain is walked: the seed stops at depth 4. */
const MAX_FRAME_DEPTH = 12;

/**
 * The Board whose inside holds this entity — `null` on the root plane.
 *
 * ICE stores a child's position in its own frame's units, so this is what says
 * whether a box is plane coordinates or a Board's: a card inside a Board is
 * frame-local, one on the plane is world, and the two must never be compared.
 */
export function frameBoardOf(world: World, entity: Entity): string | null {
  try {
    if (!world.isAlive(entity)) return null;
    let current: Entity | undefined = world.getRelation(entity, ChildOf);
    for (let depth = 0; depth < MAX_FRAME_DEPTH && current !== undefined; depth += 1) {
      const board = matBoardOf(world, current);
      if (board !== null) return board;
      if (!world.isAlive(current)) return null;
      current = world.getRelation(current, ChildOf);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The slot table the hooks hand a gesture, with the resolver as its fallback.
 *
 * `entitySlots` stays the record of what this surface spawned — that is what
 * reconcile and removal need. But a pick can land on an entity the engine made
 * for a frame this surface did not seed (a Board's inside), and such an entity
 * still *is* a card: its own face says which. Iteration stays the seed's, so
 * removal and reconcile keep seeing exactly the entities they own.
 */
export function identitySlots(
  base: ReadonlyMap<Entity, IceEditableSlot>,
  world: World,
): ReadonlyMap<Entity, IceEditableSlot> {
  const resolve = (entity: Entity): IceEditableSlot | undefined =>
    base.get(entity) ?? cardIdOf(world, entity) ?? undefined;
  return {
    get size() {
      return base.size;
    },
    get: resolve,
    has: (entity) => resolve(entity) !== undefined,
    entries: () => base.entries(),
    keys: () => base.keys(),
    values: () => base.values(),
    forEach: (run, thisArg) => base.forEach(run, thisArg),
    [Symbol.iterator]: () => base[Symbol.iterator](),
  };
}
