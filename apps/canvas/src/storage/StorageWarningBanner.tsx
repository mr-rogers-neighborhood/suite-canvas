import { useCallback, useState } from "react";
import { storageLadder } from "../session/storageLadder";
import { type PersistState, type QuotaFailure, useDurabilityStore } from "./durability";

/**
 * The storage warning that survives the popover.
 *
 * The storage panel is a deliberate press away, so a reader who never opens it
 * never learns that this browser refused to keep the copy, and the refusal is
 * exactly when an export is worth offering. This is the same state, rendered
 * where the shell can mount it permanently. It answers from `storageLadder()`
 * rather than inventing a second rule, so the panel and the banner cannot
 * disagree about when a warning is warranted (ADR-0025, ADR-0067 §6).
 */

export const STORAGE_AT_RISK_WARNING =
  "This browser has not promised to keep this workspace on this device. Export a copy so a storage cleanup cannot take it.";

export type ExportState = "idle" | "done" | "failed";

export interface StorageWarningState {
  visible: boolean;
  /** The sentence to show, or null when there is nothing to say. */
  message: string | null;
}

export interface StorageWarningInput {
  persist: PersistState;
  quota: QuotaFailure | null;
  /** An account behind this device makes the local copy a footnote, not a risk. */
  signedIn?: boolean;
  /** Another device in the room holds a copy, so this one can be cleared safely. */
  synced?: boolean;
}

/**
 * Whether the shell should show a durability warning. Only the ladder's
 * `banner` and `blocking` rungs ask for something; `quiet` and `nothing` do not,
 * which is what keeps a collaborating reader from being interrupted.
 *
 * `unknown` is silence rather than a warning: the browser has not been asked
 * yet (`persistAfterFirstEdit` asks on the first edit), so there is nothing to
 * report and nothing to export.
 */
export function storageWarningState(input: StorageWarningInput): StorageWarningState {
  const ladder = storageLadder({
    persist: input.persist,
    signedIn: input.signedIn ?? false,
    synced: input.synced ?? false,
    failing: input.quota !== null,
  });
  if (ladder.rung === "blocking") {
    return { visible: true, message: input.quota?.message ?? STORAGE_AT_RISK_WARNING };
  }
  if (ladder.rung === "banner" && input.persist !== "unknown") {
    return { visible: true, message: STORAGE_AT_RISK_WARNING };
  }
  return { visible: false, message: null };
}

/** The live warning state, for a shell that renders its own surface. */
export function useStorageWarning(signedIn = false, synced = false): StorageWarningState {
  const persist = useDurabilityStore((state) => state.persist);
  const quota = useDurabilityStore((state) => state.quota);
  return storageWarningState({ persist, quota, signedIn, synced });
}

export interface StorageWarningBannerProps {
  workspaceId: string;
  /**
   * Whether this device has an account behind it, and whether another device is
   * in the room right now. Passed through to `storageLadder()` so the banner
   * falls silent exactly when the panel does.
   */
  signedIn?: boolean;
  synced?: boolean;
  /**
   * What the export button does. Defaults to the live workspace backup; a shell
   * with its own export flow passes that instead.
   */
  onExport?: ((workspaceId: string) => void | Promise<void>) | undefined;
  className?: string | undefined;
}

async function exportLiveWorkspace(workspaceId: string): Promise<void> {
  const [{ downloadWorkspaceBackup }, { useCanvasStore }] = await Promise.all([
    import("../session/workspaceTransfer"),
    import("../store/useCanvasStore"),
  ]);
  await downloadWorkspaceBackup(workspaceId, useCanvasStore.getState().workspace, workspaceId);
}

/**
 * Mount this once, outside the storage popover (the app shell's status area is
 * the intended home). It renders nothing while the browser's answer is fine.
 */
export function StorageWarningBanner({
  workspaceId,
  signedIn = false,
  synced = false,
  onExport,
  className,
}: StorageWarningBannerProps) {
  const { visible, message } = useStorageWarning(signedIn, synced);
  const [exported, setExported] = useState<ExportState>("idle");

  const exportCopy = useCallback(async () => {
    try {
      await (onExport ?? exportLiveWorkspace)(workspaceId);
      setExported("done");
    } catch {
      setExported("failed");
    }
  }, [onExport, workspaceId]);

  if (!visible || message === null) return null;

  return (
    <div
      data-testid="storage-shell-warning"
      role="status"
      className={
        className ??
        "flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-[11px] leading-4 text-amber-800 dark:text-amber-200"
      }
    >
      <span className="min-w-0 flex-1">{message}</span>
      <button
        type="button"
        data-testid="storage-shell-export"
        onClick={() => void exportCopy()}
        className="shrink-0 rounded-md border border-amber-600/40 px-2 py-0.5 text-[11px] font-medium hover:bg-amber-500/10"
      >
        {exported === "done" ? "Exported" : exported === "failed" ? "Export failed" : "Export copy"}
      </button>
    </div>
  );
}
