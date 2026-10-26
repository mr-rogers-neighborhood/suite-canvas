import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useState } from "react";
import { reportCrash } from "../crash/report";
import { useDurabilityStore } from "../storage/durability";
import { buildInfo } from "./buildInfo";
import {
  buildDiagnostics,
  copyText,
  type DiagnosticConfigInput,
  describeError,
  downloadDiagnostics,
  type LastError,
  safeRoute,
  useDiagnosticsStore,
} from "./diagnostics";

/**
 * The last line of defence: a render error anywhere under the canvas shell must
 * produce a page with a build, a route, a copyable diagnostic block, a reload
 * and an export — never a blank screen. The fallback is deliberately plain React
 * with no canvas or store dependency beyond reading it defensively, so it can
 * render when the interesting parts of the app cannot.
 */

interface BoundaryProps {
  children: ReactNode;
  /** Overrides the route shown and copied; defaults to the live location. */
  route?: string;
}

interface BoundaryState {
  error: LastError | null;
  /** Bumped by "Try again" so a repaired tree remounts instead of re-rendering. */
  attempt: number;
}

export class CanvasErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    const route = typeof window === "undefined" ? "(no window)" : safeRoute(window.location.href);
    return { error: describeError(error, route) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    // Kept for the diagnostics bundle even when reporting is off, so the person
    // in front of the broken tab can still copy something useful.
    const route = typeof window === "undefined" ? "(no window)" : safeRoute(window.location.href);
    useDiagnosticsStore.getState().record(describeError(error, route));
    void reportCrash(error);
    if (import.meta.env.DEV) console.error("[shell] render error", error, info.componentStack);
  }

  private retry = () => {
    this.setState((state) => ({ error: null, attempt: state.attempt + 1 }));
  };

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <CrashFallback
          error={this.state.error}
          route={this.props.route ?? this.state.error.route}
          onRetry={this.retry}
        />
      );
    }
    // Keyed remount: after a repair, stale component state is not reused.
    return <div key={this.state.attempt}>{this.props.children}</div>;
  }
}

/**
 * The configuration a crash bundle may name. Everything here is read from the
 * page itself, so the fallback needs no store and no session: an origin, the
 * canvas surface asked for, whether the tab is online, and the browser's own
 * strings. A token is never in reach of this function.
 */
function crashConfig(route: string): DiagnosticConfigInput {
  if (typeof window === "undefined") return {};
  const surface = new URLSearchParams(window.location.search).get("canvas") ?? undefined;
  return {
    relay: window.location.origin,
    surface: surface ?? "(default)",
    session: route.includes("share") ? "share-link" : "page",
    online: navigator.onLine,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    userAgent: navigator.userAgent,
    language: navigator.language,
  };
}

/**
 * Reads the connection status without importing the store eagerly: the store
 * opens a socket at module load, and the fallback must render on a page whose
 * store never got that far.
 */
function useConnectionLabel(): string {
  const [label, setLabel] = useState("unknown");
  useEffect(() => {
    let cancelled = false;
    void import("../store/useCanvasStore")
      .then(({ useCanvasStore }) => {
        const state = useCanvasStore.getState();
        if (!cancelled) setLabel(`${state.status}${state.synced ? " (synced)" : ""}`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return label;
}

function CrashFallback({
  error,
  route,
  onRetry,
}: {
  error: LastError;
  route: string;
  onRetry: () => void;
}) {
  const build = useMemo(() => buildInfo(), []);
  const persist = useDurabilityStore((state) => state.persist);
  const estimate = useDurabilityStore((state) => state.estimate);
  const quota = useDurabilityStore((state) => state.quota);
  const connection = useConnectionLabel();
  const recorded = useDiagnosticsStore((state) => state.errors);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const [exported, setExported] = useState<"idle" | "done" | "failed">("idle");

  const input = useMemo(
    () => ({
      route,
      build,
      storage: { persist, estimate, quota },
      connection,
      lastError: error,
      config: crashConfig(route),
      errors: recorded.length === 0 ? [error] : recorded,
    }),
    [route, build, persist, estimate, quota, error, connection, recorded],
  );

  const diagnostics = useMemo(() => buildDiagnostics(input), [input]);

  const copy = async () => {
    setCopied((await copyText(diagnostics)) ? "done" : "failed");
  };

  const download = () => {
    try {
      setDownloaded(downloadDiagnostics(input));
    } catch {
      setDownloaded("failed");
    }
  };

  const exportWorkspace = async () => {
    try {
      const [{ downloadWorkspaceBackup }, { useCanvasStore }, { getSession }] = await Promise.all([
        import("../session/workspaceTransfer"),
        import("../store/useCanvasStore"),
        import("../session/session"),
      ]);
      const workspaceId = getSession().workspaceId;
      if (!workspaceId) throw new Error("this page has no workspace of its own to export");
      await downloadWorkspaceBackup(workspaceId, useCanvasStore.getState().workspace, workspaceId);
      setExported("done");
    } catch {
      setExported("failed");
    }
  };

  return (
    <div
      className="app-canvas flex min-h-screen w-full flex-col items-center justify-center gap-4 px-6 py-10"
      data-testid="crash-fallback"
    >
      <div className="w-full max-w-[640px] rounded-2xl border border-[var(--hairline)] bg-[var(--surface)] p-6 shadow-lg">
        <h1 className="text-[15px] font-semibold text-[var(--ink)]">
          Suite hit an error it could not recover from.
        </h1>
        <p className="mt-1 text-[12px] leading-5 text-[var(--ink-muted)]">
          Your document is still in this browser. Copy the diagnostics below, or export a copy
          before reloading.
        </p>

        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          <dt className="text-[var(--ink-muted)]">Build</dt>
          <dd data-testid="crash-build" className="font-mono text-[var(--ink)]">
            {build.version} ({build.mode})
          </dd>
          <dt className="text-[var(--ink-muted)]">Route</dt>
          <dd data-testid="crash-route" className="font-mono break-all text-[var(--ink)]">
            {route}
          </dd>
        </dl>

        <label
          className="mt-4 block text-[12px] text-[var(--ink-muted)]"
          htmlFor="crash-diagnostics"
        >
          Diagnostics
        </label>
        <textarea
          id="crash-diagnostics"
          data-testid="diagnostic-block"
          readOnly
          value={diagnostics}
          rows={10}
          className="mt-1 w-full resize-none rounded-lg border border-[var(--hairline)] bg-[var(--canvas)] p-2 font-mono text-[11px] text-[var(--ink)]"
        />

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="copy-diagnostics"
            onClick={() => void copy()}
            className="rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[12px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
          >
            {copied === "done"
              ? "Copied"
              : copied === "failed"
                ? "Copy failed — select the text"
                : "Copy diagnostics"}
          </button>
          <button
            type="button"
            data-testid="download-diagnostics"
            onClick={download}
            className="rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[12px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
          >
            {downloaded === null
              ? "Download bundle"
              : downloaded === "failed"
                ? "Download failed"
                : `Saved ${downloaded}`}
          </button>
          <button
            type="button"
            data-testid="export-workspace"
            onClick={() => void exportWorkspace()}
            className="rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[12px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
          >
            {exported === "done"
              ? "Exported"
              : exported === "failed"
                ? "Export unavailable"
                : "Export workspace"}
          </button>
          <button
            type="button"
            data-testid="reload-app"
            onClick={() => window.location.reload()}
            className="rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[12px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
          >
            Reload
          </button>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg px-3 py-1.5 text-[12px] text-[var(--ink-muted)] underline"
            >
              Try again without reloading
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
