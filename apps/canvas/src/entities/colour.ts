/**
 * Which entities one colour press reaches.
 *
 * A selection is three lists — cards (portals included, a portal is a card record), links and
 * frames — and each kind stores colour in its own field. This says whose fields to write; the
 * command that owns the document does the writing, so "colour all of it" is one answer rather
 * than a branch per kind in the menu and again in the inspector.
 */
export interface ColourPlan {
  cards: string[];
  edges: string[];
  sections: string[];
}

/** The ids a plan reads; a `SelectionSubject` satisfies it as it stands. */
export interface ColourSelection {
  nodeIds: readonly string[];
  edgeIds: readonly string[];
  sectionIds: readonly string[];
}

export function colourPlan(selection: ColourSelection): ColourPlan {
  return {
    cards: [...selection.nodeIds],
    edges: [...selection.edgeIds],
    sections: [...selection.sectionIds],
  };
}

/** Whether a press has anything to write. An empty selection is not a colour change. */
export function colourPlanIsEmpty(plan: ColourPlan): boolean {
  return plan.cards.length === 0 && plan.edges.length === 0 && plan.sections.length === 0;
}
