import { ViewportPortal } from "@xyflow/react";
import { describeExtent, type SelectionExtent } from "./selectionBounds";

/**
 * One box around everything selected.
 *
 * React Flow's own group outline only knows nodes, so a selection that holds a frame looked like a
 * selection of cards. This draws the union of what the reader actually picked, which is why a frame's
 * extent is part of the box and the words beside it say how many of each kind are in there.
 *
 * The box lives in the viewport, so its width and height are flow units and follow the camera. Its
 * edge and its label are constant on the screen instead: the border is divided by the scale and the
 * label is counter-scaled, so the outline stays legible at the distance where a board is read as a
 * shape.
 */
export function SelectionOutline({ extent, zoom }: { extent: SelectionExtent; zoom: number }) {
  const rect = extent.rect;
  const words = describeExtent(extent.counts);
  if (!rect || words === "") return null;

  const unit = 1 / (zoom || 1);
  return (
    <ViewportPortal>
      <div
        data-testid="selection-outline"
        className="selection-outline"
        style={{
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          borderWidth: 1.5 * unit,
        }}
      >
        <span
          className="selection-outline__label"
          data-testid="selection-outline-label"
          // Inside the box's top-left, on the same inset a section's header pill uses, so the words sit
          // below the corner rather than above it: above is where a pill for the frame starting there
          // already is, and a label that covers a pill makes the pill unreachable.
          style={{ transform: `scale(${unit})`, transformOrigin: "left top" }}
        >
          {words}
        </span>
      </div>
    </ViewportPortal>
  );
}
