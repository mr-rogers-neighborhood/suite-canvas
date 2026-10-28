import { useUiStore } from "../../store/useUiStore";
import { canvasModes, MODE_NAMES } from "./linkGesture";

/**
 * The link tool: what a click on a connector does (ADR-0064).
 *
 * Three segments, not a cycle. A cycle makes the reader click twice to learn what they
 * are holding and needs a label that says the *next* value; three segments say what is
 * on and let one click choose any of them. The mode is a link gesture only — it changes
 * nothing about placing cards.
 */
export function ModeControl() {
  const mode = useUiStore((state) => state.mode);
  const setMode = useUiStore((state) => state.setMode);
  // A viewer cannot draw links, so the tool would be three buttons that do nothing.
  const canManageLinks = useUiStore((state) => state.canManageLinks);
  if (!canManageLinks) return null;

  return (
    // Each segment is its own labelled button, so the wrapper needs no role: a
    // `group` here would only be a fieldset an overlay never wanted.
    <div className="link-mode-control" data-testid="link-mode-toggle">
      {canvasModes.map((value) => {
        const active = value === mode;
        return (
          <button
            key={value}
            type="button"
            className="link-mode-control__segment"
            data-testid={`link-mode-${value}`}
            data-mode={value}
            data-active={active ? "true" : undefined}
            aria-pressed={active}
            title={MODE_NAMES[value].title}
            onClick={() => setMode(value)}
          >
            {MODE_NAMES[value].label}
          </button>
        );
      })}
    </div>
  );
}
