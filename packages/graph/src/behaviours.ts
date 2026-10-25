import { z } from "zod";

/**
 * Types the runtime owns.
 *
 * A card of one of these types is a *behaviour* — a drawing surface, a door onto
 * another board, a tour — rather than a kind of note the user authored. They are
 * card types because that is how a card carries a renderer and a field set, but
 * they are never offered as something to author
 * ([ADR-0040](../../../docs/decisions/0040-a-board-and-a-section-are-identities.md),
 * [ADR-0011](../../../docs/decisions/0011-library-dock-and-card-chrome.md) §3).
 *
 * The list lives here rather than in the UI because it is a fact about the model:
 * the library filters by it, Card Settings edits their defaults instead of the
 * type editor, and a new behaviour is added in one place.
 */
export const behaviourTypeIds = ["portal", "whiteboard", "tutorial"] as const;

export type BehaviourTypeId = (typeof behaviourTypeIds)[number];

export const behaviourTypeIdSchema = z.enum(behaviourTypeIds);

const BEHAVIOURS: ReadonlySet<string> = new Set(behaviourTypeIds);

/** True when a type is runtime-owned, so it is a behaviour and not a facet. */
export function isBehaviourType(typeId: string | null | undefined): boolean {
  return typeof typeId === "string" && BEHAVIOURS.has(typeId);
}
