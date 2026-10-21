export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "suite.theme";

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

export function resolveTheme(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}

export function readStoredTheme(storage: Pick<Storage, "getItem"> | undefined): ThemeMode {
  const stored = storage?.getItem(THEME_STORAGE_KEY);
  return isThemeMode(stored) ? stored : "system";
}

export function applyTheme(theme: ResolvedTheme, root: HTMLElement): void {
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
}
