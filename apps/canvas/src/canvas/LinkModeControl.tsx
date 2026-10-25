import { useUiStore } from "../store/useUiStore";
import { useLinkThreadStore } from "./linkThread";

const MODES = {
  connect: {
    label: "Connect mode: drag one link at a time",
    next: "Switch to thread mode: click connector after connector to chain links",
    glyph: "\u2194",
  },
  thread: {
    label: "Thread mode: click connector after connector to chain links",
    next: "Switch to connect mode: drag one link at a time",
    glyph: "\u2933",
  },
} as const;

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

  const current = MODES[linkMode];
  const thread = linkMode === "thread";

  // One button that swaps state, not a segmented control: the mode is a toggle,
  // and two buttons implied two independent tools.
  return (
    <button
      type="button"
      className={`link-mode-control${thread ? " is-thread" : ""}`}
      aria-pressed={thread}
      aria-label={thread ? current.label : current.next}
      title={thread ? current.next : current.label}
      data-testid="link-mode-toggle"
      data-mode={linkMode}
      // The canvas claims pointerdown for panning and selection and prevents the
      // default, which suppresses the click a nested control would otherwise get.
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={() => {
        // Turning thread mode off must also disarm whatever the mode armed.
        useLinkThreadStore.getState().clear();
        setLinkMode(thread ? "connect" : "thread");
      }}
    >
      <span aria-hidden="true">{current.glyph}</span>
    </button>
  );
}
