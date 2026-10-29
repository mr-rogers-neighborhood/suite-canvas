import type { DrawingElement } from "@suite/graph";
import { WhiteboardPreview } from "./WhiteboardPreview";
import "../styles/sketch-panel.css";

export interface SketchPanelProps {
  elements: readonly DrawingElement[];
  /** Opens the sketch in the full surface; a read-only session has no such door. */
  onOpen?: (() => void) | undefined;
  label?: string | undefined;
}

/**
 * A sketch's Content tab.
 *
 * A sketch has no text body: what it holds is the drawing, so the tab shows the
 * drawing at the size the panel can hold and opens it on click. The preview is
 * the same SVG the card face paints, so the two cannot disagree about what is in
 * the sketch, and neither pays for Excalidraw to read it.
 */
export function SketchPanel({ elements, onOpen, label = "Sketch" }: SketchPanelProps) {
  const preview = (
    <WhiteboardPreview
      elements={elements}
      label={`${label} preview`}
      className="sketch-panel__drawing"
      // The hint under the frame is this panel's empty state, so the frame itself
      // paints no words: visible text inside a control whose name does not repeat
      // it is the mismatch axe reports.
      showEmptyLabel={false}
    />
  );

  return (
    <div className="sketch-panel" data-testid="sketch-panel">
      {onOpen ? (
        <button
          type="button"
          className="sketch-panel__frame"
          data-testid="sketch-panel-open"
          aria-label={`Open ${label}`}
          title={`Open ${label}`}
          onClick={onOpen}
        >
          {preview}
        </button>
      ) : (
        <div className="sketch-panel__frame sketch-panel__frame--static">{preview}</div>
      )}
      <p className="sketch-panel__hint">
        {elements.length === 0
          ? "Empty sketch"
          : `${elements.length} element${elements.length === 1 ? "" : "s"}`}
        {onOpen ? " · click to draw" : null}
      </p>
    </div>
  );
}
