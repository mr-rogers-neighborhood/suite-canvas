import { ReactFlowProvider } from "@xyflow/react";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ShareUnavailable } from "./components/ShareUnavailable";
import { configureSession, resolveShareToken, sessionForShare } from "./session/session";
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

/**
 * A share token is resolved before the app module loads: the store reads the
 * session at import time to pick its room, credentials and read-only flag, so
 * configuring it any later would join the wrong document.
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
  }

  const { default: App } = await import("./App");
  render(
    <ReactFlowProvider>
      <App />
    </ReactFlowProvider>,
  );
}

void boot();
