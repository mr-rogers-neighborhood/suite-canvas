import type { KeyboardEvent } from "react";

const STEP: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };

/**
 * Arrow-key movement for a `role="tablist"`.
 *
 * A tablist is one stop in the tab order: the selected tab carries `tabIndex=0`
 * and the others `-1`, so Tab reaches the strip once and the arrows move
 * inside it. Selection follows focus, which is the automatic-activation pattern
 * every segmented control in this shell uses.
 *
 * `onSelect` receives the index of the tab to activate; the caller moves focus,
 * because only it knows the tab's id.
 */
export function tabKeyDown(
  event: KeyboardEvent<HTMLElement>,
  selectedIndex: number,
  count: number,
  onSelect: (index: number) => void,
): void {
  if (count === 0) return;
  const step = STEP[event.key];
  if (step === undefined && event.key !== "Home" && event.key !== "End") return;

  event.preventDefault();
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? count - 1
        : (selectedIndex + (step ?? 0) + count) % count;
  onSelect(next);
}
