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
}: HighlightMenuProps) {
  if (annotation === undefined) return null;
  const items: ContextMenuItem[] = [
    {
      label: annotation.cardId === undefined ? "Place on the board" : "Open its card",
      onSelect: onPlace,
    },
    {
      label: "Type",
      // The styles are the types, and each one may carry a template: colour and card type are one concept.
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
    { label: "Remove the highlight", onSelect: onRemove, danger: true },
  ];
  return <ContextMenu x={x} y={y} items={items} onClose={onClose} />;
}
