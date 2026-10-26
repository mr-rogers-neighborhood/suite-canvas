import { create } from "zustand";

/**
 * The camera preferences a reader keeps between visits (the dot grid).
 *
 * UI state, never document data: two people looking at the same board may want
 * different grids, and nothing here is merged or synced. It outlives a board
 * switch, so it lives beside the store rather than inside a component.
 */

const STORAGE_KEY = "suite.canvas.grid";

function readStoredGrid(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    // Private modes and blocked storage: the default is the useful value.
    return true;
  }
}

function store(value: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value ? "on" : "off");
  } catch {
    // The preference still applies for this visit.
  }
}

interface CameraPrefs {
  /** Whether the board paints its dot grid. */
  gridVisible: boolean;
  toggleGrid: () => void;
}

export const useCameraPrefs = create<CameraPrefs>((set, get) => ({
  gridVisible: readStoredGrid(),
  toggleGrid: () => {
    const next = !get().gridVisible;
    store(next);
    set({ gridVisible: next });
  },
}));
