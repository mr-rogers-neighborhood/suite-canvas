import { useCallback, useEffect, useMemo, useState } from "react";
import { crashReportingAvailable, readCrashConsent, setCrashConsent } from "../crash/consent";
import { startCrashReporting } from "../crash/report";
import { getSession } from "../session/session";
import { storageLadder } from "../session/storageLadder";
import { buildDiagnostics, copyText, safeRoute, useDiagnosticsStore } from "../shell/diagnostics";
import {
  formatEstimate,
  refreshEstimate,
  requestPersistence,
  useDurabilityStore,
} from "../storage/durability";

/**
 * The storage surface: what the browser promised, how much room is left, and —
 * when the answer is "it may evict this" or "it is full" — the consequence in
 * plain words plus an export. Nothing here is a modal: a person can keep working
 * while it is open, which is the point of "offline means the open tab".
 */

export const OFFLINE_SCOPE =
  "Offline means the open tab keeps working. A reload while offline is not supported in Alpha.";

export interface StoragePanelProps {
  workspaceId: string;
  /**
   * Whether this device has an account behind it. Absent until the session surface lands, which keeps
   * today's answer honest: with no account the anonymous rungs of the ladder apply
   * ([ADR-0067](../../docs/decisions/0067-the-account-is-the-identity.md) §6).
   */
  signedIn?: boolean;
  /** Opens the sign-in surface the banner offers. Absent while there is none. */
  onSignIn?: (() => void) | undefined;
}

export function StoragePanel({ workspaceId, signedIn = false, onSignIn }: StoragePanelProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [exported, setExported] = useState<"idle" | "done" | "failed">("idle");
  const [crash, setCrash] = useState(readCrashConsent);
  const persist = useDurabilityStore((state) => state.persist);
  const estimate = useDurabilityStore((state) => state.estimate);
  const quota = useDurabilityStore((state) => state.quota);
  const lastError = useDiagnosticsStore((state) => state.lastError);

  useEffect(() => {
    if (!open) return;
    void refreshEstimate();
  }, [open]);

  const copy = useCallback(async () => {
    const text = buildDiagnostics({
      route: safeRoute(window.location.href),
      storage: { persist, estimate, quota },
      connection: "see title bar",
      lastError,
    });
    setCopied((await copyText(text)) ? "done" : "failed");
  }, [persist, estimate, quota, lastError]);

  const exportCopy = useCallback(async () => {
    try {
      const [{ downloadWorkspaceBackup }, { useCanvasStore }] = await Promise.all([
        import("../session/workspaceTransfer"),
        import("../store/useCanvasStore"),
      ]);
      await downloadWorkspaceBackup(workspaceId, useCanvasStore.getState().workspace, workspaceId);
      setExported("done");
    } catch {
      setExported("failed");
    }
  }, [workspaceId]);

  const toggleCrash = useCallback(async (granted: boolean) => {
    setCrashConsent(granted);
    setCrash(granted);
    if (!granted) return;
    await startCrashReporting({
      workspaceId: getSession().workspaceId,
      route: safeRoute(window.location.href),
      ownerKey: getSession().ownerKey,
    });
  }, []);

  const ladder = useMemo(
    () => storageLadder({ persist, signedIn, failing: quota !== null }),
    [persist, signedIn, quota],
  );
  const atRisk = ladder.rung === "banner" || ladder.rung === "blocking";

  return (
    <div className="storage-host pointer-events-auto relative" data-testid="storage-panel-host">
      <button
        type="button"
        data-testid="storage-status"
        data-persist={persist}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        title="Storage and offline scope"
        className={`rounded-full border px-2.5 py-1 text-[11px] ${
          ladder.alarm
            ? "border-amber-500/60 text-amber-700 dark:text-amber-300"
            : "border-[var(--hairline)] text-[var(--ink-muted)]"
        }`}
      >
        {ladder.pill}
      </button>

      {open ? (
        <div
          data-testid="storage-panel"
          role="dialog"
          aria-label="Storage"
          className="absolute top-8 right-0 z-50 w-[320px] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 text-[12px] shadow-lg"
        >
          <h2 className="text-[13px] font-semibold text-[var(--ink)]">Storage</h2>

          {ladder.headline === null ? null : (
            <p data-testid="storage-headline" className="mt-2 leading-5 text-[var(--ink)]">
              {ladder.headline}
            </p>
          )}
          <p data-testid="storage-persist" className="mt-2 leading-5 text-[var(--ink-muted)]">
            {ladder.detail}
          </p>

          <p data-testid="storage-estimate" className="mt-2 text-[var(--ink-muted)]">
            Used on this device: <span className="font-mono">{formatEstimate(estimate)}</span>
          </p>

          {/* The banner's one action, next to the sentence that asked for it. */}
          {ladder.action === "sign-in" ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {onSignIn === undefined ? null : (
                <button
                  type="button"
                  data-testid="storage-sign-in"
                  onClick={onSignIn}
                  className="rounded-lg border border-[var(--hairline)] px-2.5 py-1 text-[11px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Sign in
                </button>
              )}
            </div>
          ) : null}

          {atRisk ? (
            <p
              data-testid="storage-warning"
              className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 leading-5 text-amber-800 dark:text-amber-200"
            >
              Export a copy to keep this workspace independent of this browser's storage.
            </p>
          ) : null}

          {quota ? (
            <p
              data-testid="quota-warning"
              role="alert"
              className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1.5 leading-5 text-red-800 dark:text-red-200"
            >
              {quota.message}
            </p>
          ) : null}

          <p
            data-testid="offline-scope"
            className="mt-3 border-t border-[var(--hairline)] pt-2 leading-5 text-[var(--ink-muted)]"
          >
            {OFFLINE_SCOPE}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {atRisk || quota ? (
              <button
                type="button"
                data-testid="storage-export"
                onClick={() => void exportCopy()}
                className="rounded-lg border border-[var(--hairline)] px-2.5 py-1 text-[11px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
              >
                {exported === "done"
                  ? "Exported"
                  : exported === "failed"
                    ? "Export unavailable"
                    : "Export copy"}
              </button>
            ) : null}
            <button
              type="button"
              data-testid="storage-copy-diagnostics"
              onClick={() => void copy()}
              className="rounded-lg border border-[var(--hairline)] px-2.5 py-1 text-[11px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
            >
              {copied === "done"
                ? "Copied"
                : copied === "failed"
                  ? "Copy failed"
                  : "Copy diagnostics"}
            </button>
            {persist === "unknown" ? (
              <button
                type="button"
                data-testid="storage-request-persist"
                onClick={() => void requestPersistence().then(() => refreshEstimate())}
                className="rounded-lg border border-[var(--hairline)] px-2.5 py-1 text-[11px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
              >
                Ask this browser to keep it
              </button>
            ) : null}
          </div>

          {crashReportingAvailable() ? (
            <label className="mt-3 flex items-start gap-2 border-t border-[var(--hairline)] pt-2 leading-5 text-[var(--ink-muted)]">
              <input
                type="checkbox"
                data-testid="crash-opt-in"
                checked={crash}
                onChange={(event) => void toggleCrash(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                Send crash reports to this deployment's GlitchTip. Reports carry the build, route,
                browser/OS, stack trace and a hashed workspace id — never card text, attachments,
                document bytes, share tokens or your owner key.
              </span>
            </label>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
