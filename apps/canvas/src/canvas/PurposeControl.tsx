import { useUiStore } from "../store/useUiStore";
import { RESTING_PURPOSE } from "./purpose";

/**
 * The purpose control (ADR-0064): one button, one choice.
 *
 * It used to cycle through three values and take a modifier preview from the same key
 * map the link tool uses. Both went away.
 *
 * What is left is the one purpose a reader chooses: `explain`, which gathers the
 * selection into a context. Off is the canvas as usual, so this is a toggle and its
 * label says which way it will go.
 *
 * A tour and a presentation are states the canvas is *in* rather than choices, so this
 * control neither offers nor shows them: the tour's own widget is their control, and a
 * second one here would be a second way out of a state whose exit is already on screen.
 */
export function PurposeControl() {
  const purpose = useUiStore((state) => state.purpose);
  const setPurpose = useUiStore((state) => state.setPurpose);

  // A presentation and a recording are different from a chosen purpose: the widget *is*
  // the way out of those, because the surface that took the canvas over has no other exit
  // on screen (ADR-0064 §11).
  const explaining = purpose === "explain";
  const stateLabel =
    purpose === "present"
      ? "Presenting a tour. Stop presenting and return to the canvas"
      : purpose === "record"
        ? "Record mode: capture steps into a tour. Stop recording and return to the canvas"
        : null;
  const label =
    stateLabel ??
    (explaining
      ? "Stop explaining: return to the canvas"
      : "Explain mode: gather this selection into a context");

  return (
    <button
      type="button"
      className="purpose-control"
      aria-pressed={explaining || purpose === "present" || purpose === "record"}
      aria-label={label}
      title={label}
      data-testid="purpose-toggle"
      data-purpose={purpose}
      // The canvas claims pointerdown for panning and selection and prevents the
      // default, which suppresses the click a nested control would otherwise get.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={() => {
        // Present and record have no way in from here — only a tour can put the reader in
        // one — so a click on them is the exit and nothing else.
        if (purpose === "present" || purpose === "record") setPurpose(RESTING_PURPOSE);
        else setPurpose(explaining ? RESTING_PURPOSE : "explain");
      }}
    >
      <span aria-hidden="true">
        {purpose === "present" ? "\u25a3" : purpose === "record" ? "\u25cf" : "\u25c8"}
      </span>
    </button>
  );
}
