/**
 * Inspector-first landing for the ICE canvas.
 *
 * On the desk the card face is read-only: ICE owns pointer input, and the
 * overlay twin never mounts an editor. So "the user made or selected a card"
 * has to answer a different question than it does on the React Flow surface —
 * not "which editor takes the caret" but "where does typing happen at all":
 *
 * - the inspector is the typing surface for a placed card,
 * - the focus surface stands in when the card has no placement to show,
 * - and a viewer gets neither, because the plan must not offer an edit gesture.
 *
 * The decision is pure so the lead can call it from `App` and `IceSurface`
 * without reaching into the stores from the overlay.
 */

export interface CardLandingInput {
  /** The card that was created or selected; "" means nothing landed. */
  readonly cardId: string;
  /** True for a brand-new card, whose first word is its title. */
  readonly created: boolean;
  /** The session may edit card content, not just layout. */
  readonly canEditContent: boolean;
  /** A viewer session: no inspector, no caret, no focus surface. */
  readonly readOnly: boolean;
  /** False for an unplaced/inbox card, which the canvas cannot show. */
  readonly hasPlacement: boolean;
}

export interface CardLandingPlan {
  /** Open the inspector for this card. */
  readonly openInspector: boolean;
  /** Field the caret should land in, or null to leave the caret alone. */
  readonly startField: "title" | "body" | null;
  /** Route the card through the focus surface instead of the canvas. */
  readonly focusSurface: boolean;
}

/** A viewer's card: every action declined. */
const NO_LANDING: CardLandingPlan = {
  openInspector: false,
  startField: null,
  focusSurface: false,
};

/**
 * Where typing happens after a card was created or selected.
 *
 * A created card asks for its title unless the session cannot write; a selected
 * card opens the inspector without stealing a caret. An unplaced card has no
 * canvas rectangle, so it lands on the focus surface instead of the inspector —
 * the two are mutually exclusive by construction, not by caller discipline.
 */
export function planCardLanding(input: CardLandingInput): CardLandingPlan {
  const { cardId, created, canEditContent, readOnly, hasPlacement } = input;
  // Nothing landed, or the session can only read: never open an edit surface.
  if (cardId.length === 0 || readOnly) return NO_LANDING;

  const startField = created && canEditContent ? "title" : null;

  if (!hasPlacement) {
    // An unplaced card cannot be framed on the canvas; the focus surface is
    // the only place its editors can mount.
    return { openInspector: false, startField, focusSurface: true };
  }

  return { openInspector: true, startField, focusSurface: false };
}
