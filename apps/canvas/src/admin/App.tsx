import { useEffect, useState } from "react";
import { signOut } from "../auth/client";
import { errorText, getStatus, type RoleOverrideState, readRoleOverride, stopRole } from "./api";
import { AccountsPanel } from "./panels/AccountsPanel";
import { ActivityPanel } from "./panels/ActivityPanel";
import { FixturesPanel } from "./panels/FixturesPanel";
import { RoomsPanel } from "./panels/RoomsPanel";
import { SettingsPanel } from "./panels/SettingsPanel";
import { SharesPanel } from "./panels/SharesPanel";
import { StatusPanel } from "./panels/StatusPanel";
import { SupportPanel } from "./panels/SupportPanel";
import { TemplatesPanel } from "./panels/TemplatesPanel";
import { WorkspacesPanel } from "./panels/WorkspacesPanel";

type View =
  | "status"
  | "accounts"
  | "activity"
  | "workspaces"
  | "rooms"
  | "shares"
  | "templates"
  | "fixtures"
  | "settings"
  | "support";

/**
 * Four groups, with the views inside them.
 *
 * Ten flat tabs was a wall, and two more arrived with the audit trail and the licence
 * controls. The grouping is by *question* rather than by subsystem, because that is how an
 * operator arrives: what is this deployment doing, who is here, what data is on it, what
 * content does it hold.
 */
const GROUPS: { id: string; label: string; views: { id: View; label: string }[] }[] = [
  {
    id: "deployment",
    label: "This deployment",
    views: [
      { id: "status", label: "Status" },
      { id: "settings", label: "Settings" },
      { id: "support", label: "Support" },
    ],
  },
  {
    id: "people",
    label: "People",
    views: [
      { id: "accounts", label: "Accounts" },
      { id: "activity", label: "Activity" },
    ],
  },
  {
    id: "workspaces",
    label: "Workspaces",
    views: [
      { id: "workspaces", label: "All workspaces" },
      { id: "rooms", label: "Rooms" },
      { id: "shares", label: "Shares" },
    ],
  },
  {
    id: "content",
    label: "Content",
    views: [
      { id: "templates", label: "Templates" },
      { id: "fixtures", label: "Fixtures" },
    ],
  },
];

/** The group a view belongs to, so opening `#rooms` shows the Workspaces group. */
function groupOf(view: View): string {
  return GROUPS.find((group) => group.views.some((entry) => entry.id === view))?.id ?? "deployment";
}

/**
 * The gate: an account, not a pasted secret.
 *
 * The panel is a static entry point with no session of its own, so it asks the same
 * account API the app uses who is signed in, and then asks the operator routes whether
 * that account is on the deployment's list. The two answers are different refusals — a
 * 401 means "not signed in" and a 403 means "signed in, not an operator" — and the
 * panel says which one it got, because "your account is not an operator" is a fact the
 * reader can act on and "the token was rejected" was not.
 */
function Gate({ onReady }: { onReady: () => void }) {
  const [state, setState] = useState<"checking" | "ready" | "anonymous" | "denied" | "failed">(
    "checking",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        await getStatus();
        if (live) setState("ready");
      } catch (cause) {
        if (!live) return;
        const status = (cause as { status?: number }).status;
        if (status === 401) setState("anonymous");
        else if (status === 403) setState("denied");
        else {
          setError(errorText(cause));
          setState("failed");
        }
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (state === "ready") {
    onReady();
    return null;
  }

  return (
    <div className="admin-gate">
      <div className="admin-card admin-gate-card">
        <h1>
          Suite <span className="admin-muted">operator</span>
        </h1>
        {state === "checking" ? <p className="admin-muted">Checking your session…</p> : null}
        {state === "anonymous" ? (
          <>
            <p className="admin-muted">
              This panel reads and deletes every workspace on this relay. Sign in with an account
              this deployment named as an operator.
            </p>
            <a className="admin-button admin-button-primary" href="/admin.html">
              Sign in in the app, then reload this page
            </a>
          </>
        ) : null}
        {state === "denied" ? (
          <p className="admin-muted">
            You are signed in, and this account is not an operator on this deployment. Ask whoever
            runs it to add your address to <code>SUITE_ADMIN_EMAILS</code>.
          </p>
        ) : null}
        {state === "failed" ? <p className="admin-muted">{error}</p> : null}
      </div>
    </div>
  );
}

export function App() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("status");
  const [worn, setWorn] = useState<RoleOverrideState | null>(null);

  // Read once the gate has admitted the operator: a worn role is session state, so a
  // reload keeps it and the topbar says so from the first paint.
  useEffect(() => {
    if (!ready) return;
    let live = true;
    readRoleOverride()
      .then((state) => {
        if (live) setWorn(state.role === null ? null : state);
      })
      .catch(() => {
        if (live) setWorn(null);
      });
    return () => {
      live = false;
    };
  }, [ready]);

  if (!ready) return <Gate onReady={() => setReady(true)} />;

  return (
    <div className="admin-shell">
      <header className="admin-topbar">
        <div className="admin-brand">
          <strong>Suite</strong>
          <span className="admin-muted">operator</span>
        </div>
        <nav className="admin-nav" aria-label="Admin sections">
          <div className="admin-tabs" role="tablist" aria-label="Groups">
            {GROUPS.map((group) => (
              <button
                key={group.id}
                type="button"
                role="tab"
                aria-selected={group.id === groupOf(view)}
                data-testid={`admin-group-${group.id}`}
                className={group.id === groupOf(view) ? "admin-tab admin-tab-active" : "admin-tab"}
                onClick={() => setView(group.views[0]?.id ?? "status")}
              >
                {group.label}
              </button>
            ))}
          </div>
          <div className="admin-tabs admin-subtabs" role="tablist" aria-label="Views">
            {(GROUPS.find((group) => group.id === groupOf(view))?.views ?? []).map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={entry.id === view}
                aria-current={entry.id === view ? "page" : undefined}
                data-testid={`admin-view-${entry.id}`}
                className={entry.id === view ? "admin-tab admin-tab-active" : "admin-tab"}
                onClick={() => setView(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </nav>
        {worn?.role == null ? null : (
          <span className="admin-worn" data-testid="worn-role" data-role={worn.role}>
            wearing <strong>{worn.role}</strong>
            <button
              type="button"
              className="admin-button"
              onClick={() => {
                stopRole()
                  .then(() => setWorn(null))
                  .catch(() => setWorn(null));
              }}
            >
              Stop
            </button>
          </span>
        )}
        <button
          type="button"
          className="admin-button"
          onClick={() => {
            void signOut();
            setReady(false);
            setView("status");
          }}
        >
          Sign out
        </button>
      </header>

      <main className="admin-main">
        {view === "status" ? <StatusPanel /> : null}
        {view === "accounts" ? (
          <AccountsPanel onRoleChange={(state) => setWorn(state.role === null ? null : state)} />
        ) : null}
        {view === "activity" ? <ActivityPanel /> : null}
        {view === "workspaces" ? <WorkspacesPanel /> : null}
        {view === "rooms" ? <RoomsPanel /> : null}
        {view === "shares" ? <SharesPanel /> : null}
        {view === "templates" ? <TemplatesPanel /> : null}
        {view === "fixtures" ? <FixturesPanel /> : null}
        {view === "settings" ? <SettingsPanel /> : null}
        {view === "support" ? <SupportPanel /> : null}
      </main>
    </div>
  );
}
