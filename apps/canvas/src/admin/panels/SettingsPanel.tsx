import { useState } from "react";
import {
  type AdminSetting,
  errorText,
  listSettings,
  resetSetting,
  sendTestMail,
  writeSetting,
} from "../api";
import { Button, ErrorLine, Muted, PanelHeader, useLoad } from "../ui";

/**
 * The deployment's settings, editable without touching AWS or a redeploy.
 *
 * Every row shows its value *and* the level that answered it: a value from the environment
 * is a boot default, so saving a row here is what makes the panel win. Secrets are
 * write-only — the API returns a mask, and there is no way to read one back from this
 * screen, which is the point.
 *
 * The Stripe mode sits at the top because it is the one switch that changes what the
 * deployment *is*: test mode spends nothing and live mode charges people.
 */
export function SettingsPanel() {
  const { data, error, loading, reload } = useLoad(() => listSettings());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [confirmLive, setConfirmLive] = useState("");
  const [mailTo, setMailTo] = useState("");
  const [mailResult, setMailResult] = useState<string | null>(null);
  const [mailBusy, setMailBusy] = useState(false);

  const settings = data?.settings ?? [];
  const mode = settings.find((entry) => entry.key === "billing.mode")?.value;

  const save = async (setting: AdminSetting, value: string | number | boolean) => {
    setBusy(setting.key);
    setFailure(null);
    try {
      await writeSetting(setting.key, value);
      reload();
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  const reset = async (setting: AdminSetting) => {
    setBusy(setting.key);
    setFailure(null);
    try {
      await resetSetting(setting.key);
      reload();
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="admin-panel">
      <PanelHeader
        title="Settings"
        description="A row saved here beats the environment, and Reset returns to it. Billing and mail are read once when the control plane boots, so those apply on its next restart; everything else applies on the next request."
        actions={<Button onClick={reload}>Refresh</Button>}
      />
      <ErrorLine message={error ?? failure} />
      {loading ? <Muted>Reading settings…</Muted> : null}

      {mode === "live" ? (
        <p className="admin-warning" role="status" data-testid="billing-live-warning">
          Billing is in <strong>live</strong> mode: checkouts charge real cards, and only the{" "}
          <code>_LIVE</code> key, webhook secret and prices are read. Fill those in before
          switching, or billing switches itself off.
        </p>
      ) : null}

      {/* The mail rows are only worth filling in if a message arrives, so the proof sits
          beside them rather than in another tab. */}
      {settings.some((entry) => entry.group === "mail") ? (
        <div className="admin-card admin-settings-group" data-group="mail-test">
          <h2 className="admin-settings-heading">Send a test message</h2>
          <div className="admin-settings-row">
            <div className="admin-settings-label">
              <Muted>
                Sends one message with the transport these rows configure, so a wrong password shows
                up here instead of in a stranger's sign-up.
              </Muted>
              {mailResult === null ? null : (
                <span role="status" data-testid="mail-test-result">
                  {mailResult}
                </span>
              )}
            </div>
            <div className="admin-settings-control">
              <input
                className="admin-input"
                type="email"
                placeholder="you@example.com"
                aria-label="Test message recipient"
                value={mailTo}
                disabled={mailBusy}
                onChange={(event) => setMailTo(event.target.value)}
              />
              <Button
                disabled={mailBusy || mailTo.trim().length === 0}
                onClick={() => {
                  setMailBusy(true);
                  setMailResult(null);
                  sendTestMail(mailTo.trim())
                    .then((answer) => setMailResult(`Handed to the ${answer.transport} transport.`))
                    .catch((cause: unknown) => setMailResult(errorText(cause)))
                    .finally(() => setMailBusy(false));
                }}
              >
                {mailBusy ? "Sending…" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {["billing", "mail", "licence", "backup", "limits", "flags"].map((group) => {
        const rows = settings.filter((entry) => entry.group === group);
        if (rows.length === 0) return null;
        return (
          <div key={group} className="admin-card admin-settings-group" data-group={group}>
            <h2 className="admin-settings-heading">{group}</h2>
            {rows.map((setting) => {
              const draft = drafts[setting.key];
              const isSecret = setting.kind === "secret";
              const current = isSecret ? "" : String(setting.value ?? "");
              const bootedAt = data?.bootedAt ?? 0;
              const needsRestart =
                (setting.group === "billing" || setting.group === "mail") &&
                typeof setting.savedAt === "number" &&
                setting.savedAt > bootedAt;
              return (
                <div
                  className="admin-settings-row"
                  key={setting.key}
                  data-testid={`setting-${setting.key}`}
                >
                  <div className="admin-settings-label">
                    <code>{setting.key}</code>
                    <Muted>{setting.help}</Muted>
                    <span className="admin-settings-source" data-source={setting.source}>
                      {sourceLabel(setting)}
                    </span>
                    {needsRestart ? (
                      // Billing and mail are read once, when the process starts. A row
                      // written since then is saved and not yet in force, and saying so is
                      // the difference between "my key does nothing" and "restart it".
                      <span
                        className="admin-settings-restart"
                        data-testid={`restart-${setting.key}`}
                      >
                        Restart to apply
                      </span>
                    ) : null}
                  </div>
                  <div className="admin-settings-control">
                    {setting.kind === "boolean" ? (
                      // The label names the *action*, not the state: a button reading "Off"
                      // looks like a state to confirm, and pressing it to "enable" that state
                      // writes the opposite. The state is beside it, unclickable.
                      <div className="admin-row-actions">
                        <span
                          className="admin-settings-state"
                          data-on={setting.value === true ? "true" : "false"}
                        >
                          {setting.value === true ? "On" : "Off"}
                        </span>
                        <Button
                          disabled={busy === setting.key}
                          onClick={() => void save(setting, setting.value !== true)}
                        >
                          {setting.value === true ? "Turn off" : "Turn on"}
                        </Button>
                      </div>
                    ) : setting.kind === "enum" ? (
                      <div className="admin-settings-chips">
                        {(setting.values ?? []).map((option) => (
                          <Button
                            key={option}
                            tone={setting.value === option ? "primary" : "default"}
                            disabled={busy === setting.key}
                            onClick={() => {
                              // Live is the one value with a gate: the reader types it.
                              if (option === "live") {
                                if (confirmLive.trim().toLowerCase() !== "live") return;
                                setConfirmLive("");
                              }
                              void save(setting, option);
                            }}
                          >
                            {option}
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <input
                        className="admin-input"
                        type={isSecret ? "password" : setting.kind === "number" ? "number" : "text"}
                        placeholder={isSecret ? "•••••••• (write-only)" : current}
                        value={draft ?? current}
                        disabled={busy === setting.key}
                        onChange={(event) =>
                          setDrafts({ ...drafts, [setting.key]: event.target.value })
                        }
                        onKeyDown={(event) => {
                          if (event.key !== "Enter") return;
                          if (isSecret && (draft ?? "").length === 0) return;
                          void save(setting, draft ?? current);
                          setDrafts({ ...drafts, [setting.key]: "" });
                        }}
                      />
                    )}
                    {setting.kind === "boolean" || setting.kind === "enum" ? null : (
                      <Button
                        disabled={busy === setting.key || (isSecret && (draft ?? "").length === 0)}
                        onClick={() => {
                          void save(setting, draft ?? current);
                          setDrafts({ ...drafts, [setting.key]: "" });
                        }}
                      >
                        Save
                      </Button>
                    )}
                    <Button disabled={busy === setting.key} onClick={() => void reset(setting)}>
                      Reset
                    </Button>
                  </div>
                </div>
              );
            })}
            {group === "billing" ? (
              <label className="admin-settings-row">
                <div className="admin-settings-label">
                  <code>confirm live</code>
                  <Muted>
                    Switching to live needs the word typed here first, so a mis-click cannot start
                    charging.
                  </Muted>
                </div>
                <div className="admin-settings-control">
                  <input
                    className="admin-input"
                    value={confirmLive}
                    placeholder="type live"
                    onChange={(event) => setConfirmLive(event.target.value)}
                    aria-label="Type live to confirm"
                  />
                </div>
              </label>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

/** What to call the level that answered, so "why is this value here" needs no docs. */
function sourceLabel(setting: AdminSetting): string {
  switch (setting.source) {
    case "organization":
      return "set for this organization";
    case "global":
      return "set here";
    case "env":
      return setting.env ? `from ${setting.env}` : "from the environment";
    default:
      return "built-in default";
  }
}
