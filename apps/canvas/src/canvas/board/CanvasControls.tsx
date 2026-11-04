import { ControlButton, Controls } from "@xyflow/react";
import { ModeControl } from "../links/ModeControl";
import { SelectModeControl } from "../SelectModeControl";

/**
 * The canvas pill: what the next link gesture does, what a selection box picks up, and the camera's
 * one addition to React Flow's own controls.
 *
 * A component rather than a block inside `BoardSurface`, because the surface is the largest file in
 * the board and this is the one part of it that only reads props. Everything else there owns a
 * gesture; this owns three buttons.
 */
export function CanvasControls({
  selectedCount,
  onZoomToSelection,
}: {
  /** How many cards are selected; the zoom-to-selection segment is dead with none. */
  selectedCount: number;
  onZoomToSelection: () => void;
}) {
  return (
    <Controls showInteractive={false}>
      <ModeControl />
      <SelectModeControl />
      {/* Zoom to what is selected, inside the pill React Flow already draws: a readout and a grid
          switch in a second corner stack were a control bar of their own. */}
      <ControlButton
        data-testid="zoom-to-selection"
        aria-label="Zoom to selection"
        title="Zoom to selection"
        disabled={selectedCount === 0}
        onClick={onZoomToSelection}
      >
        {"\u26f6"}
      </ControlButton>
    </Controls>
  );
}
