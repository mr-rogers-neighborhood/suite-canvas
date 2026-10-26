import type { CanvasMode } from "./linkGesture";

/**
 * What the canvas is *for* ([ADR-0064](../../../docs/decisions/0064-two-axes-and-a-cursor-that-says-so.md)).
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
 * The purposes a reader *chooses*, in the order the control walks them.
 *
 * `present` is deliberately missing. A presentation is scoped to a tour: the tour
 * puts the reader in it, and only a tour can, because a mode button that offered
 * "present" would be offering to present nothing — and would be a second, worse
 * way to pick a tour. The axis still *carries* `present`, because the widget, the
 * cursor and presence all have to say it; it just cannot be walked into.
 */
export const choosablePurposes = ["explore", "run", "record", "explain"] as const;

/**
 * The values the modifier map can *preview* on the purpose axis.
 *
 * The same list as `choosablePurposes`, and it stays a separate name because the two
 * answer different questions: one is what the control cycles, the other is what a key
 * can point at. They were different while `explain` was preview-only; the author asked
 * for it to be cycled, so they are the same list and the gate that kept them apart is
 * closed (ADR-0066 amendment).
 */
export const previewablePurposes = choosablePurposes;
export type PreviewablePurpose = (typeof previewablePurposes)[number];

/** The cycle the purpose control walks: explore → run → record → explain → explore. */
export function nextPurpose(purpose: CanvasPurpose): CanvasPurpose {
  // Leaving a presentation is the only move available from it, and it goes to the
  // resting state rather than continuing a cycle the tour never started.
  if (purpose === "present") return "explore";
  const index = choosablePurposes.indexOf(purpose);
  return choosablePurposes[(index + 1) % choosablePurposes.length] ?? "explore";
}

/**
 * True when the gesture axis is read by this purpose.
 *
 * `present` ignores the gesture rather than resetting it, so leaving presentation
 * returns the reader to the tool they had. Every other purpose reads it — in
 * `record` the gesture is the step verb (ADR-0058 amendment).
 */
export function purposeReadsGesture(purpose: CanvasPurpose): boolean {
  return purpose !== "present";
}

/**
 * True when choosing this purpose consumes clicks for its own sake.
 *
 * A run places a queue and a record captures steps; neither can be on at the same
 * time, because both claim the next click. That is the one exclusivity rule the
 * two-axis model needs, and it is stated here rather than in a component.
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
    // `explain` reads the gesture axis and ignores it, the way `present` does: the
    // gesture describes what a link would do, and explain draws nothing.
    case "explain":
    case "explore":
    case "present":
      return null;
  }
}
