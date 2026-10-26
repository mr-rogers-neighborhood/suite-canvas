import { ControlButton, useReactFlow, useViewport } from "@xyflow/react";
import { useCameraPrefs } from "./cameraPrefs";
import { prefersReducedMotion } from "./localEasing";
import "./boardAffordances.css";

/** How long a reset zoom takes, unless the reader asked for less motion. */
const ZOOM_RESET_DURATION_MS = 200;

export interface BoardCameraControlsProps {
  /** Whether there is a selection for "zoom to selection" to frame. */
  hasSelection: boolean;
  onZoomToSelection: () => void;
  outlineOpen: boolean;
  onToggleOutline: () => void;
}

/**
 * The camera's own controls, in their own stack beside React Flow's built-in
 * `<Controls>`.
 *
 * Not inside it: that pill is a row of uniform 26px cells (ADR-0071), and a
 * percentage does not fit one. The buttons reuse React Flow's `ControlButton`
 * so they keep the same hit target and focus behaviour.
 *
 * The zoom readout is a button as well as a number: pressing it returns the
 * camera to 100%, which is the most common reason to care about the number.
 */
export function BoardCameraControls({
  hasSelection,
  onZoomToSelection,
  outlineOpen,
  onToggleOutline,
}: BoardCameraControlsProps) {
  const { zoom } = useViewport();
  const { zoomTo } = useReactFlow();
  const gridVisible = useCameraPrefs((state) => state.gridVisible);
  const toggleGrid = useCameraPrefs((state) => state.toggleGrid);
  const percent = Math.round((Number.isFinite(zoom) ? zoom : 1) * 100);
  const duration = prefersReducedMotion() ? 0 : ZOOM_RESET_DURATION_MS;

  return (
    <div
      className="board-camera-controls"
      role="toolbar"
      aria-label="Camera"
      aria-orientation="vertical"
    >
      <ControlButton
        className="board-zoom-readout"
        data-testid="zoom-readout"
        aria-label={`Zoom ${percent} percent. Reset to 100 percent.`}
        title="Zoom. Click to reset to 100%."
        onClick={() => void zoomTo(1, { duration })}
      >
        {percent}%
      </ControlButton>
      <ControlButton
        data-testid="zoom-to-selection"
        aria-label="Zoom to selection"
        title="Zoom to selection"
        disabled={!hasSelection}
        onClick={onZoomToSelection}
      >
        {"\u26f6"}
      </ControlButton>
      <ControlButton
        data-testid="outline-control"
        aria-label="Board outline"
        aria-pressed={outlineOpen}
        title="Board outline ([)"
        onClick={onToggleOutline}
      >
        {"\u2630"}
      </ControlButton>
      <ControlButton
        data-testid="grid-control"
        aria-label="Dot grid"
        aria-pressed={gridVisible}
        title="Dot grid"
        onClick={toggleGrid}
      >
        {"\u25a6"}
      </ControlButton>
    </div>
  );
}
