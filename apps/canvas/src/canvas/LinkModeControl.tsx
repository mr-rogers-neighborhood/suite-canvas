import { useUiStore } from "../store/useUiStore";

const MODES = [
  {
    id: "connect" as const,
    label: "Connect mode: drag one link at a time",
    glyph: "\u2194",
  },
  {
    id: "thread" as const,
    label: "Thread mode: click connector after connector to chain links",
    glyph: "\u2933",
  },
];

/**
 * The link tool in the viewport widget bar, beside zoom and fit. Thread mode
 * lets a plain click chain links; shift-click does the same in connect mode,
 * which is why the two live together rather than as separate tools.
 */
export function LinkModeControl() {
  const linkMode = useUiStore((state) => state.linkMode);
  const setLinkMode = useUiStore((state) => state.setLinkMode);
  const canCreateContent = useUiStore((state) => state.canCreateContent);

  if (!canCreateContent) return null;

  return (
    <fieldset
      className="link-mode-control"
      aria-label="Link mode"
      data-testid="link-mode"
      // The canvas claims pointerdown for panning and selection and prevents the
      // default, which suppresses the click a nested control would otherwise get.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
      {MODES.map((mode) => {
        const active = linkMode === mode.id;
        return (
          <button
            key={mode.id}
            type="button"
            className={`link-mode-control__button${active ? " is-active" : ""}`}
            aria-pressed={active}
            aria-label={mode.label}
            title={mode.label}
            data-testid={`link-mode-${mode.id}`}
            onClick={() => setLinkMode(mode.id)}
          >
            <span aria-hidden="true">{mode.glyph}</span>
          </button>
        );
      })}
    </fieldset>
  );
}
