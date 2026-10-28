import type { CanvasMode } from "./links/linkGesture";

/**
 * What the canvas is *for* (ADR-0064).
 *
 * The second axis. `mode` says what a link gesture does; purpose says what the
 * reader is doing with the canvas at all. They are separate because they are
 * orthogonal: "recording" is not a shape.
 */
export const canvasPurposes = ["explore", "record", "explain", "present"] as const;
export type CanvasPurpose = (typeof canvasPurposes)[number];

/** Human name of each purpose, for menus, labels and the cursor's `title`. */
export const PURPOSE_NAMES: Record<CanvasPurpose, string> = {
  explore: "explore",
  record: "record",
  explain: "explain",
  present: "present",
};

/**
 * The one purpose a reader *chooses* from the canvas.
 *
 * `explore` is the resting state and needs no button, so the control is a toggle rather
 * than a cycle: it is on when the reader is explaining, off when they are not.
 *
 * `present` is missing for its own reason: a presentation is scoped to a tour, and only
 * a tour can put the reader in one.
 */
export const choosablePurposes = ["explain"] as const;

/** The other value the control offers, and the one it returns to. */
export const RESTING_PURPOSE: CanvasPurpose = "explore";

/** Whether the canvas is in a state the purpose control put it in. */
export function isChosenPurpose(purpose: CanvasPurpose): boolean {
  return purpose === "explain";
}

/**
 * Whether the gesture axis is read by this purpose.
 *
 * Every remaining purpose reads it, and several call sites still ask rather than
 * assume: the gesture describes what a link would do, and `explain` leaves the
 * stored tool alone while drawing nothing with it.
 */
export function purposeReadsGesture(purpose: CanvasPurpose): boolean {
  // `present` ignores the gesture rather than resetting it, so leaving a
  // presentation returns the reader to the tool they had.
  return purpose !== "present";
}

/**
 * True when choosing this purpose consumes clicks for its own sake.
 *
 * An explanation gathers what is selected, and a recording makes a step of the
 * next click. Neither can be on at the same time, because both claim that click.
 * That is the one exclusivity rule the two-axis model needs, and it is stated here
 * rather than in a component.
 */
export function purposeClaimsClicks(purpose: CanvasPurpose): boolean {
  // `explain` claims the click too: what it gathers is what the reader selected, and a
  // click is how the selection is made (ADR-0066 §4).
  return purpose === "record" || purpose === "explain";
}

/** The gesture a purpose starts with, when a purpose has a natural one. */
export function initialGestureFor(purpose: CanvasPurpose): CanvasMode | null {
  switch (purpose) {
    case "record":
      // Recording appends a step per click (ADR-0058 amendment).
      return "thread";
    // `explain` reads the gesture axis and ignores it: the gesture describes what a
    // link would do, and explain draws nothing.
    case "explain":
    case "explore":
    case "present":
      return null;
  }
}
