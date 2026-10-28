import { useState } from "react";
import {
  type AdminAccount,
  errorText,
  impersonate,
  listAccounts,
  revokeSupportAccess,
  stopImpersonating,
} from "../api";
import { Button, ConfirmButton, ErrorLine, formatWhen, Muted, PanelHeader, useLoad } from "../ui";

/**
 * People, and the support access that makes an impersonation possible.
 *
 * The panel can start an impersonation but not permit one: consent is the account's own
 * row, and an operator may only end it. The list therefore shows three facts per person —
 * whether they allow support, when they allowed it, and whether the mechanism would even
 * work for them — because "the button is disabled" without a reason is the sort of thing
 * that turns into a support ticket.
 *
 * Impersonation swaps the browser's own cookies, so this screen cannot keep a flag in
 * React state across a reload: the banner reads `sessionStorage`, which is the one place
 * that survives and is thrown away when the tab is closed.
 */
const IMPERSONATING_KEY = "suite.admin.impersonating";

export function AccountsPanel() {
  const [query, setQuery] = useState("");
  const { data, error, loading, reload } = useLoad(() => listAccounts(query));
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [impersonating, setImpersonating] = useState<string | null>(() =>
    window.sessionStorage.getItem(IMPERSONATING_KEY),
  );

  const accounts = data?.accounts ?? [];

  const impersonateAs = async (account: AdminAccount) => {
    setBusy(account.id);
    setFailure(null);
    try {
      await impersonate(account.id);
      window.sessionStorage.setItem(IMPERSONATING_KEY, account.email);
      setImpersonating(account.email);
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    setBusy("stop");
    setFailure(null);
    try {
      await stopImpersonating();
      window.sessionStorage.removeItem(IMPERSONATING_KEY);
      setImpersonating(null);
      reload();
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  const revoke = async (account: AdminAccount) => {
    setFailure(null);
    try {
      await revokeSupportAccess(account.id);
      reload();
    } catch (cause) {
      setFailure(errorText(cause));
    }
  };

  return (
    <section className="admin-panel">
      <PanelHeader
        title="Accounts"
        description="Search for a person, then become them for a support session. An account has to allow support access first, from its own settings; that consent is what the request reads, and it can be taken back at any time."
        actions={<Button onClick={reload}>Refresh</Button>}
      />

      {impersonating === null ? null : (
        <p className="admin-warning" role="status" data-testid="impersonation-banner">
          You are signed in as <strong>{impersonating}</strong>. Operator routes answer 403 until
          you stop.
          <Button disabled={busy === "stop"} onClick={() => void stop()}>
            Stop impersonating
          </Button>
        </p>
      )}

      <div className="admin-row-actions">
        <input
          className="admin-input"
          type="search"
          placeholder="Search by address or name"
          aria-label="Search accounts"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") reload();
          }}
        />
        <Button onClick={reload}>Search</Button>
      </div>

      <ErrorLine message={error ?? failure} />
      {loading ? <Muted>Reading accounts…</Muted> : null}
      {!loading && accounts.length === 0 ? <Muted>No account matches that.</Muted> : null}

      {accounts.map((account) => {
        const { granted, grantedAt } = account.supportAccess;
        const reason = !granted
          ? "This account has not allowed support access."
          : !account.twoFactorEnabled
            ? "This account has no second factor, and the plugin refuses an impersonation without one."
            : null;
        return (
          <div className="admin-card admin-settings-row" key={account.id} data-account={account.id}>
            <div className="admin-settings-label">
              <strong>{account.email}</strong>
              <Muted>
                {account.name ?? "No name"} · {account.role ?? "member"}
                {account.twoFactorEnabled ? " · 2FA on" : " · no 2FA"}
              </Muted>
              <span className="admin-settings-source" data-source={granted ? "global" : "default"}>
                {granted ? `support access since ${formatWhen(grantedAt)}` : "no support access"}
              </span>
            </div>
            <div className="admin-row-actions">
              <Button
                tone="primary"
                disabled={busy === account.id || reason !== null}
                {...(reason === null ? {} : { title: reason })}
                onClick={() => void impersonateAs(account)}
              >
                Impersonate
              </Button>
              {granted ? (
                <ConfirmButton
                  label="End access"
                  confirmLabel="End it"
                  title="Take the consent away. Only the account can give it back."
                  onConfirm={() => revoke(account)}
                />
              ) : null}
            </div>
          </div>
        );
      })}
    </section>
  );
}
