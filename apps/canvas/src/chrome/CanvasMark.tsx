import { AppMark } from "@suite/ui";

/**
 * The Suite Canvas mark: the Canvas glyph on the suite's accent tile.
 *
 * The glyph is the one this app already ships for its window and menu icon, so a person sees the
 * same shape wherever they meet the app. It used to be `fill="#fff"` in a file of its own, which
 * is why the interface could not use it — white on a light page is nothing, and a second black
 * file was needed for the light mode. Here it inherits `currentColor` from the tile, so one
 * drawing serves every preset.
 *
 * Kept in this app rather than in `@suite/ui` because it *is* the app's identity: the shape is
 * what distinguishes Canvas from Budget, and the tile is what says they are one suite.
 */
const VIEW_BOX = "0 0 24 24";

const GLYPH = [
  "M10 3H4a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1M9 9H5V5h4zm11 4h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1m-1 6h-4v-4h4zM17 3c-2.206 0-4 1.794-4 4s1.794 4 4 4s4-1.794 4-4s-1.794-4-4-4m0 6c-1.103 0-2-.897-2-2s.897-2 2-2s2 .897 2 2s-.897 2-2 2M7 13c-2.206 0-4 1.794-4 4s1.794 4 4 4s4-1.794 4-4s-1.794-4-4-4m0 6c-1.103 0-2-.897-2-2s.897-2 2-2s2 .897 2 2s-.897 2-2 2",
];

export function CanvasMark({
  label,
  size,
  className,
}: {
  readonly label?: string;
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
}) {
  return (
    <AppMark
      viewBox={VIEW_BOX}
      paths={GLYPH}
      {...(label === undefined ? {} : { label })}
      {...(size === undefined ? {} : { size })}
      {...(className === undefined ? {} : { className })}
    />
  );
}
