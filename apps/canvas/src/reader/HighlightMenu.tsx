import type { Annotation, AnnotationStyle } from "@suite/graph";
import { ContextMenu, type ContextMenuItem } from "../dialogs/ContextMenu";

/**
 * A highlight's menu.
 *
 * One menu with two ways in — the right-click on a mark, and the actions row on the raised surface — so a reader
 * cannot meet two different action lists for one object. Composed as `ContextMenuItem`s rather than as a bespoke
 * panel, which is how every other menu in the app works and why the submenu, the swatch marks and the keyboard
 * handling come for free.
 */
export interface HighlightMenuProps {
  annotation: Annotation | undefined;
  styles: readonly AnnotationStyle[];
  x: number;
  y: number;
  onClose: () => void;
  /** Open the raised surface, where parts are assigned. */
  onRaise: () => void;
  onStyle: (styleId: string) => void;
  /** Make a card, or open the one this highlight already has. */
  onPlace: () => void;
  onRemove: () => void;
  /** The book, for a citation: a passage on its own is half of what a reader pastes elsewhere. */
  source: { readonly title: string; readonly author: string | null };
}

export function HighlightMenu({
  annotation,
  styles,
  x,
  y,
  onClose,
  onRaise,
  onStyle,
  onPlace,
  onRemove,
  source,
}: HighlightMenuProps) {
  if (annotation === undefined) return null;
  const items: ContextMenuItem[] = [
    {
      label: annotation.cardId === undefined ? "Place on the board" : "Open its card",
      onSelect: onPlace,
    },
    {
      label: "Kind",
      // The kinds are the styles, and each one may carry a template: colour and card type are one concept.
      items: styles.map((style) => ({
        label: style.name,
        swatch: { light: style.color, dark: style.color },
        swatchSelected: style.id === annotation.styleId,
        onSelect: () => onStyle(style.id),
      })),
    },
    { label: "Break it apart…", onSelect: onRaise },
    {
      label: "Copy the words",
      onSelect: () => {
        if (annotation.anchor.kind === "quote")
          void navigator.clipboard?.writeText(annotation.anchor.quote);
        onClose();
      },
    },
    {
      label: "Copy with its source",
      onSelect: () => {
        void navigator.clipboard?.writeText(citationOf(annotation, source));
        onClose();
      },
    },
    { label: "Remove the highlight", onSelect: onRemove, danger: true },
  ];
  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
}

/**
 * A passage as a reader would paste it: the words, then who wrote them and where they are from.
 *
 * The dash and the line break are the whole format. A citation is pasted into a document that already has a look, so
 * anything more elaborate would arrive as noise; a quote with no attribution is the thing this exists to avoid.
 */
export function citationOf(
  annotation: Annotation,
  source: { readonly title: string; readonly author: string | null },
): string {
  const quote = annotation.anchor.kind === "quote" ? annotation.anchor.quote.trim() : "";
  const author = source.author?.trim() ?? "";
  const where = author.length > 0 ? `${author}, ${source.title}` : source.title;
  return quote.length === 0 ? `\u2014 ${where}` : `\u201c${quote}\u201d\n\n\u2014 ${where}`;
}
