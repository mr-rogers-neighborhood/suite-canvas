import { useSurfacePaint } from "../canvas/surfaceContext";

/**
 * A row of colour dots, drawn by the context menu.
 *
 * The menu once drew one inline strip and the container panel drew another: the same markup, the same ring
 * for the value in force, spelled twice. One component means a colour is chosen the same way wherever it is
 * chosen. A panel's colour is the Style tab's row, which also carries "None" for a fill and reads Mixed
 * across a selection, so it stays there — but the strip itself is shared wherever a strip is drawn.
 *
 * A swatch carries both theme values and paints the one in force, which is the bug the menu's first strip
 * fixed: setting the light value as a background left every colour in the menu daylight at night.
 */
export interface ColourOption {
  /** What the dot is called: a palette name, or a section colour's name. */
  label: string;
  light: string;
  dark: string;
  selected: boolean;
  onPick: () => void;
  /** A caller's test id, e.g. `menu-colour-blue`. */
  testId?: string | undefined;
}

export function ColourStrip({
  label,
  options,
  disabled = false,
  testId,
  className = "",
}: {
  /** The row's name, read out by a screen reader. */
  label: string;
  options: readonly ColourOption[];
  disabled?: boolean;
  testId?: string | undefined;
  className?: string;
}) {
  const { mode } = useSurfacePaint();
  return (
    <fieldset
      className={`flex flex-wrap items-center gap-1.5 border-0 p-0 ${className}`.trim()}
      aria-label={label}
      data-testid={testId}
    >
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          aria-label={option.label}
          aria-pressed={option.selected}
          disabled={disabled}
          data-testid={option.testId}
          data-checked={option.selected ? "true" : undefined}
          className="h-5 w-5 rounded-full border border-[var(--hairline)] disabled:opacity-40"
          style={{ background: mode === "dark" ? option.dark : option.light }}
          onClick={() => option.onPick()}
        />
      ))}
    </fieldset>
  );
}
