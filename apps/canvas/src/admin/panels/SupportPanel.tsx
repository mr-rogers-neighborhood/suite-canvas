import { useMemo, useState } from "react";
import {
  buildDiagnosticBundle,
  copyText,
  type DiagnosticBundle,
  diagnosticsFileName,
  type ServerStats,
  saveDiagnosticBundle,
} from "../../shell/diagnostics";
import { type AdminStatus, getRelayHealth, getStatus } from "../api";
import { ErrorLine, formatBytes, Muted, PanelHeader, useLoad } from "../ui";

/**
 * Support, and the one thing a support ticket needs beside it: a truthful status
 * statement and a bundle that can be attached to the message.
 *
 * The status line is read live from `/health` and never invented. It says when it
 * asked, so "the relay was reachable two minutes ago" cannot be mistaken for "it
 * is up now", and there is no uptime percentage here: this process keeps no
 * history, so any number would be a fiction.
 */

function statusSentence(health: { ok: boolean; status: number; at: number } | null): string {
  if (health === null) return "Asking the relay…";
  const when = new Date(health.at).toLocaleTimeString();
  if (health.ok) return `The relay answered /health 200 when this page asked, at ${when}.`;
  if (health.status === 0) return `The relay could not be reached at ${when}.`;
  return `The relay answered /health with ${health.status} at ${when}.`;
}

function storesOf(status: AdminStatus): ServerStats["stores"] {
  return Object.entries(status.databases).map(([name, database]) => ({
    name,
    bytes: database.bytes,
    ok: database.ok,
  }));
}

export function SupportPanel({ token }: { token: string }) {
  const health = useLoad(() => getRelayHealth());
  const status = useLoad(() => getStatus(token));
  const [copied, setCopied] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const server: ServerStats | null = useMemo(() => {
    if (health.data === null || status.data === null) return null;
    return {
      relayHealth: health.data.ok ? "ok" : "unreachable",
      controlPlane: null,
      rooms: status.data.rooms,
      stores: storesOf(status.data),
      limits: status.data.limits,
    };
  }, [health.data, status.data]);

  const bundle: DiagnosticBundle = useMemo(
    () =>
      buildDiagnosticBundle({
        route: `${window.location.origin}/admin#support`,
        storage: { persist: "unknown", estimate: { usage: null, quota: null }, quota: null },
        connection: statusSentence(health.data),
        config: {
          // The panel is served beside the API, so the page origin is the relay.
          relay: window.location.origin,
          surface: "admin",
          session: "operator",
          online: navigator.onLine,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          userAgent: navigator.userAgent,
          language: navigator.language,
        },
        server,
      }),
    [health.data, server],
  );

  // The operator token is in `sessionStorage` and the bundle is built from an
  // allowlist that has no field for it, so copying cannot leak it.
  const copy = async () => {
    const text = `${JSON.stringify(bundle, null, 2)}\n`;
    setCopied((await copyText(text)) ? "done" : "failed");
  };

  const download = () => {
    try {
      setSaved(saveDiagnosticBundle(bundle));
    } catch {
      setSaved("failed");
    }
  };

  return (
    <section className="admin-panel">
      <PanelHeader
        title="Support"
        description="A status statement you can quote, and a bundle you can attach to a ticket."
        actions={
          <button type="button" className="admin-button" onClick={health.reload}>
            Check again
          </button>
        }
      />
      <ErrorLine message={health.error} />

      <article className="admin-card">
        <h3>Status</h3>
        <p data-testid="support-status" className="admin-muted">
          {statusSentence(health.data)}
        </p>
        <p className="admin-muted admin-small">
          This is a point-in-time readiness answer, not an uptime figure: the relay keeps no history
          of it. A degraded answer means a process answered and at least one module is missing; an
          unreachable one means the request never arrived.
        </p>
      </article>

      <article className="admin-card">
        <h3>Talk to someone</h3>
        <ul className="admin-muted">
          <li>
            <a
              href="https://github.com/mr-rogers-neighborhood/suite/issues/new"
              target="_blank"
              rel="noreferrer noopener"
            >
              Open an issue
            </a>{" "}
            — for anything that is not a vulnerability.
          </li>
          <li>
            <a
              href="https://github.com/mr-rogers-neighborhood/suite/blob/main/SECURITY.md"
              target="_blank"
              rel="noreferrer noopener"
            >
              Report a vulnerability privately
            </a>
            . Never put a session token, a share link or a licence key in a public issue.
          </li>
          <li>
            A self-hosted deployment answers at whatever address its operator configured; this page
            cannot know it, so it does not invent one.
          </li>
        </ul>
      </article>

      <article className="admin-card">
        <h3>Diagnostics bundle</h3>
        <p className="admin-muted admin-small">
          Build, redacted configuration, room and store statistics, document counts, the last ten
          errors and the request ids this page saw. It carries no session token, no share token, no
          licence key, no admin token, no card content and no attachment bytes — the bundle is built
          from an allowlist, not filtered afterwards.
        </p>
        <p className="admin-mono admin-small" data-testid="support-bundle-name">
          {diagnosticsFileName(bundle)}
        </p>
        <div className="admin-actions">
          <button type="button" className="admin-button" onClick={() => void copy()}>
            {copied === "done" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy bundle"}
          </button>
          <button type="button" className="admin-button" onClick={download}>
            {saved === null ? "Download bundle" : saved === "failed" ? "Download failed" : "Saved"}
          </button>
        </div>
        {server === null ? (
          <Muted>Room and store statistics need the operator token that opened this panel.</Muted>
        ) : (
          <dl className="admin-facts">
            <div className="admin-fact">
              <dt>Rooms</dt>
              <dd>
                {server.rooms?.total ?? 0} open, {server.rooms?.clients ?? 0} clients
              </dd>
            </div>
            {(server.stores ?? []).map((store) => (
              <div className="admin-fact" key={store.name}>
                <dt>{store.name}</dt>
                <dd>
                  {formatBytes(store.bytes)}
                  {store.ok ? "" : " (unreadable)"}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </article>
    </section>
  );
}
