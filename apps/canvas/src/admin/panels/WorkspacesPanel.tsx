import { Fragment, useState } from "react";
import {
  type AdminShare,
  clearLicence,
  deleteWorkspace,
  downloadExport,
  errorText,
  getWorkspace,
  listWorkspaces,
  revokeAllShares,
  revokeShare,
  type WorkspaceDetail,
  type WorkspaceLicence,
  type WorkspaceRow,
  writeLicence,
} from "../api";
import {
  Button,
  ConfirmButton,
  CopyButton,
  ErrorLine,
  formatBytes,
  formatWhen,
  Muted,
  PanelHeader,
  shortId,
  useLoad,
} from "../ui";

function DeleteConfirm({
  id,
  onDelete,
  onCancel,
}: {
  id: string;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");
  return (
    <div className="admin-inline-confirm">
      <span>
        Type <code className="admin-mono">{id}</code> to confirm deletion.
      </span>
      <input
        className="admin-input admin-mono"
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        aria-label="Workspace id confirmation"
      />
      <Button
        tone="danger"
        disabled={typed.trim() !== id}
        onClick={() => void onDelete().catch(() => undefined)}
      >
        Delete workspace
      </Button>
      <Button onClick={onCancel}>Cancel</Button>
    </div>
  );
}

function ShareTable({
  shares,
  onRevoke,
}: {
  shares: AdminShare[];
  onRevoke: (share: AdminShare) => Promise<void>;
}) {
  if (shares.length === 0) return <Muted>No active links.</Muted>;
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>Share</th>
          <th>Scope</th>
          <th>Role</th>
          <th>Cards</th>
          <th>Created</th>
          <th>Expires</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {shares.map((share) => (
          <tr key={share.id}>
            <td className="admin-mono">{shortId(share.id, 22)}</td>
            <td>
              {share.scope}
              {share.boardId ? (
                <span className="admin-muted"> · {shortId(share.boardId, 14)}</span>
              ) : null}
              {share.cardId ? (
                <span className="admin-muted"> · {shortId(share.cardId, 14)}</span>
              ) : null}
            </td>
            <td>{share.role}</td>
            <td>{share.cardCount}</td>
            <td>{formatWhen(share.createdAt)}</td>
            <td>{share.expiresAt === null ? "never" : formatWhen(share.expiresAt)}</td>
            <td className="admin-actions">
              <ConfirmButton
                label="Revoke"
                confirmLabel="Confirm revoke"
                onConfirm={() => onRevoke(share)}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Detail({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = useLoad<WorkspaceDetail>(() => getWorkspace(id));
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const revoke = async (share: AdminShare) => {
    setError(null);
    try {
      await revokeShare(share.id);
      detail.reload();
      onChanged();
    } catch (cause) {
      setError(errorText(cause));
      throw cause;
    }
  };

  const exportFile = async () => {
    setError(null);
    setExporting(true);
    try {
      await downloadExport(id);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setExporting(false);
    }
  };

  const data = detail.data;

  return (
    <section className="admin-card admin-detail">
      <PanelHeader
        title="Workspace detail"
        description={id}
        actions={
          <>
            <Button onClick={() => void exportFile()} disabled={exporting}>
              {exporting ? "Exporting…" : "Export .suite"}
            </Button>
            <Button onClick={onClose}>Close</Button>
          </>
        }
      />
      <ErrorLine message={error ?? detail.error} />
      {data === null ? (
        detail.loading ? (
          <Muted>Loading…</Muted>
        ) : null
      ) : (
        <>
          <dl className="admin-facts admin-facts-wide">
            <div className="admin-fact">
              <dt>Claimed</dt>
              <dd>{data.claimed ? "yes" : "no"}</dd>
            </div>
            <div className="admin-fact">
              <dt>Document</dt>
              <dd>{formatBytes(data.documentBytes)}</dd>
            </div>
            <div className="admin-fact">
              <dt>Boards</dt>
              <dd>{data.boards}</dd>
            </div>
            <div className="admin-fact">
              <dt>Cards</dt>
              <dd>{data.cards}</dd>
            </div>
            <div className="admin-fact">
              <dt>Sections</dt>
              <dd>{data.sections}</dd>
            </div>
            <div className="admin-fact">
              <dt>Types / tags</dt>
              <dd>
                {data.types} / {data.tags}
              </dd>
            </div>
            <div className="admin-fact">
              <dt>Schema</dt>
              <dd>{data.schemaVersion ?? "—"}</dd>
            </div>
            <div className="admin-fact">
              <dt>Last save</dt>
              <dd>{formatWhen(data.lastSavedAt)}</dd>
            </div>
          </dl>
          <div className="admin-mono admin-muted admin-versions">
            peers:{" "}
            {Object.entries(data.versions)
              .map(([peer, counter]) => `${shortId(peer, 10)}@${counter}`)
              .join("  ") || "none"}
          </div>
          <h3>Links</h3>
          <ShareTable shares={data.shareList} onRevoke={revoke} />
        </>
      )}
    </section>
  );
}

export function WorkspacesPanel() {
  const list = useLoad(() => listWorkspaces());
  const [selected, setSelected] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [detailVersion, setDetailVersion] = useState(0);

  const act = async (run: () => Promise<unknown>): Promise<void> => {
    setActionError(null);
    try {
      await run();
      list.reload();
      setDetailVersion((value) => value + 1);
    } catch (cause) {
      setActionError(errorText(cause));
      throw cause;
    }
  };

  return (
    <section className="admin-panel">
      <PanelHeader
        title="Workspaces"
        description={
          list.data === null
            ? undefined
            : `${list.data.total} stored workspace${list.data.total === 1 ? "" : "s"}`
        }
        actions={
          <Button onClick={list.reload} disabled={list.loading}>
            {list.loading ? "Loading…" : "Refresh"}
          </Button>
        }
      />
      <ErrorLine message={actionError ?? list.error} />
      {list.data === null ? (
        list.loading ? (
          <Muted>Loading…</Muted>
        ) : null
      ) : list.data.workspaces.length === 0 ? (
        <Muted>No workspaces are stored on this relay.</Muted>
      ) : (
        <div className="admin-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Workspace</th>
                <th>Claimed</th>
                <th>Document</th>
                <th>Boards</th>
                <th>Cards</th>
                <th>Sections</th>
                <th>Links</th>
                <th>Licence</th>
                <th>Last save</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.workspaces.map((row) => (
                <Fragment key={row.id}>
                  <tr className={selected === row.id ? "admin-row-selected" : undefined}>
                    <td className="admin-mono admin-id">
                      <span title={row.id}>{shortId(row.id, 26)}</span>
                      <CopyButton value={row.id} label="Copy" />
                    </td>
                    <td>{row.claimed ? "yes" : "no"}</td>
                    <td>{formatBytes(row.documentBytes)}</td>
                    <td>{row.boards}</td>
                    <td>{row.cards}</td>
                    <td>{row.sections}</td>
                    <td>{row.shares}</td>
                    <td>
                      <LicenceCell row={row} onChanged={list.reload} />
                    </td>
                    <td>{formatWhen(row.lastSavedAt)}</td>
                    <td className="admin-actions">
                      <Button onClick={() => setSelected(row.id)}>Detail</Button>
                      <ConfirmButton
                        label="Revoke links"
                        confirmLabel="Confirm revoke"
                        onConfirm={() => act(() => revokeAllShares(row.id))}
                        disabled={row.shares === 0}
                      />
                      <Button tone="danger" onClick={() => setDeleting(row.id)}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                  {deleting === row.id ? (
                    <tr>
                      <td colSpan={9}>
                        <DeleteConfirm
                          id={row.id}
                          onCancel={() => setDeleting(null)}
                          onDelete={async () => {
                            await act(() => deleteWorkspace(row.id));
                            setDeleting(null);
                            if (selected === row.id) setSelected(null);
                          }}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected === null ? null : (
        <Detail
          key={`${selected}-${detailVersion}`}
          id={selected}
          onClose={() => setSelected(null)}
          onChanged={list.reload}
        />
      )}
    </section>
  );
}

/**
 * The licence a workspace holds, and the four states a subscription passes through.
 *
 * The chip names the state and the gate's consequence together — "past due, sync refused
 * when expired" — because a state that looks like a chip but not like a consequence is a
 * button that teaches nothing. Writing one takes the row, not the page: an operator
 * stepping trial → active → past due should be watching the same row change.
 */
const STATES = [
  { id: "trial", label: "Trial" },
  { id: "active", label: "Active" },
  { id: "past-due", label: "Past due" },
] as const;

function licenceLabel(licence: WorkspaceLicence | null): string {
  if (licence === null) return "none";
  return licence.expired ? "expired" : licence.tier;
}

function LicenceCell({ row, onChanged }: { row: WorkspaceRow; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const write = async (state: (typeof STATES)[number]["id"] | "cancelled") => {
    setBusy(state);
    setFailure(null);
    try {
      if (state === "cancelled") await clearLicence(row.id);
      else await writeLicence(row.id, state);
      onChanged();
    } catch (cause) {
      setFailure(errorText(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="admin-licence" data-testid={`licence-${row.id}`}>
      <span
        className="admin-licence-chip"
        data-state={row.licence === null ? "none" : licenceLabel(row.licence)}
      >
        {licenceLabel(row.licence)}
        {row.licence === null ? null : <> · {formatWhen(row.licence.expiresAt)}</>}
      </span>
      <span className="admin-muted" data-testid={`licence-consequence-${row.id}`}>
        {row.licence === null
          ? "no licence, so sync is refused"
          : row.licence.expired
            ? "sync is refused while this is expired"
            : "sync is allowed"}
      </span>
      <span className="admin-licence-actions">
        {STATES.map((state) => (
          <Button
            key={state.id}
            disabled={busy !== null}
            onClick={() => void write(state.id)}
            title={`Write a ${state.label.toLowerCase()} licence, which is what the gate reads`}
          >
            {busy === state.id ? "…" : state.label}
          </Button>
        ))}
        <Button
          tone="danger"
          disabled={busy !== null || row.licence === null}
          onClick={() => void write("cancelled")}
          title="Clear the row, which is what a cancellation leaves behind"
        >
          {busy === "cancelled" ? "…" : "Cancel"}
        </Button>
      </span>
      {failure === null ? null : <span role="alert">{failure}</span>}
    </div>
  );
}
