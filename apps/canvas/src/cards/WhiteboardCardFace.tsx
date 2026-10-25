import type { Drawing } from "@suite/graph";
import { WhiteboardPreview } from "./WhiteboardPreview";
import type { SketchDisplayMode } from "./whiteboard";
import "../styles/whiteboard-card.css";

/** A peer with the sketch open: a name and a colour, never a cursor. */
export interface SketchEditor {
  name: string;
  color: string;
}

export interface WhiteboardCardFaceProps {
  drawing: Drawing | null;
  label?: string;
  /** `framed` keeps the card chrome; `seamless` lets the drawing run edge to edge. */
  display?: SketchDisplayMode;
  /** Peers editing this sketch right now; ephemeral, never stored. */
  editors?: readonly SketchEditor[];
  /** Opening the scene is the focus surface's job. */
  onOpen: () => void;
}

/**
 * The "someone is editing this sketch" badge. It carries a name and the peer's
 * colour only — the drawing surface is shared, but carets are not.
 */
export function SketchEditors({
  editors,
  variant = "card",
}: {
  editors: readonly SketchEditor[];
  variant?: "card" | "editor";
}) {
  if (editors.length === 0) return null;
  return (
    <span
      className={`whiteboard-editors whiteboard-editors--${variant}`}
      data-testid="sketch-editors"
      aria-live="polite"
    >
      <span className="whiteboard-editors__label">Editing</span>
      {editors.map((editor) => (
        <span
          key={`${editor.name}:${editor.color}`}
          className="whiteboard-editors__peer"
          data-testid="sketch-editor"
          title={`${editor.name} is editing this sketch`}
        >
          <span
            className="whiteboard-editors__dot"
            aria-hidden="true"
            style={{ backgroundColor: editor.color }}
          />
          {editor.name}
        </span>
      ))}
    </span>
  );
}

/** The canvas face of a sketch card: a live, cheap SVG preview. */
export function WhiteboardCardFace({
  drawing,
  label = "Sketch",
  display = "framed",
  editors = [],
  onOpen,
}: WhiteboardCardFaceProps) {
  const count = drawing?.elements.length ?? 0;
  const seamless = display === "seamless";
  return (
    <div
      className={`whiteboard-card${seamless ? " whiteboard-card--seamless" : ""}`}
      data-testid="whiteboard-card"
      data-display={display}
    >
      <button
        type="button"
        className="whiteboard-card__preview"
        data-testid="whiteboard-card-open"
        aria-label={`Open ${label}`}
        // A sketch opens like a portal: double-click, never a single click. A
        // plain click is React Flow's own select (and shift-click still extends
        // the selection), and the pointerdown is left alone so a drag can start.
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpen();
        }}
        onKeyDown={(event) => {
          // Keyboard users keep a direct way in.
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          onOpen();
        }}
      >
        <WhiteboardPreview
          elements={drawing?.elements ?? []}
          label={`${label} preview`}
          className="whiteboard-card__drawing"
        />
      </button>
      <SketchEditors editors={editors} />
      {seamless ? (
        // Seamless keeps the name, but only while the card is hovered or focused.
        <span className="whiteboard-card__hover-title">{label}</span>
      ) : (
        <footer className="whiteboard-card__footer">
          <span className="whiteboard-card__glyph" aria-hidden="true">
            {"\u25a7"}
          </span>
          <span className="whiteboard-card__title">{label}</span>
          <span className="whiteboard-card__count" title={`${count} elements`}>
            {count}
          </span>
        </footer>
      )}
    </div>
  );
}
