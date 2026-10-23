import { crashDsn } from "./consent";
import { hashWorkspaceId, scrubEvent } from "./scrub";

/**
 * Opt-in crash reporting. `@sentry/react` is imported only when a DSN is
 * configured *and* the person opted in, so the SDK never reaches a tab that did
 * not ask for it and never ends up in the standalone bundle's first chunk.
 */

export interface CrashOptions {
  workspaceId: string | null;
  route: string;
  ownerKey?: string | null;
  mode?: string;
  version?: string;
}

let started = false;

export function crashReportingStarted(): boolean {
  return started;
}

/**
 * Starts the reporter. Returns false when there is no DSN, no consent, or the
 * SDK could not load — all three are ordinary states, not failures.
 */
export async function startCrashReporting(options: CrashOptions): Promise<boolean> {
  const dsn = crashDsn();
  if (!dsn || started) return started;

  const workspaceHash = options.workspaceId ? await hashWorkspaceId(options.workspaceId) : null;
  const { init } = await import("@sentry/react");
  init({
    dsn,
    release: options.version,
    environment: options.mode,
    // Nothing is attached by the SDK itself; the scrubber is the only source of
    // payload fields, and it is an allowlist.
    maxBreadcrumbs: 0,
    tracesSampleRate: 0,
    attachStacktrace: true,
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== "Breadcrumbs"),
    beforeSend: (event) =>
      scrubEvent(event, {
        buildVersion: options.version ?? "dev",
        mode: options.mode ?? "production",
        route: options.route,
        workspaceHash,
        ownerKey: options.ownerKey ?? null,
      }) as never,
  });
  started = true;
  return true;
}

/** Reports one error through the same allowlist. No-op before `init`. */
export async function reportCrash(error: unknown): Promise<void> {
  if (!started) return;
  const { captureException } = await import("@sentry/react");
  captureException(error);
}

/** Test seam: forget that the SDK was started. */
export function resetCrashReporting(): void {
  started = false;
}
