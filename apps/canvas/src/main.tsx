import { ReactFlowProvider } from "@xyflow/react";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { bridgeMissing, desktopBridge } from "./host/bridge";
import { StaleShell } from "./host/StaleShell";
import { hasShareLink } from "./session/mode";
import { configureSession, getSession, standaloneSession } from "./session/session";
import { installErrorRecorder } from "./shell/diagnostics";
import { CanvasErrorBoundary } from "./shell/ErrorBoundary";
import {
  installIndexedDbQuotaGuard,
  persistAfterFirstEdit,
  refreshEstimate,
} from "./storage/durability";
import { initAppearance } from "./theme/useAppearanceStore";
import { initTheme } from "./theme/useThemeStore";
import "./styles/global.css";
// One stylesheet per workstream, so parallel work never edits the same file.
import "./styles/paint.css";
import "./styles/route.css";
import "./styles/tour.css";
import "./styles/library-selection.css";
import "./styles/purpose.css";
import "./styles/cursor.css";
// Registering the composing field kinds (rating, group, list) is a side effect
// of importing them; the panel finds them through the registry (ADR-0057).
import "./field/annotationKind";
import "./field/compositeKinds";
import { CanvasMark } from "./chrome/CanvasMark";

// Apply the stored theme before first paint to avoid a flash of the wrong mode.
initTheme();
// Before the first paint of the canvas, so a stored radius or density never flashes.
initAppearance();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element #root not found");
}

const root = createRoot(container);

/**
 * Every page the entry point renders is behind the boundary: a share link and
 * the local-only notice can throw too, and a blank page is exactly what gate A6
 * exists to remove.
 */
function render(element: ReactNode) {
  root.render(
    <StrictMode>
      <CanvasErrorBoundary>{element}</CanvasErrorBoundary>
    </StrictMode>,
  );
}

// A refused IndexedDB write becomes visible state rather than a silent save, and
// the last uncaught error is kept for the diagnostics block.
installIndexedDbQuotaGuard();
installErrorRecorder();
void refreshEstimate();

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
      <CanvasMark size="lg" />
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
 * The relay boot: trade a share token for a session. Returns false when a
 * stand-in page was rendered instead of the app.
 *
 * A normal workspace needs nothing here. The relay credential is a session JWT
 * minted from the Better Auth cookie on the first room join, so there is no
 * owner key to create, claim, rotate or keep in the URL (ADR-0076).

/**
 * The desktop boot: the shell owns the document, so the id comes from the file.
 *
 * This runs before `./App` and `./store` are imported. The store reads the
 * session once at import time, so a session configured afterwards would leave it
 * keyed to no document and persisting nowhere.
 */
async function bootDesktop(
  bridge: NonNullable<ReturnType<typeof desktopBridge>>,
): Promise<boolean> {
  if (hasShareLink(window.location.href)) {
    render(<LocalOnlyNotice />);
    return false;
  }
  const { configureDesktopSession } = await import("./session/desktopDocument");
  await configureDesktopSession(bridge);
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
  // A desktop window opens the file the shell handed over; a browser tab names its
  // workspace in the URL. Either way there is one path, and it reaches no service.
  const bridge = desktopBridge();
  let started: boolean;
  if (bridge === null) {
    started = bootLocal();
  } else {
    // A window left open by a previous build keeps the preload it loaded, so the
    // method this build needs may not exist. Say so rather than offering a window
    // whose controls do nothing.
    const missing = bridgeMissing(bridge);
    if (missing.length > 0) {
      render(<StaleShell missing={missing} />);
      return;
    }
    started = await bootDesktop(bridge);
  }
  if (!started) return;

  const { default: App } = await import("./App");
  // The document store is loaded by now, so persistence can be requested after
  // the first real change instead of on a page that may never be edited.
  const { useCanvasStore } = await import("./store/useCanvasStore");
  persistAfterFirstEdit(useCanvasStore.getState().workspace.doc);

  render(
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>,
  );
}

void boot();
