import type { SurfaceStyle, WorkspaceDocument } from "@suite/graph";
import type { ColourPlan } from "../../entities/colour";
import { mergeStylePatch } from "../styleTargets";

/** The palette id a card wears, so a write keeps every key the style already had. */
export type CardStyles = ReadonlyMap<string, { style?: SurfaceStyle | undefined }>;

/**
 * One colour, written to every entity in a plan.
 *
 * Each kind stores colour in its own field, so this is the one place that knows which: a card and
 * a portal write `style.swatch`, a link writes its own `style.swatch`, a frame writes `color`. The
 * whole loop is one `workspace.batch`, which is what makes a press on a mixed selection one undo
 * step rather than one per entity — the same rule `useStyleDraft` writes a multi-target patch by.
 */
export function writeSelectionColour(
  workspace: WorkspaceDocument,
  plan: ColourPlan,
  swatch: string | null,
  cards: CardStyles,
): void {
  // `mergeStylePatch` is the one rule for "a key left out keeps, `undefined` clears": a record
  // that ends up naming nothing is removed rather than stored, so Default and never-set agree.
  const paint = (style: SurfaceStyle | undefined) =>
    mergeStylePatch(style, swatch === null ? { swatch: undefined } : { swatch });
  workspace.batch("struct:colour", () => {
    for (const id of plan.cards) {
      workspace.setCardStyle(id, paint(cards.get(id)?.style));
    }
    for (const id of plan.edges) workspace.setEdgeStyle(id, paint(workspace.getEdge(id)?.style));
    for (const id of plan.sections) workspace.setSectionColor(id, swatch);
  });
}
