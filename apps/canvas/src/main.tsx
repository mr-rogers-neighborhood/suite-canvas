import { ReactFlowProvider } from "@xyflow/react";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ShareUnavailable } from "./components/ShareUnavailable";
import { WorkspaceProtected } from "./components/WorkspaceProtected";
import { prepareOwnerSession, withOwnerFragment } from "./session/ownerKey";
import {
  configureSession,
  getSession,
  resolveShareToken,
  sessionForShare,
} from "./session/session";
import { resolveShare, shareErrorMessage } from "./session/shares";
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

function workspaceIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("workspace") ?? params.get("doc");
  return id && id.length > 0 ? id : null;
}

/**
 * A session is resolved before the app module loads: the store reads it at
 * import time to pick its room, credentials and read-only flag, so configuring
 * it any later would join the wrong document.
 */
async function boot() {
  const token = resolveShareToken();
  if (token) {
    try {
      configureSession(sessionForShare(token, await resolveShare(token)));
    } catch (error) {
      render(<ShareUnavailable message={shareErrorMessage(error)} />);
      return;
    }
  } else {
    const workspaceId = workspaceIdFromUrl();
    if (workspaceId) {
      const { ownerKey, claim } = await prepareOwnerSession(workspaceId);
      if (claim === "conflict") {
        render(<WorkspaceProtected />);
        return;
      }
      configureSession({ ...getSession(), ownerKey });
      // Keep the key in the fragment so this link stays the recovery path.
      window.history.replaceState(null, "", withOwnerFragment(window.location.href, ownerKey));
    }
  }

  const { default: App } = await import("./App");
  render(
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>,
  );
}

void boot();
