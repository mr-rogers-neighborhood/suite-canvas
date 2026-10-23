import type { ThemeMode } from "../theme/theme";
import { useThemeStore } from "../theme/useThemeStore";

const OPTIONS: Array<{ mode: ThemeMode; label: string; icon: string }> = [
  { mode: "light", label: "Light", icon: "\u2600" },
  { mode: "dark", label: "Dark", icon: "\u263e" },
  { mode: "system", label: "Auto", icon: "\u25d0" },
];

export function ThemeToggle() {
  const mode = useThemeStore((state) => state.mode);
  const setMode = useThemeStore((state) => state.setMode);

  return (
    <fieldset
      aria-label="Color theme"
      data-testid="theme-toggle"
      data-mode={mode}
      className="segmented h-6"
    >
      {OPTIONS.map((option) => (
        <label
          key={option.mode}
          className="segmented-option"
          data-checked={mode === option.mode}
          data-testid={`theme-${option.mode}`}
        >
          <input
            type="radio"
            name="theme-mode"
            value={option.mode}
            checked={mode === option.mode}
            onChange={() => setMode(option.mode)}
            className="sr-only"
          />
          <span aria-hidden="true">{option.icon}</span>
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}
