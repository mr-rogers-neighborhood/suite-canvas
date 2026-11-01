/**
 * How tall a card is, and how much of it the body may claim.
 *
 * Two questions that only look like one. A card holding a passage takes its height from the passage until the reader
 * resizes it, because a sentence is not 240px and clamping the sentence to fit a fixed box was the old compromise. And
 * an empty body must not stretch to fill a box that no longer has spare room, or a passage with no writing under it
 * trails a screenful of blank scroll area.
 *
 * Pure: three facts in, two answers out, so `NodeCard` keeps its own complexity and this is testable on its own.
 */
export interface CardSizingInput {
  /** The card holds a highlight, so its passage is the thing that decided the height. */
  readonly hasPassage: boolean;
  /** The placement's stored height, or null when nobody has resized this card. */
  readonly height: number | null | undefined;
  readonly collapsed: boolean;
  /** The body's plain text, already trimmed by the caller only if it wants to. */
  readonly bodyText: string;
}

export interface CardSizing {
  /** Height comes from the content, so the box is `auto` with a floor. */
  readonly autoHeight: boolean;
  /** The body's scroll area fills the rest of the card. */
  readonly bodyFills: boolean;
  /** The box's height, and a floor when the content decides it. Spread into the card's style. */
  readonly heightStyle: { readonly height: number | "auto"; readonly minHeight?: number };
  /** The body's own growth class, so the card's face does not carry the branch. */
  readonly bodyClass: string;
}

/**
 * The floor for a card whose height comes from its content.
 *
 * Below this it stops being a card: the header, the spine and the two buttons need the room even when the quotation is
 * one short sentence.
 */
export const AUTO_CARD_MIN_HEIGHT = 88;

export function cardSizing(input: CardSizingInput, fallbackHeight: number): CardSizing {
  // A fold wins over everything: a folded card is its header line and the stored height is what unfolds it.
  const autoHeight = input.hasPassage && input.height == null && !input.collapsed;
  // A card with a height the reader chose always offers the body its room, empty or not: that is the surface they sized.
  const bodyFills = !autoHeight || input.bodyText.trim().length > 0;
  return {
    autoHeight,
    bodyFills,
    heightStyle: autoHeight
      ? { height: "auto", minHeight: AUTO_CARD_MIN_HEIGHT }
      : { height: input.height ?? fallbackHeight },
    bodyClass: bodyFills ? "flex-1" : "flex-none",
  };
}
