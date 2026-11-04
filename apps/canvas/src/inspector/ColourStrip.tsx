import { useSurfacePaint } from "../canvas/surfaceContext";

/**
 * A row of colour dots, in the menu and in every panel.
 *
 * The menu drew one inline strip and the container panel drew another: the same markup, the same ring for
 * the value in force, spelled twice. One component means a colour is chosen the same way wherever it is
 * chosen, and the mark that says which one is on cannot drift between the two.
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
  /** A caller's test id, e.g. `container-color-blue`. */
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
