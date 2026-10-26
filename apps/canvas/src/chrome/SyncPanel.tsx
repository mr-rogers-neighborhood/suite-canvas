import { usePendingChanges } from "../feedback/connection";
import { useSaveState } from "../feedback/saveState";
import { NOT_DURABLE_REASON, SAVE_LABEL, syncPresentation } from "../feedback/syncState";
import { useDurabilityStore } from "../storage/durability";
import { storageWarningState } from "../storage/storageWarning";
import type { ConnectionStatus } from "../store/useCanvasStore";
import { useCanvasStore } from "../store/useCanvasStore";

/**
 * The one answer to "is my work safe".
 *
 * Everything that used to float over the board is a row in here: whether the room
 * is live and how much of it the relay has seen, what this device did with its
 * copy, what the browser promised about keeping it, and the storage surface with
 * its quota and export. The board itself holds no status chrome.
 */
export interface SyncPanelProps {
  status: ConnectionStatus;
  signedIn: boolean;
  peerCount: number;
  role?: "editor" | "viewer" | undefined;
  /** The workspace id, which is also the relay's room name. */
  workspaceId?: string | undefined;
  /** The storage surface: prompt, estimate, quota and export. */
  storage?: React.ReactNode;
  onSignIn?: (() => void) | undefined;
}

export function SyncPanel({
  status,
  signedIn,
  peerCount,
  role,
  workspaceId,
  storage,
  onSignIn,
}: SyncPanelProps) {
  const pending = usePendingChanges();
  const presentation = syncPresentation({ status, signedIn, peerCount, role, pending });
  const save = useSaveState();
  const quota = useDurabilityStore((store) => store.quota);
  const persist = useDurabilityStore((store) => store.persist);
  const warning = storageWarningState({
    persist,
    quota,
    signedIn,
    synced: status === "connected",
  });
  const retry = () => useCanvasStore.getState().connect();

  return (
    <div
      data-testid="sync-panel"
      role="dialog"
      aria-label="Sync and storage"
      className="absolute top-7 right-0 z-50 w-[320px] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 text-[12px] shadow-lg"
    >
      <h2 className="text-[13px] font-semibold text-[var(--ink)]">Sync</h2>
      <p data-testid="sync-room" className="mt-2 leading-5 text-[var(--ink)]">
        {presentation.sentence}
      </p>

      <dl
        data-testid="sync-facts"
        className="mt-3 space-y-1 border-t border-[var(--hairline)] pt-3"
      >
        <Row label="Unsent" value={presentation.pending ?? "Nothing waiting"} />
        <Row
          label="This device"
          value={SAVE_LABEL[save]}
          title={saveDetail(save, quota?.message)}
        />
        {workspaceId ? (
          <Row label="Room" value={workspaceId} title="The relay's name for this workspace" />
        ) : null}
      </dl>

      {warning.visible && warning.message !== null ? (
        <p
          data-testid="storage-warning"
          className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 leading-4 text-amber-800 dark:text-amber-200"
        >
          {warning.message}
        </p>
      ) : null}

      {presentation.action === null ? null : (
        <button
          type="button"
          data-testid={presentation.action === "retry" ? "connection-retry" : "sync-sign-in"}
          onClick={presentation.action === "retry" ? retry : onSignIn}
          className="mt-3 rounded-md border border-[var(--hairline)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
        >
          {presentation.action === "retry" ? "Try now" : "Sign in"}
        </button>
      )}

      {storage ? (
        <div className="mt-3 border-t border-[var(--hairline)] pt-3">{storage}</div>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string | undefined;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3" title={title}>
      <dt className="shrink-0 text-[var(--ink-muted)]">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[var(--ink)]">{value}</dd>
    </div>
  );
}

function saveDetail(save: string, quotaMessage: string | undefined): string {
  return save === "not-durable" ? (quotaMessage ?? NOT_DURABLE_REASON) : "";
}
