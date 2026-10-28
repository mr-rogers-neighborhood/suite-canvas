import { type AdminStatus, getStatus } from "../api";
import { ErrorLine, formatBytes, formatUptime, Muted, PanelHeader, useLoad } from "../ui";

function DatabaseRow({
  name,
  database,
}: {
  name: string;
  database: AdminStatus["databases"][keyof AdminStatus["databases"]];
}) {
  return (
    <div className="admin-fact">
      <dt>{name}</dt>
      <dd>
        <span className={database.ok ? "admin-badge admin-badge-ok" : "admin-badge"}>
          {database.ok ? "ok" : "unreadable"}
        </span>{" "}
        {formatBytes(database.bytes)}
        {database.path ? (
          <span className="admin-mono admin-muted admin-path">{database.path}</span>
        ) : null}
      </dd>
    </div>
  );
}

export function StatusPanel() {
  const status = useLoad(() => getStatus());
  const data = status.data;

  return (
    <section className="admin-panel">
      <PanelHeader
        title="Status"
        description="Process, databases, rooms and the limits this server enforces."
        actions={
          <button type="button" className="admin-button" onClick={status.reload}>
            Refresh
          </button>
        }
      />
      <ErrorLine message={status.error} />
      {data === null ? (
        status.loading ? (
          <Muted>Loading…</Muted>
        ) : null
      ) : (
        <div className="admin-cards">
          <article className="admin-card">
            <h3>Process</h3>
            <dl className="admin-facts">
              <div className="admin-fact">
                <dt>Uptime</dt>
                <dd>{formatUptime(data.uptimeMs)}</dd>
              </div>
              <div className="admin-fact">
                <dt>Node</dt>
                <dd className="admin-mono">{data.node}</dd>
              </div>
              <div className="admin-fact">
                <dt>PID</dt>
                <dd className="admin-mono">{data.pid}</dd>
              </div>
              <div className="admin-fact">
                <dt>Admin API</dt>
                <dd>{data.admin.enabled ? "enabled" : "disabled"}</dd>
              </div>
            </dl>
          </article>

          <article className="admin-card">
            <h3>Databases</h3>
            <dl className="admin-facts">
              <DatabaseRow name="Documents" database={data.databases.documents} />
              <DatabaseRow name="Shares" database={data.databases.shares} />
              <DatabaseRow name="Workspaces" database={data.databases.workspaces} />
            </dl>
          </article>

          <article className="admin-card">
            <h3>Rooms</h3>
            <dl className="admin-facts">
              <div className="admin-fact">
                <dt>Socket rooms</dt>
                <dd>{data.rooms.total}</dd>
              </div>
              <div className="admin-fact">
                <dt>With workers</dt>
                <dd>{data.rooms.workers}</dd>
              </div>
              <div className="admin-fact">
                <dt>Clients</dt>
                <dd>{data.rooms.clients}</dd>
              </div>
            </dl>
          </article>

          <article className="admin-card">
            <h3>Limits</h3>
            <dl className="admin-facts">
              <div className="admin-fact">
                <dt>Shares / workspace</dt>
                <dd>{data.limits.sharesPerWorkspace}</dd>
              </div>
              <div className="admin-fact">
                <dt>Selection cards</dt>
                <dd>{data.limits.selectionCards}</dd>
              </div>
              <div className="admin-fact">
                <dt>Publishes / minute</dt>
                <dd>{data.limits.publishPerMinute}</dd>
              </div>
              <div className="admin-fact">
                <dt>Claims / minute</dt>
                <dd>{data.limits.claimPerMinute}</dd>
              </div>
            </dl>
          </article>
        </div>
      )}
    </section>
  );
}
