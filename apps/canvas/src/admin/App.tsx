import { type FormEvent, useState } from "react";
import {
  errorText,
  forgetAdminToken,
  getStatus,
  rememberAdminToken,
  storedAdminToken,
} from "./api";
import { FixturesPanel } from "./panels/FixturesPanel";
import { RoomsPanel } from "./panels/RoomsPanel";
import { SharesPanel } from "./panels/SharesPanel";
import { StatusPanel } from "./panels/StatusPanel";
import { SupportPanel } from "./panels/SupportPanel";
import { WorkspacesPanel } from "./panels/WorkspacesPanel";
import { ErrorLine } from "./ui";

type View = "status" | "workspaces" | "rooms" | "shares" | "fixtures" | "support";

const VIEWS: { id: View; label: string }[] = [
  { id: "status", label: "Status" },
  { id: "workspaces", label: "Workspaces" },
  { id: "rooms", label: "Rooms" },
  { id: "shares", label: "Shares" },
  { id: "fixtures", label: "Fixtures" },
  { id: "support", label: "Support" },
];

/**
 * Token screen. The token is validated against `/status` before it is kept, so
 * a typo surfaces here instead of as an error on every panel.
 */
function TokenScreen({ onReady }: { onReady: (token: string) => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (value.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await getStatus(value);
      onReady(value);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-gate">
      <form className="admin-card admin-gate-card" onSubmit={(event) => void submit(event)}>
        <h1>
          Suite <span className="admin-muted">operator</span>
        </h1>
        <p className="admin-muted">
          Full read and delete access to every workspace on this relay. The panel is served from its
          own entry point and is never linked from the app.
        </p>
        <label className="admin-field">
          <span>Admin token</span>
          <input
            className="admin-input admin-mono"
            type="password"
            autoComplete="off"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="SUITE_ADMIN_TOKEN"
          />
        </label>
        <button
          type="submit"
          className="admin-button admin-button-primary"
          disabled={busy || draft.trim().length === 0}
        >
          {busy ? "Checking…" : "Unlock"}
        </button>
        <ErrorLine message={error} />
        <p className="admin-muted admin-small">
          Kept in this tab's <code>sessionStorage</code> only: never localStorage, never a URL.
          Closing the tab ends the session.
        </p>
      </form>
    </div>
  );
}

export function App() {
  const [token, setToken] = useState<string | null>(() => storedAdminToken());
  const [view, setView] = useState<View>("status");

  if (token === null) {
    return (
      <TokenScreen
        onReady={(value) => {
          rememberAdminToken(value);
          setToken(value);
        }}
      />
    );
  }

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-brand">
          <strong>Suite</strong>
          <span className="admin-muted">operator</span>
        </div>
        <nav className="admin-tabs" aria-label="Admin sections">
          {VIEWS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={entry.id === view ? "admin-tab admin-tab-active" : "admin-tab"}
              onClick={() => setView(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="admin-button"
          onClick={() => {
            forgetAdminToken();
            setToken(null);
            setView("status");
          }}
        >
          Sign out
        </button>
      </header>

      <main className="admin-main">
        {view === "status" ? <StatusPanel token={token} /> : null}
        {view === "workspaces" ? <WorkspacesPanel token={token} /> : null}
        {view === "rooms" ? <RoomsPanel token={token} /> : null}
        {view === "shares" ? <SharesPanel token={token} /> : null}
        {view === "fixtures" ? <FixturesPanel token={token} /> : null}
        {view === "support" ? <SupportPanel token={token} /> : null}
      </main>
    </div>
  );
}
