import type { WorkspaceDocument } from "@suite/graph";
import { useCallback, useRef, useState } from "react";
import { prefersReducedMotion } from "../canvas/localEasing";
import {
  createLeavingGuard,
  documentVersion,
  leavingAtRisk,
  shouldWarnBeforeLeaving,
} from "../session/leavingGuard";
import type { ShareSession } from "../session/session";
import { useBeforeUnload } from "../session/useBeforeUnload";
import { useStorageLadder } from "../session/useStorageLadder";

export interface LeaveGuard {
  leaving: boolean;
  leavingPrompt: boolean;
  inRoom: boolean;
  /** Leaves for the launcher, or for another workspace named by its URL. */
  requestLeave: (destination?: string) => void;
  dismissLeavePrompt: () => void;
  leaveAnyway: () => void;
}

/**
 * The leave guard (ADR-0025 amendment). The ladder's own answer is the only
 * condition: anonymous, with no promise that this browser keeps the copy.
 * Another device in the room lets the ladder stay quiet while two people work.
 */
export function useLeaveGuard(args: {
  standalone: boolean;
  peerCount: number;
  signedIn: boolean;
  share: ShareSession | null;
  workspace: WorkspaceDocument;
}): LeaveGuard {
  const { standalone, peerCount, signedIn, share, workspace } = args;
  const [leaving, setLeaving] = useState(false);
  const inRoom = !standalone && peerCount > 0;
  const ladder = useStorageLadder(signedIn, inRoom);
  const leavingGuard = useRef(createLeavingGuard());
  // Set synchronously by a navigation the reader chose, so the native prompt
  // does not ask again during the unload that gesture just started.
  const leavingStarted = useRef(false);
  const [leavingPrompt, setLeavingPrompt] = useState(false);
  // A share is someone else's work: this browser holds a projection, not the only copy.
  const leavingAtOwnRisk = share === null && leavingAtRisk(ladder);

  useBeforeUnload(leavingAtOwnRisk && !leaving, () => !leavingStarted.current);

  /** Where a confirmed leave goes; the launcher unless the reader named a workspace. */
  const destination = useRef("/");

  const goHome = useCallback(() => {
    if (leaving) return;
    leavingStarted.current = true;
    const url = destination.current;
    if (prefersReducedMotion()) {
      window.location.assign(url);
      return;
    }
    setLeaving(true);
    window.setTimeout(() => window.location.assign(url), 180);
  }, [leaving]);

  /** Every path back to the launcher comes through here, so no route skips the guard. */
  const requestLeave = useCallback(
    (target = "/") => {
      if (leaving || leavingPrompt) return;
      destination.current = target;
      const version = documentVersion(workspace.doc);
      if (
        shouldWarnBeforeLeaving({
          ladder,
          guard: leavingGuard.current,
          version,
          applicable: share === null,
        })
      ) {
        setLeavingPrompt(true);
        return;
      }
      goHome();
    },
    [leaving, leavingPrompt, ladder, workspace, share, goHome],
  );

  // Being told is the point, so closing the dialog is an answer: the next leave
  // stays quiet until the work changes.
  const dismissLeavePrompt = useCallback(() => {
    leavingGuard.current.dismiss(documentVersion(workspace.doc));
    setLeavingPrompt(false);
  }, [workspace]);

  const leaveAnyway = useCallback(() => {
    dismissLeavePrompt();
    goHome();
  }, [dismissLeavePrompt, goHome]);

  return { leaving, leavingPrompt, inRoom, requestLeave, dismissLeavePrompt, leaveAnyway };
}
