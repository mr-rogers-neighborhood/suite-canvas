/**
 * Canvas zoom controls: the traditional cluster, next to the canvas.
 *
 * The bottom dock is Suite's library and card-creation bar; zoom belongs with
 * the canvas it zooms, so it lives here as its own floating cluster — the same
 * affordance the React Flow surface shipped (zoom in, zoom out, fit view) plus
 * one addition, the graph band's entry and exit.
 *
 * Every control here is a *camera action* (ADR-0037): nothing changes the
 * document, and nothing switches a mode. "Graph" flies to the ceiling; while the
 * band is active the same control reads "Exit graph" and flies back to where the
 * user was before they entered.
 *
 * The component is presentational: the surface owns the camera, the ceiling and
 * the return position. It only reports intent.
 */
import { useId } from "react";

export interface CanvasZoomControlsProps {
  /** Live camera zoom; 1 renders as 100%. */
  zoom: number;
  /** True while the graph band is active, so the graph control offers the way back. */
  graphActive?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
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
  "flex h-7 w-7 items-center justify-center rounded-md border-0 bg-transparent text-[var(--ink-muted)] " +
  "transition-colors hover:bg-black/5 hover:text-[var(--ink)] focus-visible:outline " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ink-muted)] " +
  "disabled:cursor-default disabled:opacity-40 dark:hover:bg-white/10";

function Icon({ paths }: { paths: readonly string[] }) {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
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

function percent(zoom: number): string {
  if (!Number.isFinite(zoom) || zoom <= 0) return "100%";
  const value = Math.round(zoom * 100);
  return `${value}%`;
}

export function CanvasZoomControls({
  zoom,
  graphActive = false,
  onZoomIn,
  onZoomOut,
  onFitView,
  onGraphView,
  canGraphView = true,
  label = "Canvas zoom",
}: CanvasZoomControlsProps) {
  const id = useId();
  return (
    <div
      role="toolbar"
      aria-label={label}
      aria-orientation="vertical"
      data-testid="canvas-controls"
      className="pointer-events-auto flex flex-col items-center gap-0.5 rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-1 shadow-lg"
    >
      <button
        type="button"
        className={BUTTON}
        aria-label="Zoom in"
        data-testid="canvas-zoom-in"
        onClick={onZoomIn}
      >
        <Icon paths={PLUS} />
      </button>
      <output
        aria-labelledby={id}
        data-testid="canvas-zoom-label"
        className="w-10 select-none text-center text-[10px] tabular-nums text-[var(--ink-muted)]"
      >
        {percent(zoom)}
      </output>
      <span id={id} className="sr-only">
        Zoom
      </span>
      <button
        type="button"
        className={BUTTON}
        aria-label="Zoom out"
        data-testid="canvas-zoom-out"
        onClick={onZoomOut}
      >
        <Icon paths={MINUS} />
      </button>
      <span aria-hidden="true" className="my-0.5 h-px w-5 bg-[var(--hairline)]" />
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
