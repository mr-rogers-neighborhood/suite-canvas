import { type FormEvent, useRef, useState } from "react";
import {
  type AdminTemplate,
  createTemplate,
  deleteTemplate,
  errorText,
  listTemplates,
  type NewTemplate,
  updateTemplate,
} from "../api";
import { Button, ConfirmButton, ErrorLine, Muted, PanelHeader, useLoad } from "../ui";

interface TemplateCounts {
  boards: number;
  edges: number;
  cards: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * What a template holds, read without trusting it. The control plane stores the
 * object the client captured and validates none of it, so a row can arrive in a
 * shape no template has. `null` — a dash in the table — says "not a template"
 * instead of a row of zeroes that would read as a deliberately empty starter.
 */
function templateCounts(data: unknown): TemplateCounts | null {
  if (!isRecord(data) || !Array.isArray(data.boards)) return null;
  let cards = 0;
  let edges = 0;
  for (const board of records(data.boards)) {
    for (const section of records(board.sections)) {
      cards += records(section.cards).length;
    }
    cards += records(board.cards).length;
    edges += records(board.edges).length;
  }
  return { boards: data.boards.length, edges, cards };
}

/**
 * The same envelope the "New template…" form reads, so a download pastes back
 * unchanged. No fetch: the row already holds the data, and a template can be
 * larger than any request this panel should make.
 */
function downloadTemplate(template: AdminTemplate): void {
  const body = JSON.stringify(
    {
      id: template.id,
      name: template.name,
      description: template.description,
      version: template.version,
      data: template.data,
    },
    null,
    2,
  );
  const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
  const anchor = document.createElement("a");
  const stem = template.id.replace(/[^A-Za-z0-9._-]/gu, "_") || "template";
  anchor.href = url;
  anchor.download = `suite-template-${stem}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

type ParsedTemplate = { template: NewTemplate } | { problem: string };

function templateFromPaste(text: string): ParsedTemplate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { problem: "That is not JSON." };
  }
  if (!isRecord(parsed)) {
    return { problem: "Paste a JSON object: id, name, description and data." };
  }
  const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
  if (id.length === 0) return { problem: "The template needs an id." };
  const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
  if (name.length === 0) return { problem: "The template needs a name." };
  const description = typeof parsed.description === "string" ? parsed.description : "";
  if (!isRecord(parsed.data)) {
    return { problem: "The template needs a data object holding its boards." };
  }
  const version =
    typeof parsed.version === "number" && Number.isInteger(parsed.version) && parsed.version >= 1
      ? parsed.version
      : undefined;
  return {
    template: {
      id,
      name,
      description,
      data: parsed.data,
      ...(version === undefined ? {} : { version }),
    },
  };
}

/**
 * A table cell that becomes an input: the launcher's inline rename, worn by both
 * the name and the description. Escape must not also fire the blur that saves,
 * which is why the cancel is a ref — the keydown lands before the blur does.
 */
function InlineField({
  value,
  action,
  label,
  emptyLabel,
  allowEmpty = false,
  onSave,
}: {
  value: string;
  action: string;
  label: string;
  emptyLabel?: string;
  allowEmpty?: boolean;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [problem, setProblem] = useState<string | null>(null);
  const cancelled = useRef(false);

  const start = () => {
    cancelled.current = false;
    setDraft(value);
    setProblem(null);
    setEditing(true);
  };

  const commit = async () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = draft.trim();
    if (next.length === 0 && !allowEmpty) {
      setProblem("A template needs a name.");
      return;
    }
    if (next === value) {
      setEditing(false);
      setProblem(null);
      return;
    }
    setEditing(false);
    setProblem(null);
    try {
      await onSave(next);
    } catch {
      // The panel's one error line carries the reason.
    }
  };

  if (!editing) {
    return (
      <div className="admin-inline-edit">
        <span className={value.length === 0 ? "admin-muted" : undefined}>
          {value.length === 0 ? (emptyLabel ?? "") : value}
        </span>
        <Button onClick={start}>{action}</Button>
      </div>
    );
  }

  return (
    <div className="admin-inline-editor">
      <input
        // biome-ignore lint/a11y/noAutofocus: inline edit is an explicit gesture
        autoFocus
        className="admin-input"
        aria-label={label}
        aria-invalid={problem === null ? undefined : true}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setProblem(null);
        }}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
          if (event.key === "Escape") {
            cancelled.current = true;
            setEditing(false);
            setProblem(null);
          }
        }}
      />
      <span
        role={problem === null ? undefined : "alert"}
        className={problem === null ? "admin-muted admin-small" : "admin-error admin-small"}
      >
        {problem ?? "Enter to save · Escape to cancel"}
      </span>
    </div>
  );
}

function NewTemplateForm({ token, onCreated }: { token: string; onCreated: () => void }) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = templateFromPaste(text);
    if ("problem" in parsed) {
      setProblem(parsed.problem);
      return;
    }
    setProblem(null);
    setBusy(true);
    try {
      await createTemplate(token, parsed.template);
      setText("");
      onCreated();
    } catch (cause) {
      setProblem(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="admin-form" onSubmit={(event) => void submit(event)}>
      <label className="admin-field admin-field-full">
        <span>Template JSON</span>
        <textarea
          className="admin-input admin-textarea"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
          placeholder={
            '{"id":"weekly-review","name":"Weekly review","description":"…","data":{"boards":[…]}}'
          }
          spellCheck={false}
        />
      </label>
      <p className="admin-muted admin-small">
        Paste a downloaded template back to restore it, or write the same object by hand: an id, a
        name, an optional description and a data object. The body is not validated here; a template
        that cannot be applied fails where it is used.
      </p>
      <button
        type="submit"
        className="admin-button admin-button-primary"
        disabled={busy || text.trim().length === 0}
      >
        {busy ? "Creating…" : "Create template"}
      </button>
      <ErrorLine message={problem} />
    </form>
  );
}

function TemplateTable({ token }: { token: string }) {
  const list = useLoad(() => listTemplates(token));
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const act = async (run: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await run();
      list.reload();
    } catch (cause) {
      setError(errorText(cause));
    }
  };

  const save = (template: AdminTemplate, next: { name: string; description: string }) =>
    act(() =>
      updateTemplate(token, template.id, {
        name: next.name,
        description: next.description,
        data: template.data,
      }),
    );

  const templates = list.data?.templates ?? [];

  return (
    <section className="admin-panel">
      <PanelHeader
        title="Templates"
        description="Starter templates the launcher offers before sign-in. This panel is the door that writes them; the workspace menu captures one."
        actions={
          <>
            <Button onClick={() => setCreating((value) => !value)}>
              {creating ? "Close" : "New template…"}
            </Button>
            <Button onClick={list.reload} disabled={list.loading}>
              {list.loading ? "Loading…" : "Refresh"}
            </Button>
          </>
        }
      />
      {creating ? (
        <NewTemplateForm
          token={token}
          onCreated={() => {
            setCreating(false);
            list.reload();
          }}
        />
      ) : null}
      <ErrorLine message={error ?? list.error} />
      {list.data === null ? (
        list.loading ? (
          <Muted>Loading…</Muted>
        ) : null
      ) : templates.length === 0 ? (
        <Muted>No starter templates yet.</Muted>
      ) : (
        <div className="admin-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Template</th>
                <th>Version</th>
                <th>Description</th>
                <th>Boards</th>
                <th>Edges</th>
                <th>Cards</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const counts = templateCounts(template.data);
                return (
                  <tr key={template.id}>
                    <td className="admin-cell-stack">
                      <InlineField
                        value={template.name}
                        action="Rename"
                        label={`Rename ${template.name}`}
                        onSave={(name) =>
                          save(template, { name, description: template.description })
                        }
                      />
                      <span className="admin-mono admin-muted" title={template.id}>
                        {template.id}
                      </span>
                    </td>
                    <td>{template.version}</td>
                    <td className="admin-wrap">
                      <InlineField
                        value={template.description}
                        action="Edit"
                        label={`Description for ${template.name}`}
                        emptyLabel="No description"
                        allowEmpty
                        onSave={(description) =>
                          save(template, { name: template.name, description })
                        }
                      />
                    </td>
                    <td>{counts?.boards ?? "—"}</td>
                    <td>{counts?.edges ?? "—"}</td>
                    <td>{counts?.cards ?? "—"}</td>
                    <td className="admin-actions">
                      <Button onClick={() => downloadTemplate(template)}>Download</Button>
                      <ConfirmButton
                        label="Delete"
                        confirmLabel="Confirm delete"
                        onConfirm={() => act(() => deleteTemplate(token, template.id))}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function TemplatesPanel({ token }: { token: string | null }) {
  if (token === null || token.trim().length === 0) {
    return (
      <section className="admin-panel">
        <PanelHeader
          title="Templates"
          description="Starter templates the launcher offers before sign-in."
        />
        <Muted>
          The admin token is required to read or change templates. Unlock the panel again.
        </Muted>
      </section>
    );
  }
  return <TemplateTable token={token} />;
}
