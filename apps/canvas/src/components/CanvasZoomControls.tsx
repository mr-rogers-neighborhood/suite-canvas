/**
 * Canvas zoom controls: two buttons, not a scale.
 *
 * The canvas is infinite, so there is nothing honest to put on a slider: no
 * percentage means anything, and no track has ends. What a scale control would
 * have communicated is already on screen — the cards themselves show how far in
 * you are. So this is the traditional cluster and nothing more: zoom in, zoom
 * out, fit the View, and the graph projection.
 *
 * Hold either button to keep zooming, and the step accelerates the longer it is
 * held: an extent with no floor cannot be crossed at one fixed rate, so the
 * first presses are fine and a long hold covers ground. The cluster sits small
 * on the left, where the inspector cannot cover it.
 */
import { useHoldRepeat } from "./useHoldRepeat";

/**
 * The zoom factor for step `repeat` of a hold: a fine step for the first few,
 * then growing, so holding the button traverses rather than plods.
 */
export function holdZoomFactor(repeat: number): number {
  if (!Number.isFinite(repeat) || repeat <= 0) return 1.25;
  // 1.25, 1.25, 1.32, 1.42, 1.55, 1.7, 1.9, 2.1 … capped so a long hold stays controllable.
  const growth = Math.min(1.8, 1.25 + (repeat - 1) * 0.06 + (repeat - 1) ** 2 * 0.004);
  return growth;
}

export interface CanvasZoomControlsProps {
  /** True while the graph band is active, so the graph control offers the way back. */
  graphActive?: boolean;
  /** `factor` grows while the button is held, so a hold traverses the extent. */
  onZoomIn: (factor: number) => void;
  onZoomOut: (factor: number) => void;
  /** Fly to fit the current View's content. */
  onFitView: () => void;
  /** Enter the graph band, or leave it when `graphActive`. */
  onGraphView: () => void;
  /** Hide the graph control entirely (an empty View has nothing to graph). */
  canGraphView?: boolean;
  /** Screen-reader label for the cluster. */
  label?: string;
}

const BUTTON =
  "flex h-[22px] w-[22px] items-center justify-center rounded border-0 bg-transparent " +
  "text-[var(--ink-muted)] transition-colors hover:bg-black/5 hover:text-[var(--ink)] " +
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 " +
  "focus-visible:outline-[var(--ink-muted)] dark:hover:bg-white/10";

function Icon({ paths }: { paths: readonly string[] }) {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const PLUS = ["M8 3.5v9", "M3.5 8h9"];
const MINUS = ["M3.5 8h9"];
/** Four arrows out of a square: "fit everything". */
const FIT = ["M6 2.5H2.5V6", "M10 2.5h3.5V6", "M6 13.5H2.5V10", "M10 13.5h3.5V10"];
/** A cluster of nodes: the graph band. */
const GRAPH = ["M4 4.5h3v3H4z", "M9 8.5h3v3H9z", "M7 6l2 2.5"];

export function CanvasZoomControls({
  graphActive = false,
  onZoomIn,
  onZoomOut,
  onFitView,
  onGraphView,
  canGraphView = true,
  label = "Canvas zoom",
}: CanvasZoomControlsProps) {
  const inHandlers = useHoldRepeat((repeat) => onZoomIn(holdZoomFactor(repeat)));
  const outHandlers = useHoldRepeat((repeat) => onZoomOut(1 / holdZoomFactor(repeat)));
  return (
    <div
      role="toolbar"
      aria-label={label}
      aria-orientation="vertical"
      data-testid="canvas-controls"
      className="pointer-events-auto flex w-[30px] flex-col items-center gap-0.5 rounded-md border border-[var(--hairline)] bg-[var(--surface)] p-[3px] shadow-md"
    >
      <button
        type="button"
        className={BUTTON}
        aria-label="Zoom in"
        data-testid="canvas-zoom-in"
        {...inHandlers}
      >
        <Icon paths={PLUS} />
      </button>

      <button
        type="button"
        className={BUTTON}
        aria-label="Zoom out"
        data-testid="canvas-zoom-out"
        {...outHandlers}
      >
        <Icon paths={MINUS} />
      </button>

      <span aria-hidden="true" className="my-0.5 h-px w-4 bg-[var(--hairline)]" />
      <button
        type="button"
        className={BUTTON}
        aria-label="Fit view"
        data-testid="canvas-zoom-fit"
        onClick={onFitView}
      >
        <Icon paths={FIT} />
      </button>
      {canGraphView ? (
        <button
          type="button"
          className={`${BUTTON} ${graphActive ? "text-[var(--ink)]" : ""}`}
          aria-label={graphActive ? "Exit graph" : "Graph view"}
          aria-pressed={graphActive}
          title={graphActive ? "Exit graph" : "Graph view"}
          data-testid="canvas-graph-view"
          data-graph-active={graphActive ? "true" : "false"}
          onClick={onGraphView}
        >
          <Icon paths={GRAPH} />
        </button>
      ) : null}
    </div>
  );
}
