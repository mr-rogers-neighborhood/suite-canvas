import type { AnnotationStyle } from "@suite/graph";

export interface HighlightPaletteProps {
  styles: readonly AnnotationStyle[];
  /** The words that will be highlighted, so the palette can show what it is about to mark. */
  anchor: { readonly quote: string };
  onPick: (styleId: string) => void;
  onDismiss: () => void;
}

/**
 * The four colours, over the words a reader just selected.
 *
 * Four rather than a picker: a reader who has selected a sentence wants to mark it, not to choose a hue, and
 * four is what fits above a selection without covering it. The palette is data, so a workspace can rename them
 * and later point one at a template.
 */
export function HighlightPalette({ styles, anchor, onPick, onDismiss }: HighlightPaletteProps) {
  return (
    <div
      className="reader-palette"
      data-testid="highlight-palette"
      role="toolbar"
      aria-label="Highlight"
    >
      {styles.map((style) => (
        <button
          key={style.id}
          type="button"
          className="reader-palette-color"
          data-testid={`highlight-${style.id}`}
          aria-label={style.name}
          title={`${style.name}: ${anchor.quote.slice(0, 60)}`}
          style={{ background: style.color }}
          onClick={() => onPick(style.id)}
        />
      ))}
      <button
        type="button"
        className="views-icon-button"
        aria-label="Dismiss"
        data-testid="highlight-dismiss"
        onClick={onDismiss}
      >
        {"\u00d7"}
      </button>
    </div>
  );
}
