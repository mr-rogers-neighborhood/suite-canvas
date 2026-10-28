import type { CanvasMode } from "./links/linkGesture";

/**
 * What the canvas is *for* (ADR-0064).
 *
 * The second axis. `mode` (place · thread · fan · branch) says what the next click
 * does; purpose says what the reader is doing with the canvas at all. They are
 * separate because they are orthogonal: a run threads as often as an exploration
 * does, and "recording" is not a shape.
 */
export const canvasPurposes = ["explore", "run", "record", "explain", "present"] as const;
export type CanvasPurpose = (typeof canvasPurposes)[number];

/** Human name of each purpose, for menus, labels and the cursor's `title`. */
export const PURPOSE_NAMES: Record<CanvasPurpose, string> = {
  explore: "explore",
  run: "run",
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
 * `run` is not here either, and that is the point of this revision. A run is a queue of
 * cards being placed, and only the library can start one — it is the only surface that
 * *has* the cards to queue. Offering it as a mode meant a reader chose "place a
 * sequence" and was then sent to the library to find one, and it also put a run on the
 * modifier map, where holding Shift to start a thread was read as "run" instead
 * (ADR-0064 amendment). The axis still carries `run`, because the run engine, the
 * cursor and presence all say it; it is simply entered by placing a set, not by
 * choosing a mode.
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
 * A run places a queue and an explanation gathers what is selected; neither can
 * be on at the same time, because both claim the next click. That is the one
 * exclusivity rule the two-axis model needs, and it is stated here rather than in
 * a component.
 */
export function purposeClaimsClicks(purpose: CanvasPurpose): boolean {
  // `explain` claims the click too: what it gathers is what the reader selected, and a
  // click is how the selection is made (ADR-0066 §4).
  return purpose === "run" || purpose === "record" || purpose === "explain";
}

/** The gesture a purpose starts with, when a purpose has a natural one. */
export function initialGestureFor(purpose: CanvasPurpose): CanvasMode | null {
  switch (purpose) {
    case "run":
      // A run is a sequence until the reader says otherwise.
      return "thread";
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
