import { useEffect, useState } from "react";
import {
  type AdminAccount,
  beginTotpEnrolment,
  confirmTotp,
  errorText,
  impersonate,
  listAccounts,
  readOwnSession,
  revokeSupportAccess,
  stopImpersonating,
  type TotpEnrolment,
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
  const [needsMfa, setNeedsMfa] = useState(false);

  const accounts = data?.accounts ?? [];

  const impersonateAs = async (account: AdminAccount) => {
    setBusy(account.id);
    setFailure(null);
    try {
      await impersonate(account.id);
      window.sessionStorage.setItem(IMPERSONATING_KEY, account.email);
      setImpersonating(account.email);
    } catch (cause) {
      // An account that may manage people needs a second factor before it may do
      // anything else, and that is a different fix from "the grant is missing".
      setNeedsMfa((cause as { code?: unknown } | null)?.code === "mfa-enrollment-required");
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

      <SecondFactor onEnrolled={() => setNeedsMfa(false)} />

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
      {needsMfa ? (
        <p className="admin-muted" data-testid="mfa-hint">
          Add a second factor to your own account and reload this page:{" "}
          <a className="admin-button" href="/two-factor/enable">
            Enrol an authenticator
          </a>
        </p>
      ) : null}
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

/**
 * The operator's own second factor, enrolled where impersonation lives.
 *
 * The plugin refuses to let an account that can manage people act without one, so this
 * card is the difference between "the feature exists" and "an operator can use it". The
 * secret is shown once as an `otpauth://` URI and the backup codes once; an authenticator
 * app takes the URI, which is why there is no QR image to fetch or render.
 */
function SecondFactor({ onEnrolled }: { onEnrolled: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    readOwnSession()
      .then((session) => {
        if (live) setEnabled(session?.twoFactorEnabled ?? null);
      })
      .catch(() => {
        if (live) setEnabled(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try {
      await work();
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-card admin-settings-group" data-testid="second-factor">
      <h2 className="admin-settings-heading">Your second factor</h2>
      <div className="admin-settings-row">
        <div className="admin-settings-label">
          <Muted>
            {enabled === true
              ? "A second factor is on for this account."
              : "An account that can manage people needs a second factor before it can impersonate or spend, so enrol one here."}
          </Muted>
          <span
            className="admin-settings-source"
            data-source={enabled === true ? "global" : "default"}
          >
            {enabled === true ? "on" : enabled === null ? "unknown" : "off"}
          </span>
          {failure === null ? null : (
            <span role="alert" data-testid="second-factor-error">
              {failure}
            </span>
          )}
        </div>
        <div className="admin-settings-control">
          {enabled === true ? null : enrolment === null ? (
            <>
              <input
                className="admin-input"
                type="password"
                placeholder="Your password"
                aria-label="Your password"
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
              <Button
                disabled={busy || password.length === 0}
                onClick={() =>
                  void run(async () => {
                    setEnrolment(await beginTotpEnrolment(password));
                    setPassword("");
                  })
                }
              >
                Enrol an authenticator
              </Button>
            </>
          ) : (
            <>
              <Muted>
                Add this to your authenticator, then type the code it shows.{" "}
                {enrolment.backupCodes.length} backup codes were issued; they are shown once, in the
                panel below.
              </Muted>
              <code data-testid="totp-uri" className="admin-muted">
                {enrolment.totpURI}
              </code>
              <code data-testid="totp-backup-codes" className="admin-muted">
                {enrolment.backupCodes.join("  ")}
              </code>
              <input
                className="admin-input"
                type="text"
                inputMode="numeric"
                placeholder="6-digit code"
                aria-label="Authenticator code"
                value={code}
                disabled={busy}
                onChange={(event) => setCode(event.target.value)}
              />
              <Button
                disabled={busy || code.trim().length === 0}
                onClick={() =>
                  void run(async () => {
                    await confirmTotp(code);
                    setEnrolment(null);
                    setCode("");
                    setEnabled(true);
                    onEnrolled();
                  })
                }
              >
                Confirm
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
