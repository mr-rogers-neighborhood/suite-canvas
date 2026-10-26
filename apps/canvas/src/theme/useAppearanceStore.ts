import { create } from "zustand";
import {
  APPEARANCE_STORAGE_KEY,
  type Appearance,
  applyAppearance,
  DEFAULT_APPEARANCE,
  readStoredAppearance,
} from "./appearance";

interface AppearanceState {
  appearance: Appearance;
  /** Merge one preference; the rest are untouched. */
  set: (patch: Partial<Appearance>) => void;
  reset: () => void;
}

function paint(appearance: Appearance): Appearance {
  if (typeof document !== "undefined") {
    applyAppearance(appearance, document.documentElement);
  }
  return appearance;
}

const initial = readStoredAppearance(
  typeof window !== "undefined" ? window.localStorage : undefined,
);

/**
 * Reader appearance ([ADR-0071](../../../docs/decisions/0071-style-is-derived-not-configured.md)).
 *
 * Zustand because it is UI state and only UI state — a preference, not a paint on any
 * record. `set` writes through to local storage on every change: a reader who moves the
 * radius slider expects the next reload to still have it, and there is nothing to undo
 * about a device preference.
 */
export const useAppearanceStore = create<AppearanceState>((set, get) => ({
  appearance: initial,

  set: (patch) => {
    const next = paint({ ...get().appearance, ...patch });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(next));
    }
    set({ appearance: next });
  },

  reset: () => {
    const next = paint(DEFAULT_APPEARANCE);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
    }
    set({ appearance: next });
  },
}));

/** Apply the stored preferences at boot, before the first paint of the canvas. */
export function initAppearance(): void {
  paint(useAppearanceStore.getState().appearance);
}
