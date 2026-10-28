import { useState } from "react";
import type { AccountPhase } from "../auth/useAccountStore";
import { useSaveState } from "../feedback/saveState";
import {
  SAVE_LABEL,
  type SyncClaim,
  type SyncRefusal,
  syncPresentation,
} from "../feedback/syncState";
import { useDurabilityStore } from "../storage/durability";
import { storageWarningState } from "../storage/storageWarning";
import type { ConnectionStatus } from "../store/useCanvasStore";
import { useCanvasStore } from "../store/useCanvasStore";

/**
 * "Is my work safe, and is it going anywhere?"
 *
 * The answer is one sentence and at most one button. Everything an engineer would
 * want — the quota, what the browser promised about this copy, the export — is
 * behind Details, because a person opening this is asking a question, not filing a
 * bug. The panel used to also show the room's UUID and an unsent-change count,
 * which answered neither question.
 */
export interface SyncPanelProps {
  status: ConnectionStatus;
  phase?: AccountPhase;
  claim?: SyncClaim;
  reason?: SyncRefusal | null;
  peerCount: number;
  role?: "editor" | "viewer" | undefined;
  workspaceId?: string | undefined;
  /** The storage surface, shown inside Details. */
  storage?: React.ReactNode;
  onSignIn?: (() => void) | undefined;
  onSeePlans?: (() => void) | undefined;
  /**
   * Ask the control plane about this workspace again. Offered beside *See plans*,
   * because the person who just paid is the one reader with a reason to press it and
   * pressing it is cheaper than the reload they were never told about.
   */
  onReclaim?: (() => void) | undefined;
}

const ACTION_LABEL: Record<"retry" | "signIn" | "seePlans", string> = {
  retry: "Try now",
  signIn: "Sign in",
  seePlans: "See plans",
};

export function SyncPanel({
  status,
  phase = "unknown",
  claim = "unknown",
  reason = null,
  peerCount,
  role,
  workspaceId,
  storage,
  onSignIn,
  onSeePlans,
  onReclaim,
}: SyncPanelProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const presentation = syncPresentation({ phase, status, peerCount, role, claim, reason });
  const save = useSaveState();
  const quota = useDurabilityStore((store) => store.quota);
  const persist = useDurabilityStore((store) => store.persist);
  const warning = storageWarningState({
    persist,
    quota,
    signedIn: phase === "signed-in",
    synced: status === "connected",
  });
  const retry = () => useCanvasStore.getState().connect();

  const run = (action: "retry" | "signIn" | "seePlans") => {
    if (action === "retry") retry();
    if (action === "signIn") onSignIn?.();
    if (action === "seePlans") onSeePlans?.();
  };

  return (
    <div
      data-testid="sync-panel"
      role="dialog"
      aria-label="Sync and storage"
      className="absolute top-7 right-0 z-50 w-[300px] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-3.5 text-[12px] shadow-lg"
    >
      <p data-testid="sync-room" className="leading-5 text-[var(--ink)]">
        {presentation.sentence}
      </p>

      {presentation.action === null ? null : (
        <div className="mt-2.5 flex items-center gap-1.5">
          <button
            type="button"
            data-testid={
              presentation.action === "retry"
                ? "connection-retry"
                : presentation.action === "seePlans"
                  ? "sync-see-plans"
                  : "sync-sign-in"
            }
            onClick={() => run(presentation.action as "retry" | "signIn" | "seePlans")}
            className="rounded-md border border-[var(--hairline)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
          >
            {ACTION_LABEL[presentation.action]}
          </button>
          {/* Only beside the plan wall: every other situation has an answer that is not
              "ask again". */}
          {presentation.action === "seePlans" && onReclaim !== undefined ? (
            <button
              type="button"
              data-testid="sync-reclaim"
              onClick={onReclaim}
              className="rounded-md px-2.5 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
            >
              I have paid — retry
            </button>
          ) : null}
        </div>
      )}

      {warning.visible && warning.message !== null ? (
        <p
          data-testid="storage-warning"
          className="mt-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 leading-4 text-amber-800 dark:text-amber-200"
        >
          {warning.message}
        </p>
      ) : null}

      <button
        type="button"
        data-testid="sync-details"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((open) => !open)}
        className="mt-2.5 text-[11px] text-[var(--ink-muted)] underline-offset-2 hover:underline"
      >
        {detailsOpen ? "Hide details" : "Details"}
      </button>

      {detailsOpen ? (
        <div
          data-testid="sync-details-body"
          className="mt-2 space-y-2 border-t border-[var(--hairline)] pt-2"
        >
          <div className="flex items-baseline justify-between gap-3">
            <span className="shrink-0 text-[var(--ink-muted)]">This device</span>
            <span data-testid="sync-save-state" className="min-w-0 truncate text-right">
              {SAVE_LABEL[save]}
            </span>
          </div>
          {storage}
          {workspaceId ? (
            <div
              className="flex items-baseline justify-between gap-3"
              title="The relay's name for this workspace"
            >
              <span className="shrink-0 text-[var(--ink-muted)]">Room</span>
              <span className="min-w-0 truncate text-right font-mono text-[10px] text-[var(--ink-muted)]">
                {workspaceId}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
