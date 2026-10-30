import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { relayCredential } from "../auth/credential";
import { noteRefusal } from "../auth/refusal";
import { useAccountStore } from "../auth/useAccountStore";
import { useFocusTrap } from "../dialogs/useFocusTrap";
import type {
  CreatedShare,
  CreateShareInput,
  Share,
  ShareDefaults,
  ShareRole,
  ShareScope,
} from "../session/shares";
import * as sharesApi from "../session/shares";
import { ShareApiError, shareErrorMessage } from "../session/shares";
import { useEscapeLayer } from "../shell/escapeLayers";

/** The slice of the share API the dialog needs; stories and tests may replace it. */
export interface ShareClient {
  createShare: (input: CreateShareInput, credential: string | null) => Promise<CreatedShare>;
  listShares: (workspaceId: string, credential: string | null) => Promise<Share[]>;
  revokeShare: (id: string, credential: string | null) => Promise<Share>;
  revokeAllShares: (workspaceId: string, credential: string | null) => Promise<Share[]>;
  /** Hosted relays expire a new link by default; the dialog preselects that. */
  defaults: () => Promise<ShareDefaults>;
}

const defaultClient: ShareClient = {
  createShare: sharesApi.createShare,
  listShares: sharesApi.listShares,
  revokeShare: sharesApi.revokeShare,
  revokeAllShares: sharesApi.revokeAllShares,
  defaults: sharesApi.shareDefaults,
};

export interface ShareDialogProps {
  workspaceId: string;
  /** Active board, or null when the workspace has no board yet. */
  boardId: string | null;
  boardName?: string | null;
  /** Selected or inspected card, when there is exactly one. */
  cardId?: string | null;
  cardTitle?: string | null;
  /** Cards in the canvas selection; a selection link projects these. */
  selectedCardIds?: readonly string[];
  /** Scope to open on, for gestures that already know what they want to share. */
  initialScope?: ShareScope;
  onClose: () => void;
  client?: ShareClient;
}

const SCOPE_LABELS: Record<ShareScope, string> = {
  workspace: "Workspace",
  board: "Board",
  card: "Card",
  selection: "Selection",
};

const ROLE_LABELS: Record<ShareRole, string> = {
  viewer: "Viewer",
  editor: "Editor",
};

const SCOPES: readonly ShareScope[] = ["workspace", "board", "card", "selection"];
const ROLES: readonly ShareRole[] = ["viewer", "editor"];

const COPIED_MS = 1600;
const EXPIRY_DAYS = [0, 7, 30] as const;
type ExpiryDays = (typeof EXPIRY_DAYS)[number];

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;
const YEAR_MS = 365 * DAY_MS;

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
 * When a link was last opened, in the owner's words. Null is "Never used" — the
 * share has existed but nobody resolved it — and anything under a minute reads
 * as "just now" because the store only records use to the minute.
 */
export function lastUsedLabel(lastUsedAt: number | null, now: number = Date.now()): string {
  if (lastUsedAt === null) return "Never used";
  const elapsed = Math.max(0, now - lastUsedAt);
  if (elapsed < MINUTE_MS) return "Last used just now";

  const [unit, span] =
    elapsed >= YEAR_MS
      ? (["year", YEAR_MS] as const)
      : elapsed >= MONTH_MS
        ? (["month", MONTH_MS] as const)
        : elapsed >= DAY_MS
          ? (["day", DAY_MS] as const)
          : elapsed >= HOUR_MS
            ? (["hour", HOUR_MS] as const)
            : (["minute", MINUTE_MS] as const);
  const amount = Math.floor(elapsed / span);
  // `auto` reads "yesterday" for one day instead of "1 day ago".
  const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    -amount,
    unit,
  );
  return `Last used ${relative}`;
}

/**
 * One dialog for every kind of share. Token links are capability links, and the
 * management calls carry the account's session credential. Board and card editors
 * change a projection and publish it back; a workspace editor link is the plain
 * editor URL, and whoever opens it signs in.
 */
export function ShareDialog({
  workspaceId,
  boardId,
  boardName = null,
  cardId = null,
  cardTitle = null,
  selectedCardIds = [],
  initialScope = "workspace",
  onClose,
  client,
}: ShareDialogProps) {
  const phase = useAccountStore((state) => state.phase);
  const openSignIn = useAccountStore((state) => state.openSignIn);
  const api = useMemo(() => client ?? defaultClient, [client]);
  const [scope, setScope] = useState<ShareScope>(initialScope);
  const [role, setRole] = useState<ShareRole>(initialScope === "workspace" ? "editor" : "viewer");
  const [expiryDays, setExpiryDays] = useState<ExpiryDays>(0);
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [link, setLink] = useState<ShownLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /** "Revoke all" asks inside the dialog, rather than in a platform confirm. */
  const [confirmingRevokeAll, setConfirmingRevokeAll] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);

  // Tokens are only ever returned at creation time; remember the ones this
  // dialog made so the list can still offer a copy button for them.
  const tokens = useRef(new Map<string, string>());
  const copiedTimer = useRef<number | null>(null);
  const loadId = useRef(0);
  /** Once the owner picks an expiry, the hosted default must not overwrite it. */
  const expiryChosen = useRef(false);

  const boardAvailable = Boolean(boardId);
  const cardAvailable = Boolean(cardId);
  const selectionCardIds = useMemo(() => [...new Set(selectedCardIds)], [selectedCardIds]);
  // A link projects a subset, so two cards is the smallest meaningful selection.
  const selectionAvailable = selectionCardIds.length >= 2;
  // Every role and scope is served by the API: viewers read a projection and
  // editors change it, then publish back to the workspace. Selection links are
  // the exception for now: they are always read-only.

  useEscapeLayer(onClose);
  useFocusTrap(panel);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );

  /** A token minted for one call: the dialog can stay open past one expiry. */
  const credential = useCallback(() => relayCredential(), []);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    setLoading(true);
    try {
      const next = await api.listShares(workspaceId, await credential());
      if (id === loadId.current) setShares(next);
    } catch (cause) {
      if (id === loadId.current) {
        setShares([]);
        setError(shareErrorMessage(cause));
      }
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }, [api, credential, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Hosted relays expire a new link by default, so start on the expiry the
  // server would apply on its own. A self-host keeps "Never" preselected, and a
  // choice the owner already made always wins.
  useEffect(() => {
    let live = true;
    void api
      .defaults()
      .then((defaults) => {
        if (!live || expiryChosen.current || !defaults.hosted) return;
        const days = EXPIRY_DAYS.find(
          (value) => value !== 0 && value === defaults.defaultExpiryDays,
        );
        if (days !== undefined) setExpiryDays(days);
      })
      .catch(() => {
        // The server still applies its own default; leave "Never" on screen.
      });
    return () => {
      live = false;
    };
  }, [api]);

  // A scope that lost its target cannot stay selected.
  useEffect(() => {
    const lost =
      (scope === "board" && !boardAvailable) ||
      (scope === "card" && !cardAvailable) ||
      (scope === "selection" && !selectionAvailable);
    if (lost) {
      setScope("workspace");
      setRole("editor");
      setLink(null);
    }
  }, [scope, boardAvailable, cardAvailable, selectionAvailable]);

  // Selection links are viewer-only until the editor projection ships.
  useEffect(() => {
    if (scope === "selection" && role !== "viewer") setRole("viewer");
  }, [scope, role]);

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

  /**
   * A refusal the plan can fix is shown where it happened *and* raised on the
   * account surfaces, so "upgrade" is one press away from the dialog that met the
   * wall.
   */
  const report = (cause: unknown): void => {
    if (cause instanceof ShareApiError) noteRefusal(cause.code, cause.status ?? undefined);
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
          boardId: scope === "board" || scope === "selection" ? boardId : null,
          cardId: scope === "card" ? cardId : null,
          ...(scope === "selection" ? { cardIds: selectionCardIds } : {}),
          // Spent once on the page slug: the reader address is `/s/<slug>`, so
          // it has to name what the author published while they still know it.
          name: exposureName,
          expiresAt: expiryDays === 0 ? null : Date.now() + expiryDays * 24 * 60 * 60 * 1000,
        },
        await credential(),
      );
      tokens.current.set(created.share.id, created.token);
      setLink({
        url: sharesApi.shareLink(created.token, created.share.slug ?? null),
        shareId: created.share.id,
      });
      void load();
    } catch (cause) {
      report(cause);
      setError(shareErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (share: Share) => {
    setError(null);
    setBusy(true);
    try {
      await api.revokeShare(share.id, await credential());
      setLink((current) => (current?.shareId === share.id ? null : current));
      void load();
    } catch (cause) {
      report(cause);
      setError(shareErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const revokeAll = async () => {
    setConfirmingRevokeAll(false);
    setError(null);
    setBusy(true);
    try {
      await api.revokeAllShares(workspaceId, await credential());
      setLink(null);
      void load();
    } catch (cause) {
      report(cause);
      setError(shareErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const urlFor = (share: Share): string | null => {
    const token = tokens.current.get(share.id);
    return token ? sharesApi.shareLink(token, share.slug ?? null) : null;
  };

  // What the author is about to expose, named the way the dialog already names
  // it. The sentence under the create button says it once, at the moment of
  // publishing; nothing is gated behind a warning.
  const exposureName =
    scope === "card" ? cardTitle : scope === "board" || scope === "selection" ? boardName : null;
  const exposureTarget =
    scope === "card"
      ? (cardTitle ?? "this card")
      : scope === "board"
        ? (boardName ?? "this board")
        : scope === "selection"
          ? `these ${selectionCardIds.length} cards`
          : "this workspace";

  const hint =
    scope === "workspace"
      ? role === "editor"
        ? "Editors can change every board but cannot manage links or transfer ownership."
        : "Viewers can read every board, but cannot change anything or manage links."
      : scope === "selection"
        ? `Viewers see these ${selectionCardIds.length} cards and the sections around them. Everything else stays private.`
        : role === "editor"
          ? `Editors can change this ${scope} and publish. No new cards or type changes.`
          : scope === "board"
            ? `Viewers see only ${boardName ?? "this board"}.`
            : `Viewers see only ${cardTitle ?? "this card"}.`;

  const createLabel = role === "editor" ? "Create editor link" : "Create viewer link";

  if (phase === "signed-out") {
    return createPortal(
      <div className="fixed inset-0 z-[70] flex items-center justify-center">
        <button
          type="button"
          aria-label="Close share dialog"
          className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
          onClick={onClose}
        />
        <div
          ref={panel}
          role="dialog"
          aria-modal="true"
          aria-label="Sign in to share"
          tabIndex={-1}
          data-testid="share-dialog-signed-out"
          className="relative w-[min(440px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-5 shadow-xl"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[var(--ink)]">Sign in to share</h2>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-muted)]">
                Create share links with view or edit permissions for anyone. Free accounts include
                unlimited personal workspaces, 100 MB of cloud storage, and share links.
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

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              data-testid="share-sign-in"
              className="rounded-md border border-[var(--hairline)] px-3 py-1.5 text-[11px] font-medium text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
              onClick={() => {
                onClose();
                openSignIn("sign-in");
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              data-testid="share-sign-up"
              className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[11px] font-medium text-[var(--surface)] transition-opacity hover:opacity-90"
              onClick={() => {
                onClose();
                openSignIn("sign-up");
              }}
            >
              Create free account
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close share dialog"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Share"
        tabIndex={-1}
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
            const unavailable =
              id === "board"
                ? !boardAvailable
                : id === "card"
                  ? !cardAvailable
                  : id === "selection"
                    ? !selectionAvailable
                    : false;
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
                      : id === "selection"
                        ? "Select two or more cards to share a subset."
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
          {ROLES.map((id) => {
            const disabled = id === "editor" && scope === "selection";
            return (
              <button
                key={id}
                type="button"
                data-testid={`share-role-${id}`}
                aria-pressed={role === id}
                disabled={disabled}
                title={disabled ? "Editor \u2014 next phase" : undefined}
                className={`rounded-md border px-2 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
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
            );
          })}
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
              expiryChosen.current = true;
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

        <p
          className="mt-1 text-[11px] leading-relaxed text-[var(--ink-muted)]"
          data-testid="share-exposure"
        >
          {`Publishing ${exposureTarget} makes it, and every link inside it, readable by anyone who has the link, without an account.`}
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
          <div
            role="alert"
            data-testid="share-error"
            className="mt-2 text-[11px] leading-relaxed text-red-600 dark:text-red-300"
          >
            <p>{error}</p>
            {error.includes("Sign in on this device") ? (
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  data-testid="share-error-sign-up"
                  className="rounded-md bg-[var(--ink)] px-2.5 py-1 text-[11px] font-medium text-[var(--surface)] hover:opacity-90"
                  onClick={() => {
                    onClose();
                    openSignIn("sign-up");
                  }}
                >
                  Create free account
                </button>
                <button
                  type="button"
                  data-testid="share-error-sign-in"
                  className="rounded-md border border-[var(--hairline)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
                  onClick={() => {
                    onClose();
                    openSignIn("sign-in");
                  }}
                >
                  Sign in
                </button>
              </div>
            ) : null}
          </div>
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
              {shares.length > 0 && !confirmingRevokeAll ? (
                <button
                  type="button"
                  data-testid="share-revoke-all"
                  disabled={busy}
                  className="rounded-md px-1 py-0.5 text-[10px] text-[var(--ink-muted)] hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:hover:bg-red-500/15 dark:hover:text-red-300"
                  onClick={() => setConfirmingRevokeAll(true)}
                >
                  Revoke all
                </button>
              ) : null}
            </div>
          </div>
          {confirmingRevokeAll ? (
            <div
              data-testid="share-revoke-all-confirm"
              className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-red-500/10 px-2 py-1 text-[10px]"
            >
              <span className="min-w-0 flex-1">
                Revoke every active link? Anyone using one will lose access.
              </span>
              <button
                type="button"
                data-testid="share-revoke-all-yes"
                disabled={busy}
                className="rounded px-1.5 py-0.5 text-red-600 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-500/15"
                onClick={() => void revokeAll()}
              >
                Revoke every link
              </button>
              <button
                type="button"
                data-testid="share-revoke-all-no"
                className="rounded px-1.5 py-0.5 text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => setConfirmingRevokeAll(false)}
              >
                Cancel
              </button>
            </div>
          ) : null}
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
                        {share.scope === "selection"
                          ? `Selection \u00b7 ${share.cardCount} card${share.cardCount === 1 ? "" : "s"}`
                          : `${SCOPE_LABELS[share.scope]} \u00b7 ${ROLE_LABELS[share.role]}`}
                        {share.slug ? (
                          <span
                            data-testid={`share-slug-${share.id}`}
                            className="ml-1 font-mono text-[10px] text-[var(--ink-muted)]"
                          >
                            {`/s/${share.slug}`}
                          </span>
                        ) : null}
                      </p>
                      <p className="text-[10px] text-[var(--ink-muted)]">
                        Created {createdLabel(share.createdAt)}
                        {" \u00b7 "}
                        <span data-testid={`share-last-used-${share.id}`}>
                          {lastUsedLabel(share.lastUsedAt ?? null)}
                        </span>
                        {share.expiresAt !== null
                          ? ` \u00b7 Expires ${createdLabel(share.expiresAt)}`
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
