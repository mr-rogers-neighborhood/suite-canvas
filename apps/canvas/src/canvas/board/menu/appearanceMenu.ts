import type { PaletteSwatch, SurfaceStyle } from "@suite/graph";
import type { ContextMenuItem } from "../../../dialogs/ContextMenu";

/**
 * The appearance branch every menu shares: the colours a click can reach, then
 * the panel for everything else.
 *
 * A right-click is where a reader is when they decide something looks wrong, so
 * the common case (one colour) is one click and the rest is one more. Both write
 * the same record the Style tab writes.
 */
export function appearanceBranch(input: {
  palette: readonly PaletteSwatch[];
  style: SurfaceStyle | undefined;
  at: { x: number; y: number };
  canEdit: boolean;
  target: { kind: "card" | "edge"; id: string };
  onSetSwatch: (swatch: string | null) => void;
  onOpenPanel: (target: {
    kind: "card" | "edge";
    id: string;
    at: { x: number; y: number };
  }) => void;
  label?: string;
}): ContextMenuItem[] {
  if (!input.canEdit) return [];
  return [
    {
      label: input.label ?? "Colour",
      items: [
        {
          label: "Default",
          swatchSelected: input.style?.swatch === undefined,
          onSelect: () => input.onSetSwatch(null),
        },
        ...input.palette.map((swatch) => ({
          label: swatch.name,
          swatch: { light: swatch.light, dark: swatch.dark },
          swatchSelected: input.style?.swatch === swatch.id,
          onSelect: () => input.onSetSwatch(swatch.id),
        })),
      ],
    },
    {
      label: "Appearance\u2026",
      onSelect: () => input.onOpenPanel({ ...input.target, at: input.at }),
    },
  ];
}
