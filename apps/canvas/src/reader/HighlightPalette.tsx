import type { AnnotationStyle } from "@suite/graph";

export interface HighlightPaletteProps {
  styles: readonly AnnotationStyle[];
  /** The words that will be highlighted, so the palette can show what it is about to mark. */
  anchor: { readonly quote: string };
  /**
   * Where to draw, in the palette's own coordinate space.
   *
   * Absent puts it at the bottom of the reader, which is where it used to live and is still the honest fallback for a
   * surface that cannot measure: a palette somewhere is better than a palette nowhere.
   */
  at?: { readonly x: number; readonly y: number } | undefined;
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
export function HighlightPalette({ styles, anchor, at, onPick, onDismiss }: HighlightPaletteProps) {
  return (
    <div
      className="reader-palette"
      data-testid="highlight-palette"
      data-positioned={at === undefined ? undefined : "true"}
      role="toolbar"
      aria-label="Highlight"
      // Inline rather than a class, because the point is measured: a stylesheet cannot know where the words are.
      style={at === undefined ? undefined : { left: `${String(at.x)}px`, top: `${String(at.y)}px` }}
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
