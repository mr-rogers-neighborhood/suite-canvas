import { useEffect, useRef, useState } from "react";
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
  const askedWhy = useRef(false);

  const claimable = phase === "signed-in" && !shared && workspaceId.length > 0;

  useEffect(() => {
    if (phase === "signed-out") setClaim("local");
  }, [phase]);

  useEffect(() => {
    if (!claimable || settled.current) return;
    let live = true;
    void claimWorkspaceForAccount({
      workspaceId,
      ...(workspaceName === undefined ? {} : { name: workspaceName }),
    }).then((outcome) => {
      if (!live) return;
      if (outcome === "unavailable") return;
      settled.current = true;
      setClaim(outcome === "capped" ? "capped" : outcome === "elsewhere" ? "elsewhere" : "claimed");
    });
    return () => {
      live = false;
    };
    // `attempt` is the retry counter: bumping it is what re-runs this effect.
  }, [claimable, workspaceId, workspaceName]);

  // A first claim made while offline is worth one more try once there is a
  // connection, which is the moment it can succeed.
  useEffect(() => {
    if (!claimable || settled.current || status !== "connected") return;
    setAttempt((count) => count + 1);
  }, [claimable, status]);

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

  return { claim, reason };
}
