import { type FormEvent, useState } from "react";
import { createFixtures, errorText, type FixtureResult } from "../api";
import { CopyButton, ErrorLine, Muted, PanelHeader } from "../ui";

const ID_PREVIEW_LIMIT = 300;

function IdList({ title, ids }: { title: string; ids: string[] }) {
  if (ids.length === 0) return null;
  const shown = ids.slice(0, ID_PREVIEW_LIMIT);
  return (
    <details className="admin-ids">
      <summary>
        {title} ({ids.length})
      </summary>
      <ul className="admin-id-list admin-mono">
        {shown.map((id) => (
          <li key={id}>{id}</li>
        ))}
      </ul>
      {ids.length > shown.length ? (
        <p className="admin-muted">
          Showing the first {shown.length} of {ids.length} ids.
        </p>
      ) : null}
    </details>
  );
}

export function FixturesPanel() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [boards, setBoards] = useState("1");
  const [cards, setCards] = useState("10");
  const [sections, setSections] = useState("0");
  const [shares, setShares] = useState("2");
  const [result, setResult] = useState<FixtureResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await createFixtures({
        ...(workspaceId.trim().length > 0 ? { workspaceId: workspaceId.trim() } : {}),
        boards: Number(boards),
        cards: Number(cards),
        sections: Number(sections),
        shares: Number(shares),
      });
      setResult(created);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  const allUrls = (result?.shares ?? []).map((share) => share.url).join("\n");

  return (
    <section className="admin-panel">
      <PanelHeader
        title="Fixtures"
        description="Creates a disposable workspace through the public document API, so a sync or collaboration bug can be reproduced in one call."
      />
      <form className="admin-form" onSubmit={(event) => void submit(event)}>
        <label className="admin-field">
          <span>Workspace id (optional)</span>
          <input
            className="admin-input admin-mono"
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.target.value)}
            placeholder="a new fixture id"
          />
        </label>
        <div className="admin-field-row">
          <label className="admin-field">
            <span>Boards</span>
            <input
              className="admin-input"
              type="number"
              min={1}
              max={50}
              value={boards}
              onChange={(event) => setBoards(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Cards</span>
            <input
              className="admin-input"
              type="number"
              min={0}
              max={2000}
              value={cards}
              onChange={(event) => setCards(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Sections</span>
            <input
              className="admin-input"
              type="number"
              min={0}
              max={200}
              value={sections}
              onChange={(event) => setSections(event.target.value)}
            />
          </label>
          <label className="admin-field">
            <span>Viewer links</span>
            <input
              className="admin-input"
              type="number"
              min={0}
              max={20}
              value={shares}
              onChange={(event) => setShares(event.target.value)}
            />
          </label>
        </div>
        <button type="submit" className="admin-button admin-button-primary" disabled={busy}>
          {busy ? "Creating…" : "Create fixture"}
        </button>
      </form>
      <ErrorLine message={error} />

      {result === null ? (
        <Muted>
          Creation writes real data. Delete the workspace when the reproduction is done.
        </Muted>
      ) : (
        <section className="admin-card admin-detail">
          <PanelHeader
            title="Fixture created"
            description={result.workspaceId}
            actions={
              result.shares.length > 0 ? (
                <CopyButton value={allUrls} label="Copy all links" />
              ) : undefined
            }
          />
          <dl className="admin-facts admin-facts-wide">
            <div className="admin-fact">
              <dt>Boards</dt>
              <dd>{result.boards.length}</dd>
            </div>
            <div className="admin-fact">
              <dt>Cards</dt>
              <dd>{result.cards.length}</dd>
            </div>
            <div className="admin-fact">
              <dt>Sections</dt>
              <dd>{result.sections.length}</dd>
            </div>
            <div className="admin-fact">
              <dt>Links</dt>
              <dd>{result.shares.length}</dd>
            </div>
          </dl>

          <p className="admin-muted">
            A fixture workspace belongs to no organization, so it opens with no credential: the
            relay issues no key for it (ADR-0076). Attach it to an organization to sync it.
          </p>

          <IdList title="Board ids" ids={result.boards} />
          <IdList title="Card ids" ids={result.cards} />
          <IdList title="Section ids" ids={result.sections} />

          {result.shares.length === 0 ? null : (
            <>
              <h3>Viewer links</h3>
              <ul className="admin-links">
                {result.shares.map((share) => (
                  <li key={share.token}>
                    <span className="admin-badge">{share.scope}</span>
                    <input className="admin-input admin-mono" readOnly value={share.url} />
                    <CopyButton value={share.url} />
                    <a className="admin-link" href={share.url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </section>
  );
}
