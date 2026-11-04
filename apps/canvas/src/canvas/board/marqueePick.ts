/**
 * What a finished selection box selects, given the reader's three toggles.
 *
 * React Flow reports every card it touched whatever the reader meant, the card links are React
 * Flow edges the pane's own box never selects, and a section link is canvas geometry neither of
 * them knows about. So the commit has to decide from what the box caught, and the decision is
 * worth its own function because it is the whole feature.
 *
 * A section joins the selection rather than replacing it. It is the frame the reader drew the box
 * inside, so a box that sweeps a whole section should say so as well as saying which cards it
 * caught; dropping the cards would answer a question nobody asked, and having the section swallow
 * the box would make "everything" mean "cards, unless they happen to sit in a frame".
 *
 * `sectionAlone` is what the caller needs for the panel: a section caught with nothing else is the
 * whole selection and owns the inspector, while one caught alongside cards is a frame around them
 * and must leave the card panel where it is.
 */

/** The reader's toggles, as `marqueeSelects` holds them. */
export interface MarqueeSubjects {
  cards: boolean;
  links: boolean;
  sections: boolean;
}

/** A section the box touched, with the area it covers in flow units. */
export interface TouchedSection {
  id: string;
  area: number;
}

/** Everything the box caught, before the toggles are applied. */
export interface MarqueeCatch {
  cardIds: readonly string[];
  linkIds: readonly string[];
  touchedSections: readonly TouchedSection[];
}

export interface MarqueeSelection {
  cardIds: readonly string[];
  linkIds: readonly string[];
  /**
   * Every frame the box touched that the toggle allows, innermost first.
   *
   * A box that crosses an outer frame and the frame inside it means both: a reader who wants them to
   * travel together has one gesture for it. The innermost is last so the panel describes the most
   * specific frame, matching how a press picks one.
   */
  sectionIds: readonly string[];
  /** True when the box caught frames and nothing else, so a frame is the whole selection. */
  sectionAlone: boolean;
}

/** Frames largest first, so the innermost is last: the order a set is read and described in. */
function bySizeDescending(sections: readonly TouchedSection[]): string[] {
  return [...sections]
    .sort((a, b) => b.area - a.area || a.id.localeCompare(b.id))
    .map((section) => section.id);
}

export function pickMarqueeSelection(
  subjects: MarqueeSubjects,
  caught: MarqueeCatch,
): MarqueeSelection {
  const cardIds = subjects.cards ? caught.cardIds : [];
  const linkIds = subjects.links ? caught.linkIds : [];
  const sectionIds = subjects.sections ? bySizeDescending(caught.touchedSections) : [];
  return {
    cardIds,
    linkIds,
    sectionIds,
    sectionAlone: sectionIds.length > 0 && cardIds.length === 0 && linkIds.length === 0,
  };
}
