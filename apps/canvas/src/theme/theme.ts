import { DEFAULT_THEME_ID, PRESETS, presetById, type SuiteTheme } from "@suite/theme";

/**
 * Which preset and which mode the canvas draws.
 *
 * Two independent choices: a **preset** is a palette family and a **mode** is how bright to
 * draw it. "Solarized at night" is not a sixth theme, it is Solarized with dark values, so
 * the stored record is a pair and the menu is a list plus a toggle rather than a list of six
 * entries nobody can scan.
 *
 * Both live in `localStorage` because they are device preferences: they change how this
 * screen draws, never what a collaborator sees.
 */
export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

/** The record a person's choice is stored as. */
export interface ThemeChoice {
  readonly preset: string;
  readonly mode: ThemeMode;
}

export const THEME_STORAGE_KEY = "suite.theme";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

/** The preset a stored id names, or the default when it names one this build does not ship. */
export function presetFor(id: unknown): string {
  return typeof id === "string" && presetById(id) !== null ? id : DEFAULT_THEME_ID;
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

/**
 * Read the stored choice.
 *
 * Tolerates the shape this app used before presets existed — a bare `"dark"` string — so a
 * person who chose a mode does not lose it because the record grew a field.
 */
export function readStoredTheme(storage: Pick<Storage, "getItem"> | undefined): ThemeChoice {
  const stored = storage?.getItem(THEME_STORAGE_KEY);
  if (stored === null || stored === undefined) return { preset: DEFAULT_THEME_ID, mode: "system" };
  if (isThemeMode(stored)) return { preset: DEFAULT_THEME_ID, mode: stored };
  try {
    const parsed = JSON.parse(stored) as { preset?: unknown; mode?: unknown };
    return {
      preset: presetFor(parsed.preset),
      mode: isThemeMode(parsed.mode) ? parsed.mode : "system",
    };
  } catch {
    return { preset: DEFAULT_THEME_ID, mode: "system" };
  }
}

/** The preset list, for the menu. */
export function themeOptions(): readonly SuiteTheme[] {
  return PRESETS;
}

/**
 * Paint a theme onto the document.
 *
 * The `.dark` class stays because Tailwind's variant is defined on it and every component
 * uses `dark:` utilities; `data-theme` carries the preset id for a rule that wants to know
 * which family is on, and `data-theme-mode` the resolved mode so a stylesheet never has to
 * ask whether "system" is dark today.
 */
export function applyTheme(
  choice: ThemeChoice,
  mode: ResolvedTheme,
  root: HTMLElement,
  theme: SuiteTheme | null = presetById(choice.preset),
): void {
  const preset = theme ?? presetById(DEFAULT_THEME_ID);
  if (preset !== null) {
    for (const [role, value] of Object.entries(preset[mode])) {
      root.style.setProperty(`--${role}`, value);
    }
  }
  root.classList.toggle("dark", mode === "dark");
  root.dataset.theme = choice.preset;
  root.dataset.themeMode = mode;
  root.style.colorScheme = mode;
}
