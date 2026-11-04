/**
 * The tour a reader is in: which tutorial card is playing, at which step, and whether it is being
 * presented.
 *
 * Split out of `useUiStore` for the reason the shape rule exists: that file owns the whole shell's
 * state and reached the file-length limit, so a cohesive slice leaves rather than the file growing.
 * Zustand keeps one store; this module owns these fields, their actions and their prose, and the
 * store spreads the result. Two of the actions also write `purpose`, which the slice states as a
 * field it touches rather than reads: a presentation is scoped to a tour, and `present` without one
 * is a state the reader could not leave (ADR-0064 §11).
 */

import type { CanvasPurpose } from "../canvas/purpose";

/** The one purpose this slice writes. A tour is the only door into `present`. */
export type TourPurpose = "present" | "explore";

/** The store's purpose field, which two of these actions write. */
type PurposeField = { purpose: CanvasPurpose };

export interface TourState {
  /** The tutorial card being played. */
  tutorialId: string;
  /** Index of the step showing; clamped by the panel, which knows the count. */
  stepIndex: number;
  presenting: boolean;
  /** Whether the inspector keeps its controls on screen while presenting. */
  panelOpen: boolean;
}

export interface TourSlice {
  /**
   * The tour being read or authored (ADR-0058).
   *
   * The steps themselves are content on the tutorial card; this is only what one reader is looking
   * at — the same split as `containerInspector` or a selection. `presenting` is what makes the
   * overlay appear; `panelOpen` lets the author keep the controls beside the spotlight while it does.
   */
  tour: TourState | null;
  /** Opens a tutorial's panel without playing it. */
  openTour: (tutorialId: string) => void;
  /** Starts (or resumes) playback from a step. */
  presentTour: (tutorialId: string, stepIndex?: number) => void;
  setTourStep: (stepIndex: number) => void;
  setTourPanelOpen: (open: boolean) => void;
  /** Leaves the tour entirely: closes the panel and the overlay. */
  closeTour: () => void;
}

/** What this slice starts with. */
export const tourInitial = { tour: null };

export function tourActions(
  set: (patch: Partial<TourSlice & PurposeField>) => void,
  get: () => TourSlice & PurposeField,
): Pick<TourSlice, "openTour" | "presentTour" | "setTourStep" | "setTourPanelOpen" | "closeTour"> {
  return {
    openTour: (tutorialId) => {
      const { tour } = get();
      set({
        tour:
          tour?.tutorialId === tutorialId
            ? { ...tour, panelOpen: true }
            : { tutorialId, stepIndex: 0, presenting: false, panelOpen: true },
      });
    },
    presentTour: (tutorialId, stepIndex = 0) => {
      const { tour } = get();
      set({
        // A presentation is scoped to a tour, so starting one is the only way into `present`.
        purpose: "present",
        tour: {
          tutorialId,
          stepIndex: tour?.tutorialId === tutorialId ? tour.stepIndex : Math.max(0, stepIndex),
          presenting: true,
          panelOpen: tour?.tutorialId === tutorialId ? tour.panelOpen : true,
        },
      });
    },
    setTourStep: (stepIndex) => {
      const { tour } = get();
      if (tour) set({ tour: { ...tour, stepIndex: Math.max(0, stepIndex) } });
    },
    setTourPanelOpen: (panelOpen) => {
      const { tour } = get();
      if (tour) set({ tour: { ...tour, panelOpen } });
    },
    // Closing the tour drops the purpose that required it: `present` without a tour is the one
    // state `setPurpose` refuses to enter, so leaving it behind would be a state the reader cannot
    // reach intentionally and cannot leave by choosing it again.
    closeTour: () =>
      set(get().purpose === "present" ? { tour: null, purpose: "explore" } : { tour: null }),
  };
}
