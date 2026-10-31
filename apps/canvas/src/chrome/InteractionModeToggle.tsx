import type { InteractionMode } from "../store/interactionMode";
import { useUiStore } from "../store/useUiStore";

/**
 * One control for what a press on a card does.
 *
 * The same click both reads a card and edits it, so a reader who is panning a board, or
 * one who wants the inspector out of the way while they write, has no way to say so. The
 * control sits beside undo and redo because it is a mode of the document surface, not a
 * setting, and it cycles the three answers in `InteractionMode`:
 *
 * - `inspect`, the default: a press focuses the text and opens the inspector beside it.
 * - `quiet`: a press focuses the text and the panel stays shut.
 * - `locked`: the canvas pans and zooms, and a press on a card does nothing at all.
 *
 * Three icons rather than one icon with a badge, because a mode has to be readable at a
 * glance: an accidental click under `locked` looks like a broken card otherwise.
 */
function ModeIcon({ mode }: { mode: InteractionMode }) {
  if (mode === "locked") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" data-testid="mode-icon">
        <rect
          x="4.5"
          y="9"
          width="11"
          height="7.5"
          rx="1.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M7.5 9V6.6a2.5 2.5 0 0 1 5 0V9"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5" data-testid="mode-icon">
      <rect
        x="2.6"
        y="4"
        width="14.8"
        height="12"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M13.4 4v12" fill="none" stroke="currentColor" strokeWidth="1.4" />
      {mode === "inspect" ? (
        <rect x="13.4" y="4" width="4" height="12" rx="1.4" fill="currentColor" />
      ) : null}
    </svg>
  );
}

const COPY: Record<"inspect" | "quiet" | "locked", { label: string; title: string; next: string }> =
  {
    inspect: {
      label: "Clicking a card opens the inspector",
      title: "Reading: a click opens the inspector beside the text",
      next: "Switch to editing without the inspector",
    },
    quiet: {
      label: "Clicking a card edits it without the inspector",
      title: "Editing: a click puts the caret in the card, the inspector stays shut",
      next: "Lock the canvas so a press does nothing",
    },
    locked: {
      label: "Canvas locked: pan and zoom only",
      title: "Locked: the canvas pans and zooms, nothing is selected or moved",
      next: "Read cards again",
    },
  };

export function InteractionModeToggle() {
  const mode = useUiStore((state) => state.interactionMode);
  const cycle = useUiStore((state) => state.cycleInteractionMode);
  const copy = COPY[mode];

  return (
    <button
      type="button"
      data-testid="interaction-mode"
      data-handbook-region="interaction-mode"
      data-mode={mode}
      aria-label={copy.label}
      // Not a checkbox: "pressed" says only that a mode other than the default is on, so
      // the accent background does not read as a plain on/off switch.
      aria-pressed={mode !== "inspect"}
      title={`${copy.title}. Click to ${copy.next.toLowerCase()}.`}
      className="board-nav-button"
      onClick={cycle}
    >
      <ModeIcon mode={mode} />
    </button>
  );
}
