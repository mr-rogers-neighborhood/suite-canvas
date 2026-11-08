import { create } from "zustand";
import {
  applyTheme,
  type ResolvedTheme,
  readStoredTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ThemeChoice,
  type ThemeMode,
} from "./theme";

interface ThemeState {
  /** The preset id. */
  preset: string;
  mode: ThemeMode;
  theme: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  setPreset: (preset: string) => void;
}

function prefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function paint(choice: ThemeChoice): ResolvedTheme {
  const theme = resolveTheme(choice.mode, prefersDark());
  if (typeof document !== "undefined") {
    applyTheme(choice, theme, document.documentElement);
  }
  return theme;
}

function store(choice: ThemeChoice): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(choice));
  }
}

const initial = readStoredTheme(typeof window !== "undefined" ? window.localStorage : undefined);

export const useThemeStore = create<ThemeState>((set, get) => ({
  preset: initial.preset,
  mode: initial.mode,
  theme: resolveTheme(initial.mode, prefersDark()),

  setMode: (mode) => {
    const choice = { preset: get().preset, mode };
    store(choice);
    set({ mode, theme: paint(choice) });
  },

  setPreset: (preset) => {
    const choice = { preset, mode: get().mode };
    store(choice);
    set({ preset, theme: paint(choice) });
  },
}));

/**
 * Applies the stored theme immediately and keeps "system" mode in sync with the
 * OS setting. Returns a cleanup function.
 */
export function initTheme(): () => void {
  const { preset, mode } = useThemeStore.getState();
  paint({ preset, mode });

  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const handleChange = () => {
    const state = useThemeStore.getState();
    if (state.mode !== "system") return;
    const theme = paint({ preset: state.preset, mode: "system" });
    useThemeStore.setState({ theme });
  };

  media.addEventListener("change", handleChange);
  return () => media.removeEventListener("change", handleChange);
}
