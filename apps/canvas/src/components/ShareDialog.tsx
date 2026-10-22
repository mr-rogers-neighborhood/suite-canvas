import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSession } from "../session/session";
import type {
  CreatedShare,
  CreateShareInput,
  Share,
  ShareRole,
  ShareScope,
} from "../session/shares";
import * as sharesApi from "../session/shares";
import { shareErrorMessage } from "../session/shares";

/** The slice of the share API the dialog needs; stories and tests may replace it. */
export interface ShareClient {
  createShare: (input: CreateShareInput, ownerKey: string | null) => Promise<CreatedShare>;
  listShares: (workspaceId: string, ownerKey: string | null) => Promise<Share[]>;
  revokeShare: (id: string, ownerKey: string | null) => Promise<Share>;
  revokeAllShares: (workspaceId: string, ownerKey: string | null) => Promise<Share[]>;
}

const defaultClient: ShareClient = {
  createShare: sharesApi.createShare,
  listShares: sharesApi.listShares,
  revokeShare: sharesApi.revokeShare,
  revokeAllShares: sharesApi.revokeAllShares,
};

export interface ShareDialogProps {
  workspaceId: string;
  /** Active board, or null when the workspace has no board yet. */
  boardId: string | null;
  boardName?: string | null;
  /** Selected or inspected card, when there is exactly one. */
  cardId?: string | null;
  cardTitle?: string | null;
  onClose: () => void;
  client?: ShareClient;
}

const SCOPE_LABELS: Record<ShareScope, string> = {
  workspace: "Workspace",
  board: "Board",
  card: "Card",
};

const ROLE_LABELS: Record<ShareRole, string> = {
  viewer: "Viewer",
  editor: "Editor",
};

const SCOPES: readonly ShareScope[] = ["workspace", "board", "card"];
const ROLES: readonly ShareRole[] = ["viewer", "editor"];

const COPIED_MS = 1600;
const EXPIRY_DAYS = [0, 7, 30] as const;
type ExpiryDays = (typeof EXPIRY_DAYS)[number];

interface ShownLink {
  url: string;
  /** Share the link came from; null for the plain workspace editor URL. */
  shareId: string | null;
}

function createdLabel(createdAt: number): string {
  return new Date(createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * One dialog for every kind of share. Token links are capability links and
 * management calls carry the owner key. Board and card editors change a
 * projection and publish it back; a workspace editor link is the plain editor
 * URL with the owner key in the fragment.
 */
export function ShareDialog({
  workspaceId,
  boardId,
  boardName = null,
  cardId = null,
  cardTitle = null,
  onClose,
  client,
}: ShareDialogProps) {
  const api = useMemo(() => client ?? defaultClient, [client]);
  const ownerKey = getSession().ownerKey;
  const [scope, setScope] = useState<ShareScope>("workspace");
  const [role, setRole] = useState<ShareRole>("editor");
  const [expiryDays, setExpiryDays] = useState<ExpiryDays>(0);
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<ShownLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Tokens are only ever returned at creation time; remember the ones this
  // dialog made so the list can still offer a copy button for them.
  const tokens = useRef(new Map<string, string>());
  const copiedTimer = useRef<number | null>(null);
  const loadId = useRef(0);

  const boardAvailable = Boolean(boardId);
  const cardAvailable = Boolean(cardId);
  // Every role and scope is served by the API: viewers read a projection and
  // editors change it, then publish back to the workspace.

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    // Capture: the canvas behind this dialog also listens for Escape.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  const load = useCallback(async () => {
    const id = ++loadId.current;
    setLoading(true);
    try {
      const next = await api.listShares(workspaceId, ownerKey);
      if (id === loadId.current) setShares(next);
    } catch (cause) {
      if (id === loadId.current) {
        setShares([]);
        setError(shareErrorMessage(cause));
      }
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }, [api, ownerKey, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A scope that lost its target cannot stay selected.
  useEffect(() => {
    if ((scope === "board" && !boardAvailable) || (scope === "card" && !cardAvailable)) {
      setScope("workspace");
      setRole("editor");
      setLink(null);
    }
  }, [scope, boardAvailable, cardAvailable]);

  // A link belongs to one scope and role, so switching either clears it.
  const resetOutput = () => {
    setLink(null);
    setCopied(null);
    setError(null);
  };

  const flashCopied = (key: string) => {
    setCopied(key);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => {
      copiedTimer.current = null;
      setCopied((current) => (current === key ? null : current));
    }, COPIED_MS);
  };

  const copy = async (value: string, key: string) => {
    setError(null);
    try {
      await navigator.clipboard.writeText(value);
      flashCopied(key);
    } catch {
      setError("Could not copy the link. Select it and copy it instead.");
    }
  };

  const create = async () => {
    setError(null);
    setCopied(null);
    setBusy(true);
    try {
      const created = await api.createShare(
        {
          workspaceId,
          scope,
          role,
          boardId: scope === "board" ? boardId : null,
          cardId: scope === "card" ? cardId : null,
          expiresAt: expiryDays === 0 ? null : Date.now() + expiryDays * 24 * 60 * 60 * 1000,
        },
        ownerKey,
      );
      tokens.current.set(created.share.id, created.token);
      setLink({ url: sharesApi.shareLink(created.token), shareId: created.share.id });
      void load();
    } catch (cause) {
      setError(shareErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (share: Share) => {
    setError(null);
    setBusy(true);
    try {
      await api.revokeShare(share.id, ownerKey);
      setLink((current) => (current?.shareId === share.id ? null : current));
      void load();
    } catch (cause) {
      setError(shareErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const revokeAll = async () => {
    if (!window.confirm("Revoke every active link? Anyone using one will lose access.")) return;
    setError(null);
    setBusy(true);
    try {
      await api.revokeAllShares(workspaceId, ownerKey);
      setLink(null);
      void load();
    } catch (cause) {
      setError(shareErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const urlFor = (share: Share): string | null => {
    const token = tokens.current.get(share.id);
    return token ? sharesApi.shareLink(token) : null;
  };

  const hint =
    scope === "workspace"
      ? role === "editor"
        ? "Editors can change every board but cannot manage links or transfer ownership."
        : "Viewers can read every board, but cannot change anything or manage links."
      : role === "editor"
        ? `Editors can change this ${scope} and publish. No new cards or type changes.`
        : scope === "board"
          ? `Viewers see only ${boardName ?? "this board"}.`
          : `Viewers see only ${cardTitle ?? "this card"}.`;

  const createLabel = role === "editor" ? "Create editor link" : "Create viewer link";

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close share dialog"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share"
        data-testid="share-dialog"
        className="relative w-[min(460px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">Share</h2>
            <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">
              Anyone with a link gets the access shown. No account needed.
            </p>
          </div>
          <button
            type="button"
            data-testid="share-close"
            aria-label="Close share dialog"
            className="rounded-md px-1.5 py-0.5 text-[13px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
            onClick={onClose}
          >
            {"\u00d7"}
          </button>
        </div>

        <fieldset
          aria-label="Share scope"
          className="m-0 mt-3 flex flex-wrap gap-1 rounded-lg border-0 bg-[var(--segmented-bg)] p-0.5"
        >
          {SCOPES.map((id) => {
            const unavailable = id === "board" ? !boardAvailable : id === "card" && !cardAvailable;
            return (
              <button
                key={id}
                type="button"
                data-testid={`share-tab-${id}`}
                aria-pressed={scope === id}
                disabled={unavailable}
                title={
                  unavailable
                    ? id === "card"
                      ? "Select a card first."
                      : "This workspace has no board yet."
                    : undefined
                }
                className={`flex-1 rounded-md px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  scope === id
                    ? "bg-[var(--surface)] text-[var(--ink)] shadow-sm"
                    : "text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                }`}
                onClick={() => {
                  setScope(id);
                  // Workspace has an editor link; board and card have viewers.
                  setRole(id === "workspace" ? "editor" : "viewer");
                  resetOutput();
                }}
              >
                {SCOPE_LABELS[id]}
              </button>
            );
          })}
        </fieldset>

        <fieldset
          aria-label="Share role"
          className="m-0 mt-2 flex flex-wrap gap-1 border-0 p-0"
          data-testid="share-roles"
        >
          {ROLES.map((id) => (
            <button
              key={id}
              type="button"
              data-testid={`share-role-${id}`}
              aria-pressed={role === id}
              className={`rounded-md border px-2 py-1 text-[11px] transition-colors ${
                role === id
                  ? "border-[var(--ink-muted)] bg-[var(--segmented-bg)] text-[var(--ink)]"
                  : "border-[var(--hairline)] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
              }`}
              onClick={() => {
                setRole(id);
                resetOutput();
              }}
            >
              {ROLE_LABELS[id]}
            </button>
          ))}
        </fieldset>

        <div className="mt-2 flex items-center gap-2">
          <label className="text-[11px] text-[var(--ink-muted)]" htmlFor="share-expiry">
            Expires
          </label>
          <select
            id="share-expiry"
            data-testid="share-expiry"
            className="rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-[11px] text-[var(--ink)]"
            value={expiryDays}
            onChange={(event) => {
              setExpiryDays(Number(event.target.value) as ExpiryDays);
              resetOutput();
            }}
          >
            {EXPIRY_DAYS.map((days) => (
              <option key={days} value={days}>
                {days === 0 ? "Never" : `${days} days`}
              </option>
            ))}
          </select>
        </div>

        <p className="mt-2 text-[11px] text-[var(--ink-muted)]" data-testid="share-hint">
          {hint}
        </p>

        <div className="mt-2 flex items-center justify-end">
          <button
            type="button"
            data-testid="share-create"
            disabled={busy}
            className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[11px] text-[var(--surface)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => void create()}
          >
            {busy ? "Working\u2026" : createLabel}
          </button>
        </div>

        {link ? (
          <div className="mt-2 flex items-center gap-1.5" data-testid="share-link">
            <input
              readOnly
              aria-label="Share link"
              className="min-w-0 flex-1 rounded-md border border-[var(--hairline)] bg-transparent px-2 py-1 text-[11px] text-[var(--ink)] outline-none"
              value={link.url}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              data-testid="share-copy"
              className="rounded-md border border-[var(--hairline)] px-2 py-1 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] dark:hover:bg-white/10"
              onClick={() => void copy(link.url, "new")}
            >
              {copied === "new" ? "Copied" : "Copy"}
            </button>
          </div>
        ) : null}

        {error ? (
          <p
            role="alert"
            data-testid="share-error"
            className="mt-2 text-[11px] leading-relaxed text-red-600 dark:text-red-300"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-3 border-t border-[var(--hairline)] pt-2">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
              Active links
            </h3>
            <div className="flex items-center gap-2">
              {loading ? (
                <span className="text-[10px] text-[var(--ink-muted)]">{"Loading\u2026"}</span>
              ) : null}
              {shares.length > 0 ? (
                <button
                  type="button"
                  data-testid="share-revoke-all"
                  disabled={busy}
                  className="rounded-md px-1 py-0.5 text-[10px] text-[var(--ink-muted)] hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-500/15 dark:hover:text-red-300"
                  onClick={() => void revokeAll()}
                >
                  Revoke all
                </button>
              ) : null}
            </div>
          </div>
          {!loading && shares.length === 0 ? (
            <p className="mt-1 text-[11px] text-[var(--ink-muted)]" data-testid="share-empty">
              No active links yet.
            </p>
          ) : null}
          {shares.length > 0 ? (
            <ul className="mt-1 space-y-0.5" data-testid="share-list">
              {shares.map((share) => {
                const url = urlFor(share);
                return (
                  <li
                    key={share.id}
                    data-testid={`share-row-${share.id}`}
                    className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] text-[var(--ink)]">
                        {SCOPE_LABELS[share.scope]} {"\u00b7"} {ROLE_LABELS[share.role]}
                      </p>
                      <p className="text-[10px] text-[var(--ink-muted)]">
                        Created {createdLabel(share.createdAt)}
                        {share.expiresAt !== null
                          ? ` · Expires ${createdLabel(share.expiresAt)}`
                          : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      data-testid={`share-copy-${share.id}`}
                      disabled={url === null}
                      title={
                        url === null
                          ? "A link is only shown once. Revoke it and create a new one to copy it again."
                          : "Copy this link"
                      }
                      className="rounded-md px-1.5 py-0.5 text-[10px] text-[var(--ink-muted)] hover:bg-black/5 hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
                      onClick={() => {
                        if (url) void copy(url, share.id);
                      }}
                    >
                      {copied === share.id ? "Copied" : "Copy"}
                    </button>
                    <button
                      type="button"
                      data-testid={`share-revoke-${share.id}`}
                      disabled={busy}
                      className="rounded-md px-1.5 py-0.5 text-[10px] text-[var(--ink-muted)] transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-500/15 dark:hover:text-red-300"
                      onClick={() => void revoke(share)}
                    >
                      Revoke
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
