import { useState } from "react";
import { type ActivityEntry, errorText, listActivity } from "../api";
import { Button, ErrorLine, formatWhen, Muted, PanelHeader, useLoad } from "../ui";

/**
 * What operators have done, newest first.
 *
 * The trail is the answer to "who opened my account, and when" — and the refusals are the
 * reason it exists at all, so they are not hidden behind a filter: an act that was refused
 * shows in the same list, named as refused, because "somebody tried" is the fact an
 * incident review wants.
 *
 * The list pages by keyset. `Load older` carries the `(at, id)` of the last row shown, so a
 * row written while a reader is paging cannot shift the window under them.
 */
const PAGE = 50;

/** A verb as a sentence, because a table of `settings.write` is not for reading. */
const ACTION_COPY: Record<string, string> = {
  impersonate: "Started a support session",
  "impersonate.stop": "Ended a support session",
  "support-access.grant": "Allowed support access",
  "support-access.revoke": "Ended support access",
  "settings.write": "Changed a setting",
  "settings.reset": "Reset a setting",
  "mail.test": "Sent a test message",
  "role.play": "Wore another role",
  "role.clear": "Stopped wearing a role",
  "licence.write": "Wrote a licence",
};

function actionCopy(action: string): string {
  return ACTION_COPY[action] ?? action;
}

export function ActivityPanel() {
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [older, setOlder] = useState<ActivityEntry[]>([]);
  const [before, setBefore] = useState<{ beforeAt: number; beforeId: number } | null>(null);
  const [paging, setPaging] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const filters = {
    limit: PAGE,
    ...(actor.trim().length === 0 ? {} : { actor: actor.trim() }),
    ...(action.trim().length === 0 ? {} : { action: action.trim() }),
  };
  const { data, error, loading, reload } = useLoad(() =>
    listActivity({ ...filters, ...(before === null ? {} : { before }) }),
  );

  const entries = [...(data?.entries ?? []), ...older];

  const loadOlder = async () => {
    const watermark = data?.next ?? null;
    if (watermark === null) return;
    setPaging(true);
    setFailure(null);
    try {
      const page = await listActivity({ ...filters, before: watermark });
      setOlder((current) => [...current, ...page.entries]);
      setBefore(watermark);
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setPaging(false);
    }
  };

  const apply = (next: { actor?: string; action?: string }) => {
    // A new filter starts a new trail: keeping the old rows would mix two questions.
    setOlder([]);
    setBefore(null);
    if (next.actor !== undefined) setActor(next.actor);
    if (next.action !== undefined) setAction(next.action);
    reload();
  };

  return (
    <section className="admin-panel">
      <PanelHeader
        title="Activity"
        description="Every act an operator has taken on this deployment, refusals included. A secret's value is never recorded, only the fact that it was replaced."
        actions={<Button onClick={reload}>Refresh</Button>}
      />

      <div className="admin-row-actions">
        <input
          className="admin-input"
          type="search"
          placeholder="Actor account id"
          aria-label="Filter by actor"
          value={actor}
          onChange={(event) => setActor(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") apply({});
          }}
        />
        <input
          className="admin-input"
          type="search"
          placeholder="Action, e.g. impersonate"
          aria-label="Filter by action"
          value={action}
          onChange={(event) => setAction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") apply({});
          }}
        />
        <Button onClick={() => apply({})}>Apply</Button>
      </div>

      <ErrorLine message={error ?? failure} />
      {loading ? <Muted>Reading the trail…</Muted> : null}
      {!loading && entries.length === 0 ? <Muted>Nothing has been done yet.</Muted> : null}

      {entries.map((entry) => (
        <div className="admin-card admin-activity-row" key={entry.id} data-action={entry.action}>
          <div className="admin-settings-label">
            <strong>{actionCopy(entry.action)}</strong>
            <Muted>
              {formatWhen(entry.at)} · actor <code>{entry.actor}</code> · target{" "}
              <code>{entry.target}</code>
            </Muted>
            {Object.keys(entry.details).length === 0 ? null : (
              <code className="admin-muted">
                {Object.entries(entry.details)
                  .map(([key, value]) => `${key}=${String(value)}`)
                  .join("  ")}
              </code>
            )}
          </div>
          <div className="admin-row-actions">
            <span
              className="admin-settings-source"
              data-source={entry.outcome === "ok" ? "global" : "default"}
            >
              {entry.outcome}
            </span>
          </div>
        </div>
      ))}

      {data?.next === null || data === undefined ? null : (
        <Button disabled={paging} onClick={() => void loadOlder()}>
          {paging ? "Reading…" : "Load older"}
        </Button>
      )}
    </section>
  );
}
