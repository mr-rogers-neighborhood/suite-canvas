import { create } from "zustand";
import {
  applyTheme,
  type ResolvedTheme,
  readStoredTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemeMode,
} from "./theme";

interface ThemeState {
  mode: ThemeMode;
  theme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

function prefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function apply(mode: ThemeMode): ResolvedTheme {
  const theme = resolveTheme(mode, prefersDark());
  if (typeof document !== "undefined") {
    applyTheme(theme, document.documentElement);
  }
  return theme;
}

const initialMode = readStoredTheme(
  typeof window !== "undefined" ? window.localStorage : undefined,
);

export const useThemeStore = create<ThemeState>((set) => ({
  mode: initialMode,
  theme: resolveTheme(initialMode, prefersDark()),

  setMode: (mode) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
    set({ mode, theme: apply(mode) });
  },
}));

/**
 * Applies the stored theme immediately and keeps "system" mode in sync with the
 * OS setting. Returns a cleanup function.
 */
export function initTheme(): () => void {
  apply(useThemeStore.getState().mode);

  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handleChange = () => {
    if (useThemeStore.getState().mode !== "system") return;
    const theme = apply("system");
    useThemeStore.setState({ theme });
  };

  media.addEventListener("change", handleChange);
  return () => media.removeEventListener("change", handleChange);
}
