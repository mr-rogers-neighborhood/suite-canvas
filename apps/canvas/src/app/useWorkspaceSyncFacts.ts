import { useCallback, useEffect, useRef, useState } from "react";
import { refreshCredential } from "../auth/credential";
import type { AccountPhase } from "../auth/useAccountStore";
import type { SyncClaim, SyncRefusal } from "../feedback/syncState";
import { readSyncRefusal } from "../session/syncAccess";
import { claimWorkspaceForAccount } from "../session/workspaceClaim";
import type { ConnectionStatus } from "../store/useCanvasStore";

/**
 * What this page can honestly say about a workspace's place in the account.
 *
 * Two questions, each asked once per page. May the account hold this workspace —
 * answered by the control plane, the only place that knows whether the plan
 * covers another one. And if the relay refused a join, why — answered by the
 * relay, the only place that knows.
 *
 * Two things it must not do. A share visitor is not the owner: their session may
 * belong to another account entirely, so a shared workspace is never claimed on
 * their behalf. And a claim that could not be made is retried when the connection
 * comes back, rather than being remembered as a failure for the life of the tab.
 */
export interface WorkspaceSyncFacts {
  claim: SyncClaim;
  reason: SyncRefusal | null;
  /**
   * Asks the control plane again, and rejoins the room if it says yes.
   *
   * The claim settles once per page, which is right for a workspace that will not change
   * hands. It is wrong for the one moment a person can change the answer themselves: they
   * paid. Checkout returns to this URL as a full load, so the common path re-mounts and
   * re-claims for free. Paying in a second tab, or coming back to a tab that was already
   * open, has no such moment, and without this the badge keeps offering plans to somebody
   * who has just bought one.
   */
  reclaim: () => void;
}

export interface SyncFactsInput {
  workspaceId: string;
  phase: AccountPhase;
  status: ConnectionStatus;
  workspaceName?: string | undefined;
  /** True for a share link, which is somebody else's workspace. */
  shared?: boolean;
}

export function useWorkspaceSyncFacts(input: SyncFactsInput): WorkspaceSyncFacts {
  const { workspaceId, phase, status, workspaceName, shared = false } = input;
  const [claim, setClaim] = useState<SyncClaim>("unknown");
  const [reason, setReason] = useState<SyncRefusal | null>(null);
  const [_attempt, setAttempt] = useState(0);
  // Set once the control plane has answered; a no-op claim is not worth repeating.
  const settled = useRef(false);
  // Set for the duration of one claim. The effect runs twice in React's strict mode
  // and the two runs race: both read an unanswered control plane, both post, and the
  // loser is told its own workspace belongs to somebody else. One claim, one answer.
  const claiming = useRef(false);
  const askedWhy = useRef(false);

  const claimable = phase === "signed-in" && !shared && workspaceId.length > 0;

  useEffect(() => {
    if (phase === "signed-out") setClaim("local");
  }, [phase]);

  // The claim itself, callable from an effect and from a person pressing a button. It
  // returns whether the workspace is now in the account, which is the only answer worth
  // handing back: every other outcome leaves the local copy exactly where it was.
  const runClaim = useCallback(async (): Promise<void> => {
    if (!claimable || claiming.current) return;
    claiming.current = true;
    try {
      // The claims in the token are the limits the relay enforces, so a token minted
      // before a payment argues with the account that has just bought one: the claim says
      // the workspace is held, and the join is refused for want of a ceiling that is now
      // there. Asking for a fresh one is the difference between "I have paid, retry"
      // working and that button being unable to work for the rest of the token's five
      // minutes.
      await refreshCredential();
      const outcome = await claimWorkspaceForAccount({
        workspaceId,
        ...(workspaceName === undefined ? {} : { name: workspaceName }),
      });
      if (outcome === "unavailable") return;
      settled.current = true;
      setClaim(outcome === "capped" ? "capped" : outcome === "elsewhere" ? "elsewhere" : "claimed");
      if (outcome !== "claimed") return;
      // The relay refused this room when there was no licence behind it. Now there is one,
      // so the join that was refused has to be attempted again, or the badge says Synced
      // over a socket that is still closed. Loaded on demand: the account store must not
      // pull the document store in at import time.
      const { useCanvasStore } = await import("../store/useCanvasStore");
      useCanvasStore.getState().rejoin();
    } finally {
      claiming.current = false;
    }
  }, [claimable, workspaceId, workspaceName]);

  // `_attempt` is the retry counter and the trigger, not an input the claim reads: bumping
  // it is what makes this effect ask again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the counter is the trigger
  useEffect(() => {
    if (!claimable || settled.current) return;
    void runClaim();
  }, [claimable, runClaim, _attempt]);

  // Bumping the counter is the whole of it: the effect above owns running the claim, so
  // there is exactly one path to the control plane rather than two racing ones.
  const reclaim = useCallback(() => {
    if (!claimable) return;
    settled.current = false;
    askedWhy.current = false;
    setReason(null);
    setAttempt((count) => count + 1);
  }, [claimable]);

  // A first claim made while offline is worth one more try once there is a
  // connection, which is the moment it can succeed.
  useEffect(() => {
    if (!claimable || settled.current || status !== "connected") return;
    setAttempt((count) => count + 1);
  }, [claimable, status]);

  // Coming back to the tab is the moment a payment made elsewhere becomes visible, and
  // it is the only signal this page gets: Checkout in a second tab lands there, not here.
  useEffect(() => {
    if (!claimable) return;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      reclaim();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [claimable, reclaim]);

  useEffect(() => {
    if (phase !== "signed-in" || shared || status !== "unauthorized" || askedWhy.current) return;
    askedWhy.current = true;
    let live = true;
    void readSyncRefusal({ workspaceId }).then((refusal) => {
      if (live) setReason(refusal);
    });
    return () => {
      live = false;
    };
  }, [phase, shared, status, workspaceId]);

  return { claim, reason, reclaim };
}
