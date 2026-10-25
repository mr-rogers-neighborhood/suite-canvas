/**
 * Arrow-key nudging, planned exactly like a drag.
 *
 * The keyboard is not a second way to move a card. A nudge is a `move` intent
 * with a delta instead of a pointer, handed to the same `planMoveCommit` a drag
 * uses, so the two can never disagree about board coordinates, grouping across
 * Boards, rounding, capability refusal or how many commits one press writes
 * (one). ICE's own arrow keymap (`nudgeSelection`) writes ICE's document and is
 * replaced by an override for that reason — see `iceKeys.ts`.
 *
 * The card shapes here are the surface's own: an entity's committed box in its
 * own Board's units, and the Board it is placed on. Nothing here reads an
 * engine; the gesture hook gathers the boxes and applies the plan.
 */

import {
  type IceCapabilities,
  type IceCardInstance,
  type IceGestureItem,
  type IcePlan,
  planMoveCommit,
} from "./iceBridge";

/** One arrow press moves a card this far, in document units. */
export const ICE_NUDGE_STEP = 1;

/** With Shift: a coarse step for crossing a Board, ten of the fine ones. */
export const ICE_NUDGE_STEP_FAR = 10;

/** A card as the keyboard sees it: identity, Board, and its committed box there. */
export interface IceNudgeCard {
  readonly cardId: string;
  readonly boardId: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The instance a nudge acts on. The box is board-local and the transform is the
 * identity, because that is the frame the placement is written in — the same
 * convention `iceEditingController` uses on the frame the camera is inside.
 */
export function nudgeInstance(card: IceNudgeCard): IceCardInstance {
  return {
    kind: "card",
    instanceKey: `card:${card.cardId}`,
    path: [card.boardId],
    boardId: card.boardId,
    transform: { scale: 1, x: 0, y: 0 },
    geometry: { x: card.x, y: card.y, width: card.width, height: card.height },
    cardId: card.cardId,
  };
}

/**
 * The write a nudge resolves to. A selection that spans Boards moves on each of
 * them in one `movePlacementsMany`, exactly as a drag would; a viewer is
 * refused by the planner, not by a check here.
 */
export function planNudge(input: {
  readonly cards: readonly IceNudgeCard[];
  readonly delta: { readonly x: number; readonly y: number };
  readonly capabilities: IceCapabilities;
}): IcePlan {
  const items: IceGestureItem[] = input.cards.map((card) => ({
    instance: nudgeInstance(card),
    startGeometry: { x: card.x, y: card.y, width: card.width, height: card.height },
  }));
  return planMoveCommit(
    { kind: "move", items, worldDelta: { x: input.delta.x, y: input.delta.y } },
    { capabilities: input.capabilities },
  );
}
