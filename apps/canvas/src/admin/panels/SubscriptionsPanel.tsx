import { type AdminSubscription, listSubscriptions } from "../api";
import { ErrorLine, formatWhen, Muted, PanelHeader, useLoad } from "../ui";

/**
 * Who is paying, and what for.
 *
 * A subscription belongs to an *organization*. That is the fact worth putting on screen:
 * it is not per workspace and not per person, so "why can't I see my plan here" has an
 * answer, and the answer is the Plan tab in the app, which is the only place a plan is
 * started.
 *
 * Read-only on purpose. Ending somebody's subscription is a billing write with their money
 * behind it, and an operator surface that can do it by a misplaced press is worse than one
 * that cannot.
 */
const STATUS_COPY: Record<string, string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  canceled: "Cancelled",
  unpaid: "Unpaid",
  incomplete: "Incomplete",
  incomplete_expired: "Expired",
  paused: "Paused",
};

function statusCopy(status: string): string {
  return STATUS_COPY[status] ?? status;
}

/** What the plan allows, read from the row the entitlement read would use. */
function ceilingCopy(row: AdminSubscription): string {
  return row.seats === null ? "—" : `${String(row.seats)} seat${row.seats === 1 ? "" : "s"}`;
}

export function SubscriptionsPanel() {
  const { data, error, loading, reload } = useLoad(listSubscriptions);
  const rows = data?.subscriptions ?? [];
  const live = rows.filter((row) => row.status === "active" || row.status === "trialing").length;

  return (
    <section className="admin-panel" data-testid="subscriptions-panel">
      <PanelHeader
        title="Subscriptions"
        description="One row per organization. A plan is changed by that organization in the app, on its Plan tab."
        actions={
          <button type="button" className="admin-button" onClick={reload}>
            Refresh
          </button>
        }
      />
      <ErrorLine message={error} />
      {loading ? <Muted>Reading subscriptions…</Muted> : null}
      {!loading && rows.length === 0 ? (
        <Muted>
          No subscription has ever been written here. A deployment with billing off never creates
          the table, and that is not an error.
        </Muted>
      ) : null}
      {rows.length > 0 ? (
        <p className="admin-muted" data-testid="subscriptions-summary">
          {String(live)} live of {String(rows.length)}.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <table className="admin-table" data-testid="subscriptions-table">
          <thead>
            <tr>
              <th scope="col">Organization</th>
              <th scope="col">Plan</th>
              <th scope="col">Status</th>
              <th scope="col">Seats</th>
              <th scope="col">Renews or ends</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.organizationId}-${row.plan}-${row.status}`}>
                <td>
                  <strong>{row.organizationName ?? "Unnamed organization"}</strong>
                  <div className="admin-muted admin-mono">{row.organizationId}</div>
                </td>
                <td>{row.plan}</td>
                <td>
                  {statusCopy(row.status)}
                  {row.cancelAtPeriodEnd ? (
                    <div className="admin-muted">Ends at the period end</div>
                  ) : null}
                </td>
                <td>{ceilingCopy(row)}</td>
                <td>{formatWhen(row.periodEnd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {rows.length > 0 ? (
        <p className="admin-muted">
          A row appears within a second of the webhook that wrote it, so a checkout that succeeded
          and left no row is a delivery to chase rather than a billing bug.
        </p>
      ) : null}
    </section>
  );
}
