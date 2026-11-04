/**
 * What a selection box picks up.
 *
 * Split out of `useUiStore` for the reason the shape rule exists: that file owns the whole shell's
 * state and reached the file-length limit, so a cohesive slice leaves rather than the file growing.
 * Zustand keeps one store; this module owns the three toggles and the rule that keeps one of them on.
 */

/** The three classes of thing a marquee can collect. */
export type MarqueeSubject = "cards" | "links" | "sections";

export interface MarqueeSlice {
  /**
   * What a box picks up, one toggle per class of thing.
   *
   * A marquee used to box cards, and to sweep up a section link it crossed, with no way to say which
   * of those the reader meant. Three toggles, because a box over a busy board often wants "just the
   * links" or "just the sections", and because "any of them" is a combination rather than a mode to
   * cycle through. All three start on: a box picks up what it crosses unless told otherwise.
   */
  marqueeSelects: { cards: boolean; links: boolean; sections: boolean };
  toggleMarqueeSelect: (subject: MarqueeSubject) => void;
}

export const marqueeInitial = {
  marqueeSelects: { cards: true, links: true, sections: true },
} as const;

export function marqueeActions(
  set: (patch: Partial<MarqueeSlice>) => void,
  get: () => MarqueeSlice,
): Pick<MarqueeSlice, "toggleMarqueeSelect"> {
  return {
    /**
     * The last subject cannot be switched off — a box that picks up nothing does nothing — so
     * `SelectModeControl` answers that press by closing its menu and leaving the subject on, and this
     * guard is the rule underneath it for anything else that calls here.
     */
    toggleMarqueeSelect: (subject) => {
      const current = get().marqueeSelects;
      const next = { ...current, [subject]: !current[subject] };
      if (!next.cards && !next.links && !next.sections) return;
      set({ marqueeSelects: next });
    },
  };
}
