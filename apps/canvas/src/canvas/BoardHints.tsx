import "./boardAffordances.css";
import { NUDGE_LARGE_STEP, NUDGE_STEP } from "./nudge";

export interface NudgeHintProps {
  /** How many cards are selected; nothing is shown for an empty selection. */
  count: number;
  /** Lift the hint when the bulk style bar occupies the strip below it. */
  lifted?: boolean;
}

/**
 * The affordance for arrow-key movement: a card can be nudged, and nothing on
 * the board said so.
 *
 * It appears with a selection and disappears with it, so it never competes with
 * the card itself. The numbers are the ones `useBoardKeyboard` applies, read
 * from the same module, so the hint cannot drift from the gesture.
 */
export function NudgeHint({ count, lifted = false }: NudgeHintProps) {
  if (count === 0) return null;
  return (
    <div className={`board-hint${lifted ? " board-hint--lifted" : ""}`} data-testid="nudge-hint">
      <kbd>←</kbd>
      <kbd>↑</kbd>
      <kbd>↓</kbd>
      <kbd>→</kbd>
      <span>move {NUDGE_STEP}</span>
      <span aria-hidden="true">·</span>
      <kbd>Shift</kbd>
      <span>moves {NUDGE_LARGE_STEP}</span>
    </div>
  );
}
