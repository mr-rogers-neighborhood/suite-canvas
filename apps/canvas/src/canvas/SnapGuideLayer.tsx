import { ViewportPortal } from "@xyflow/react";
import type { SnapGuide } from "./snapping";
import "./boardAffordances.css";

/**
 * Alignment guides for a drag that snapped.
 *
 * They are drawn in flow units inside a viewport portal, so they stay on the
 * cards as the camera moves and never take a pointer event of their own.
 */
export function SnapGuideLayer({ guides }: { guides: readonly SnapGuide[] }) {
  if (guides.length === 0) return null;
  return (
    <ViewportPortal>
      {guides.map((guide) => (
        <div
          key={`${guide.axis}:${guide.at}:${guide.start}:${guide.end}`}
          className={`board-snap-guide board-snap-guide--${guide.axis}`}
          data-testid={`snap-guide-${guide.axis}`}
          style={
            guide.axis === "x"
              ? { left: guide.at, top: guide.start, height: guide.end - guide.start }
              : { top: guide.at, left: guide.start, width: guide.end - guide.start }
          }
        />
      ))}
    </ViewportPortal>
  );
}
