import { useEffect, useRef, useState } from "react";
import type { AccountPhase } from "../auth/useAccountStore";
import type { SyncClaim, SyncRefusal } from "../feedback/syncState";
import { readSyncRefusal } from "../session/syncAccess";
import { claimWorkspaceForAccount } from "../session/workspaceClaim";
import type { ConnectionStatus } from "../store/useCanvasStore";

/**
 * What this page can honestly say about a workspace's place in the account.
 *
 * Two questions, asked once each. May the account hold this workspace — which the
 * control plane answers, and is the only place that knows whether the plan covers
 * another one. And if the relay then refused a join, why — which only the relay
 * knows. Both answers are cached for the life of the page: a claim is not a
 * thing to retry in a loop, and a refusal does not change by asking again.
 */
export interface WorkspaceSyncFacts {
  claim: SyncClaim;
  reason: SyncRefusal | null;
}

export function useWorkspaceSyncFacts(input: {
  workspaceId: string;
  phase: AccountPhase;
  status: ConnectionStatus;
  workspaceName?: string | undefined;
}): WorkspaceSyncFacts {
  const { workspaceId, phase, status, workspaceName } = input;
  const [claim, setClaim] = useState<SyncClaim>("unknown");
  const [reason, setReason] = useState<SyncRefusal | null>(null);
  // One claim per workspace per page: signing in twice must not post twice.
  const claimed = useRef<string | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    if (phase === "signed-out") {
      setClaim("local");
      return;
    }
    if (phase !== "signed-in") return;
    if (claimed.current === workspaceId) return;
    claimed.current = workspaceId;
    let live = true;
    void claimWorkspaceForAccount({
      workspaceId,
      ...(workspaceName === undefined ? {} : { name: workspaceName }),
    }).then((outcome) => {
      if (!live) return;
      if (outcome === "unavailable") {
        // Let the next boot try again rather than remembering a bad guess.
        claimed.current = null;
        return;
      }
      setClaim(outcome === "capped" ? "capped" : outcome === "elsewhere" ? "elsewhere" : "claimed");
    });
    return () => {
      live = false;
    };
  }, [phase, workspaceId, workspaceName]);

  useEffect(() => {
    if (phase !== "signed-in" || status !== "unauthorized" || asked.current) return;
    asked.current = true;
    let live = true;
    void readSyncRefusal({ workspaceId }).then((refusal) => {
      if (live) setReason(refusal);
    });
    return () => {
      live = false;
    };
  }, [phase, status, workspaceId]);

  return { claim, reason };
}
