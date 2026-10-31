import type { Target } from "@suite/graph";
import { useEffect, useState } from "react";
import { targetElement } from "../canvas/targetElement";
import { boxOf, NO_SPOTLIGHT, type SpotlightBox, spotlightGeometry } from "./spotlightGeometry";

export interface HandbookSpotlightProps {
  /** What the reader is resting on or reading about. */
  target: Target | null;
  /** The row the line starts from, in viewport coordinates. */
  anchor: SpotlightBox | null;
}

/**
 * The line and the outline that say "this article is about that".
 *
 * It is one layer for the whole shell rather than something drawn per row: the reader may be
 * hovering a row in the panel while the outline is on a card behind it, and those two are in
 * different stacking contexts. Fixed coordinates and `pointer-events: none` keep it a reading
 * rather than a control — a line that swallowed a click would make the thing it points at
 * unclickable for as long as the article was open.
 *
 * The element is measured after paint, so a target that is still mounting gets a second look on
 * the next frame instead of no outline at all.
 */
export function HandbookSpotlight({ target, anchor }: HandbookSpotlightProps) {
  const [box, setBox] = useState<SpotlightBox | null>(null);

  useEffect(() => {
    if (!target) {
      setBox(null);
      return;
    }
    let frame = 0;
    let attempts = 0;
    const measure = () => {
      const element = targetElement(target);
      if (!element) {
        setBox(null);
        // Two frames is enough for a panel that is opening in the same commit; more than that
        // turns into a timer nobody can reason about.
        if (attempts < 2) {
          attempts += 1;
          frame = requestAnimationFrame(measure);
        }
        return;
      }
      setBox(boxOf(element.getBoundingClientRect()));
    };
    measure();
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [target]);

  if (!target) return null;

  const geometry = box
    ? spotlightGeometry(anchor, box, {
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      })
    : NO_SPOTLIGHT;

  return (
    <svg
      className="pointer-events-none fixed inset-0 z-[44] h-full w-full"
      data-testid="handbook-spotlight"
      data-target-kind={target.kind}
      data-target-id={target.id}
      data-offscreen={geometry.offscreen ? "true" : undefined}
      aria-hidden="true"
    >
      {geometry.outline ? (
        <rect
          x={geometry.outline.x - 3}
          y={geometry.outline.y - 3}
          width={geometry.outline.width + 6}
          height={geometry.outline.height + 6}
          rx={8}
          fill="none"
          stroke="var(--accent, #5b7cfa)"
          strokeWidth={2}
          strokeDasharray="6 4"
        />
      ) : null}
      {geometry.line ? (
        <line
          x1={geometry.line.x1}
          y1={geometry.line.y1}
          x2={geometry.line.x2}
          y2={geometry.line.y2}
          stroke="var(--accent, #5b7cfa)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      ) : null}
    </svg>
  );
}
