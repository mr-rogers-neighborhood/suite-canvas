import { useCallback, useRef, useState } from "react";
import { prefersReducedMotion } from "../canvas/localEasing";

export interface LeaveTransition {
  leaving: boolean;
  inRoom: boolean;
  /** Leaves for the launcher, or for another workspace named by its URL. */
  requestLeave: (destination?: string) => void;
}

/**
 * The way out of a workspace: a short fade, then the launcher.
 *
 * Nothing asks first. An in-app dialog and a native tab-close prompt used to stand here
 * whenever the browser held the only copy, and both are gone. The native prompt carries
 * the browser's own wording, so it read as a fault rather than an explanation, and it
 * fired for signed-in readers whose work was already synced — the ladder's "banner" rung
 * covers a browser that cannot promise to keep the copy, which is not the same question
 * as "is this synced". A warning nobody can act on only teaches people to dismiss
 * warnings. Whether this browser keeps the copy is still reported by the storage ladder,
 * in the panel someone opens when they want to know.
 */
export function useLeaveTransition(args: {
  standalone: boolean;
  peerCount: number;
}): LeaveTransition {
  const { standalone, peerCount } = args;
  const [leaving, setLeaving] = useState(false);
  const inRoom = !standalone && peerCount > 0;
  /** Where a leave goes; the launcher unless the reader named a workspace. */
  const destination = useRef("/");

  const goHome = useCallback(() => {
    if (leaving) return;
    const url = destination.current;
    if (prefersReducedMotion()) {
      window.location.assign(url);
      return;
    }
    setLeaving(true);
    window.setTimeout(() => window.location.assign(url), 180);
  }, [leaving]);

  const requestLeave = useCallback(
    (target = "/") => {
      if (leaving) return;
      destination.current = target;
      goHome();
    },
    [leaving, goHome],
  );

  return { leaving, inRoom, requestLeave };
}
