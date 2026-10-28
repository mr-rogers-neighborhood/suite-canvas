import { useEffect } from "react";
import { usePlacementRunStore } from "../placementRun";

/**
 * Ends a finished run's claim on the pointer.
 *
 * A run that places its last card is over, but the *gesture* that placed it is not:
 * the pointer is still down, and React Flow goes on to fire its own connection events
 * before it comes up. So the run leaves a latch behind and this clears it on the first
 * `pointerup`, which is the only event that can honestly say the press is finished.
 *
 * `pointercancel` counts too: a gesture the browser took away (a scroll on a touch
 * device, a lost pointer capture) will never see its own up.
 */
export function useSettledRun(): void {
  const settling = usePlacementRunStore((state) => state.settling);

  useEffect(() => {
    if (!settling) return;
    const settle = () => usePlacementRunStore.getState().settle();
    window.addEventListener("pointerup", settle);
    window.addEventListener("pointercancel", settle);
    return () => {
      window.removeEventListener("pointerup", settle);
      window.removeEventListener("pointercancel", settle);
    };
  }, [settling]);
}
