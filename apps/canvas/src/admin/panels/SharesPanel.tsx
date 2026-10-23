import { type FormEvent, useState } from "react";
import {
  type AdminShare,
  errorText,
  listShares,
  listWorkspaces,
  revokeAllShares,
  revokeShare,
} from "../api";
import {
  Button,
  ConfirmButton,
  ErrorLine,
  formatWhen,
  Muted,
  PanelHeader,
  shortId,
  useLoad,
} from "../ui";

function ShareList({ token, workspaceId }: { token: string; workspaceId: string }) {
  const shares = useLoad(() => listShares(token, workspaceId));
  const [error, setError] = useState<string | null>(null);

  const revoke = async (share: AdminShare) => {
    setError(null);
    try {
      await revokeShare(token, share.id);
      shares.reload();
    } catch (cause) {
      setError(errorText(cause));
      throw cause;
    }
  };

  const revokeAll = async () => {
    setError(null);
    try {
      await revokeAllShares(token, workspaceId);
      shares.reload();
    } catch (cause) {
      setError(errorText(cause));
      throw cause;
    }
  };

  const data = shares.data;

  return (
    <section className="admin-card admin-detail">
      <PanelHeader
        title="Links"
        description={workspaceId}
        actions={
          <>
            <ConfirmButton
              label="Revoke all"
              confirmLabel="Confirm revoke all"
              onConfirm={revokeAll}
              disabled={(data?.shares.length ?? 0) === 0}
            />
            <Button onClick={shares.reload} disabled={shares.loading}>
              {shares.loading ? "Loading…" : "Refresh"}
            </Button>
          </>
        }
      />
      <ErrorLine message={error ?? shares.error} />
      {data === null ? (
        shares.loading ? (
          <Muted>Loading…</Muted>
        ) : null
      ) : data.shares.length === 0 ? (
        <Muted>No active links for this workspace.</Muted>
      ) : (
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
            {data.shares.map((share) => (
              <tr key={share.id}>
                <td className="admin-mono" title={share.id}>
                  {shortId(share.id, 22)}
                </td>
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
                    onConfirm={() => revoke(share)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function SharesPanel({ token }: { token: string }) {
  const workspaces = useLoad(() => listWorkspaces(token));
  const [input, setInput] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    if (value.length > 0) setWorkspaceId(value);
  };

  return (
    <section className="admin-panel">
      <PanelHeader
        title="Shares"
        description="Active links of one workspace. Revoking a link closes its viewers on the next projection pass."
      />
      <form className="admin-form admin-form-inline" onSubmit={submit}>
        <label className="admin-field admin-field-grow">
          <span>Workspace</span>
          <input
            className="admin-input admin-mono"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            list="admin-workspace-ids"
            placeholder="workspace id"
          />
        </label>
        <datalist id="admin-workspace-ids">
          {(workspaces.data?.workspaces ?? []).map((row) => (
            <option key={row.id} value={row.id} />
          ))}
        </datalist>
        <button type="submit" className="admin-button" disabled={input.trim().length === 0}>
          Load links
        </button>
      </form>
      <ErrorLine message={workspaces.error} />
      {workspaceId === null ? (
        <Muted>Pick a workspace to list its links, or open one from the Workspaces tab.</Muted>
      ) : (
        <ShareList key={workspaceId} token={token} workspaceId={workspaceId} />
      )}
    </section>
  );
}
