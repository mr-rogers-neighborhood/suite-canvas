import { z } from "zod";
import { entityIdSchema } from "./schema.js";

/**
 * What a target can name. Deliberately not `edgeEndpointKinds`: a `link` target
 * names an edge itself, while a link endpoint names a card/board/section an edge
 * points at. Adding a kind is an explicit edit to ADR-0044, because every
 * consumer has to decide how it navigates and how it outlines.
 *
 * `ui` names a region of the shell — the title bar, the dock, the inspector — by the id
 * the handbook registry gives it. It is the one kind that is not in the document: its id
 * is authored in `apps/canvas/src/handbook/regions.ts` and rendered as a
 * `data-handbook-region` attribute, so a region is present exactly when that element is.
 * Nothing navigates to it, and it can never be dead, because the element either exists
 * on this screen or the article simply does not match.
 */
export const targetKinds = ["card", "board", "section", "link", "ui"] as const;

export const targetKindSchema = z.enum(targetKinds);

/**
 * The one primitive every surface uses to mean "this thing" (ADR-0044):
 * presence, follow, goto and the handbook all address a `Target`. It is UI
 * state — published on presence or held in a store — and never written to the
 * document.
 */
export const targetSchema = z.object({
  kind: targetKindSchema,
  id: entityIdSchema,
});

export type Target = z.infer<typeof targetSchema>;

/** Stable identity of a target, usable as a map key or a test id. */
export function targetKey(target: Target): string {
  return `${target.kind}:${target.id}`;
}

/** True when both sides name the same kind of thing with the same id. */
export function sameTarget(left: Target, right: Target): boolean {
  return left.kind === right.kind && left.id === right.id;
}
