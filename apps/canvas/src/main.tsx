import { ReactFlowProvider } from "@xyflow/react";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ShareUnavailable } from "./components/ShareUnavailable";
import {
  type BootPlan,
  bootPlan,
  hasShareLink,
  suiteMode,
  workspaceIdFromUrl,
} from "./session/mode";
import {
  configureSession,
  getSession,
  resolveShareToken,
  sessionForShare,
  standaloneSession,
} from "./session/session";
import { initTheme } from "./theme/useThemeStore";
import "./styles/global.css";

// Apply the stored theme before first paint to avoid a flash of the wrong mode.
initTheme();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

const root = createRoot(container);

function render(element: ReactNode) {
  root.render(<StrictMode>{element}</StrictMode>);
}

/**
 * A `?share=` link opened in a standalone build. The relay that link belongs to
 * is not part of this build, so the page says that plainly: a fetch here could
 * only fail, and "this build is local-only" is the honest answer.
 */
function LocalOnlyNotice() {
  return (
    <div
      className="app-canvas flex h-screen w-screen flex-col items-center justify-center gap-4 px-6 text-center"
      data-testid="local-only-notice"
    >
      <img src="/suite-logo-black.svg" alt="Suite" className="h-10 w-10 dark:hidden" />
      <img src="/suite-logo-white.svg" alt="Suite" className="hidden h-10 w-10 dark:block" />
      <div className="max-w-[360px]">
        <h1 className="text-[15px] font-semibold text-[var(--ink)]">This build is local-only.</h1>
        <p className="mt-1 text-[12px] leading-5 text-[var(--ink-muted)]">
          Share links need the hosted or self-hosted edition. Everything you make here stays in this
          browser.
        </p>
      </div>
      <a
        href="/"
        className="rounded-lg border border-[var(--hairline)] px-3 py-1.5 text-[12px] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
      >
        Open Suite
      </a>
    </div>
  );
}

/**
 * The relay boot: trade a share token for a session, or claim this browser as a
 * workspace owner. Returns false when a stand-in page was rendered instead of
 * the app.
 *
 * The relay modules are imported on demand, so a standalone build never loads
 * them — see the build-time check in `boot`.
 */
async function bootRelay(plan: BootPlan): Promise<boolean> {
  if (plan.resolveShare) {
    const token = resolveShareToken();
    if (token === null) return true;
    // `shares` carries the `/api/shares` client, so it is loaded only here.
    const { closeShareSession, resolveShare, shareErrorMessage } = await import("./session/shares");
    try {
      configureSession(sessionForShare(token, await resolveShare(token)));
    } catch (error) {
      // A dead cookie (revoked, expired) must not be retried on the next boot.
      await closeShareSession();
      render(<ShareUnavailable message={shareErrorMessage(error)} />);
      return false;
    }
    return true;
  }

  if (!plan.claimOwner) return true;
  const workspaceId = workspaceIdFromUrl(window.location.href);
  if (workspaceId === null) return true;

  const { prepareOwnerSession, withOwnerFragment } = await import("./session/ownerKey");
  const { ownerKey, claim } = await prepareOwnerSession(workspaceId);
  if (claim === "conflict") {
    const { WorkspaceProtected } = await import("./components/WorkspaceProtected");
    render(<WorkspaceProtected workspaceId={workspaceId} />);
    return false;
  }
  configureSession({ ...getSession(), ownerKey });
  // Keep the key in the fragment so this link stays the recovery path.
  window.history.replaceState(null, "", withOwnerFragment(window.location.href, ownerKey));
  return true;
}

/** The standalone boot: no claim, no share, no socket — just this browser. */
function bootLocal(): boolean {
  if (hasShareLink(window.location.href)) {
    render(<LocalOnlyNotice />);
    return false;
  }
  // The URL names the local workspace; the session carries no relay identity.
  configureSession(standaloneSession(getSession()));
  return true;
}

/**
 * A session is resolved before the app module loads: the store reads it at
 * import time to pick its room, credentials and read-only flag, so configuring
 * it any later would join the wrong document.
 */
async function boot() {
  const plan = bootPlan(suiteMode(), window.location.href);

  // This literal, rather than `isStandalone()`, keeps the relay out of a
  // standalone bundle: Vite inlines `import.meta.env.VITE_SUITE_MODE` as a
  // string, so the standalone build folds this to `if (false)` and drops
  // `bootRelay` with it — no claim call, no share client, no relay URL compiled
  // in. A function call would be opaque to the bundler; this is the same
  // comparison `isStandalone()` makes.
  if (import.meta.env.VITE_SUITE_MODE !== "standalone") {
    if (!(await bootRelay(plan))) return;
  } else if (!bootLocal()) {
    return;
  }

  const { default: App } = await import("./App");
  render(
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>,
  );
}

void boot();
