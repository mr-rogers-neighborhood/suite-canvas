import type { Drawing } from "@suite/graph";
import { WhiteboardPreview } from "./WhiteboardPreview";
import "../styles/whiteboard-card.css";

export interface WhiteboardCardFaceProps {
  drawing: Drawing | null;
  label?: string;
  /** Opening the scene is the focus surface's job. */
  onOpen: () => void;
}

/** The canvas face of a whiteboard card: a live, cheap SVG preview. */
export function WhiteboardCardFace({
  drawing,
  label = "Whiteboard",
  onOpen,
}: WhiteboardCardFaceProps) {
  const count = drawing?.elements.length ?? 0;
  return (
    <div className="whiteboard-card" data-testid="whiteboard-card">
      <button
        type="button"
        className="whiteboard-card__preview"
        data-testid="whiteboard-card-open"
        aria-label={`Open ${label}`}
        onClick={onOpen}
      >
        <WhiteboardPreview
          elements={drawing?.elements ?? []}
          label={`${label} preview`}
          className="whiteboard-card__drawing"
        />
      </button>
      <footer className="whiteboard-card__footer">
        <span className="whiteboard-card__glyph" aria-hidden="true">
          {"\u25a7"}
        </span>
        <span className="whiteboard-card__title">{label}</span>
        <span className="whiteboard-card__count" title={`${count} elements`}>
          {count}
        </span>
      </footer>
    </div>
  );
}
