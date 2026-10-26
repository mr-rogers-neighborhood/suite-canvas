import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getSession } from "../session/session";
import {
  publishShare,
  reloadShare,
  type SharePublishConflict,
  type SharePublishConflictEntry,
  SharePublishConflictError,
  type ShareStatus,
  sharePublishErrorMessage,
  shareStatus,
} from "../session/shares";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";

/** The slice of the publish API the button needs; tests may replace it. */
export interface PublishClient {
  publishShare: (
    token: string,
    version: Record<string, number>,
    overwrite?: readonly string[],
  ) => Promise<unknown>;
  shareStatus: (token: string) => Promise<ShareStatus>;
  reloadShare: (token: string) => Promise<void>;
}

const defaultClient: PublishClient = { publishShare, shareStatus, reloadShare };

export interface SharePublishButtonProps {
  /** Capability token; defaults to the share this page was opened with. */
  token?: string | null;
  client?: PublishClient;
}

/** Poll interval for the `Draft`/`Published` word; polling is cheap and small. */
const STATUS_POLL_MS = 1200;

/**
 * Publishes an editor share's draft to the owner's workspace. The word beside
 * the button says whether the draft holds unpublished edits; a conflict opens
 * one dialog where each field can keep either the draft or the workspace value.
 */
export function SharePublishButton({ token: tokenProp, client }: SharePublishButtonProps) {
  const canPublish = useUiStore((state) => state.canPublish);
  const flush = useCanvasStore((state) => state.flush);
  const api = client ?? defaultClient;
  const token = tokenProp ?? getSession().share?.token ?? null;

  const [publishing, setPublishing] = useState(false);
  const [status, setStatus] = useState<ShareStatus | null>(null);
  const [conflict, setConflict] = useState<SharePublishConflict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    if (!canPublish || !token) return;
    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const next = await api.shareStatus(token);
        if (!cancelled) setStatus(next);
      } catch {
        // The word is an indicator, not an error surface: a failed poll keeps
        // whatever was last known.
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void poll(), STATUS_POLL_MS);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [api, canPublish, token]);

  if (!canPublish || !token) return null;

  const publishWith = async (overwrite?: readonly string[]): Promise<boolean> => {
    if (publishing) return false;
    setError(null);
    setPublishing(true);
    try {
      // Capture the version before flushing so the worker can wait for exactly
      // the edits this click saw; flushing first could race a later keystroke.
      const version = Object.fromEntries(
        useCanvasStore.getState().workspace.doc.version().toJSON() as Map<string, number>,
      );
      await flush();
      await api.publishShare(token, version, overwrite);
      setStatus({ dirty: false, hasBaseline: status?.hasBaseline ?? true });
      return true;
    } catch (cause) {
      if (cause instanceof SharePublishConflictError) setConflict(cause.conflict);
      else setError(sharePublishErrorMessage(cause));
      return false;
    } finally {
      setPublishing(false);
    }
  };

  const publish = async () => {
    setConflict(null);
    await publishWith();
  };

  const publishSelected = async (keys: readonly string[]) => {
    if (await publishWith(keys)) setConflict(null);
  };

  const reload = async () => {
    if (reloading) return;
    const confirmed = window.confirm(
      "Reload from the workspace? Your unpublished changes will be discarded.",
    );
    if (!confirmed) return;
    setReloading(true);
    setError(null);
    try {
      await api.reloadShare(token);
      setConflict(null);
      setStatus({ dirty: false, hasBaseline: status?.hasBaseline ?? true });
    } catch (cause) {
      setError(sharePublishErrorMessage(cause));
    } finally {
      setReloading(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        data-testid="share-publish"
        disabled={publishing || reloading || conflict !== null}
        className="rounded-md px-2 py-1 text-[11px] text-[var(--ink-muted)] transition-colors hover:bg-black/5 hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
        onClick={() => void publish()}
        title="Publish these changes to the workspace."
      >
        {publishing ? "Publishing\u2026" : "Publish"}
      </button>
      {status ? (
        <span
          data-testid="publish-status"
          className="text-[11px] text-[var(--ink-muted)]"
          role="status"
        >
          {!status.hasBaseline || status.dirty ? "Draft" : "Published"}
        </span>
      ) : null}
      {error ? (
        <span
          role="alert"
          data-testid="publish-error"
          className="max-w-[220px] truncate text-[11px] text-red-600 dark:text-red-300"
          title={error}
        >
          {error}
        </span>
      ) : null}
      {conflict ? (
        <ConflictDialog
          conflict={conflict}
          publishing={publishing}
          reloading={reloading}
          onPublishSelected={(keys) => void publishSelected(keys)}
          onReload={() => void reload()}
          onClose={() => setConflict(null)}
        />
      ) : null}
    </div>
  );
}

/** One card's block conflicts, or a single unrelated conflict. */
interface ConflictGroup {
  key: string;
  /** The card name a block group shares, when it has several entries. */
  title: string | null;
  entries: SharePublishConflictEntry[];
}

/** `card:<id>:body:<block>`; the legacy whole-body key has no block suffix. */
const BODY_BLOCK_KEY = /^card:[^:]+:body:.+$/;

/**
 * Groups the conflict list by object. Per-block body keys arrive one per block,
 * so a card with three changed paragraphs would otherwise read as three
 * unrelated rows: they share a heading instead, and each row keeps only its
 * block label.
 */
export function groupConflicts(entries: readonly SharePublishConflictEntry[]): ConflictGroup[] {
  const groups = new Map<string, ConflictGroup>();
  for (const entry of entries) {
    const groupKey = BODY_BLOCK_KEY.test(entry.key)
      ? entry.key.slice(0, entry.key.indexOf(":body:") + ":body".length)
      : entry.key;
    const existing = groups.get(groupKey);
    if (existing) existing.entries.push(entry);
    else groups.set(groupKey, { key: groupKey, title: null, entries: [entry] });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    title: group.entries.length > 1 ? blockGroupTitle(group.entries) : null,
  }));
}

/** The card name in `Alpha · paragraph: …`, without the block part. */
function blockGroupTitle(entries: readonly SharePublishConflictEntry[]): string {
  for (const entry of entries) {
    const cut = (entry.label ?? "").indexOf(" \u00b7 ");
    if (cut > 0) return (entry.label as string).slice(0, cut);
  }
  return "Card body";
}

/** A row inside a group drops the name the group already shows. */
function entryText(entry: SharePublishConflictEntry, group: ConflictGroup): string {
  const label = entry.label ?? entry.key;
  if (group.title && entry.label?.startsWith(`${group.title} \u00b7 `)) {
    return entry.label.slice(group.title.length + 3);
  }
  return label;
}

function ConflictDialog({
  conflict,
  publishing,
  reloading,
  onPublishSelected,
  onReload,
  onClose,
}: {
  conflict: SharePublishConflict;
  publishing: boolean;
  reloading: boolean;
  onPublishSelected: (keys: readonly string[]) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  // Unchecked is the default and means "keep the workspace version"; checking a
  // row is the only way a draft value overwrites the workspace's.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const blocked = conflict.unsupported.length > 0;
  const onlyUnsupported = blocked && conflict.conflicts.length === 0;
  const groups = groupConflicts(conflict.conflicts);

  useEscapeLayer(onClose);

  const toggle = (key: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close publish dialog"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Resolve publish conflicts"
        data-testid="publish-conflict"
        className="relative w-[min(440px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl"
      >
        <h2 className="text-sm font-semibold">
          {onlyUnsupported ? "Can't publish yet" : "Resolve publish conflicts"}
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-muted)]">
          {onlyUnsupported
            ? "Some new items depend on workspace data that changed. Nothing has been published; your draft is still here."
            : "The workspace changed since this draft started. Check a field to keep your version; unchecked fields keep the workspace version."}
        </p>
        {conflict.reason ? (
          <p className="mt-2 text-[11px] text-[var(--ink-muted)]">{conflict.reason}</p>
        ) : null}
        {conflict.conflicts.length > 0 ? (
          <ul className="mt-2 space-y-1" data-testid="publish-conflict-keys">
            {groups.map((group) => (
              <li key={group.key} data-key={group.key}>
                {group.title ? (
                  <p
                    data-testid="publish-conflict-group"
                    className="text-[11px] font-medium text-[var(--ink)]"
                  >
                    {group.title}
                    <span className="ml-1 font-normal text-[var(--ink-muted)]">
                      {group.entries.length} blocks
                    </span>
                  </p>
                ) : null}
                <ul className={group.title ? "mt-0.5 space-y-1 pl-2" : "space-y-1"}>
                  {group.entries.map((entry) => (
                    <li key={`${entry.key}:${entry.kind ?? ""}`} data-key={entry.key}>
                      <label
                        data-key={entry.key}
                        className="flex cursor-pointer items-start gap-2 text-[11px] leading-5"
                      >
                        <input
                          type="checkbox"
                          data-testid="publish-keep"
                          data-key={entry.key}
                          checked={selected.has(entry.key)}
                          onChange={() => toggle(entry.key)}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="font-medium text-[var(--ink)]">
                            {entryText(entry, group)}
                          </span>
                          <span className="ml-1 text-[var(--ink-muted)]">{entry.message}</span>
                          <span className="block text-[10px] text-[var(--ink-muted)]">
                            Keep my version
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}
        {conflict.unsupported.length > 0 ? (
          <div className="mt-2" data-testid="publish-conflict-unsupported">
            <h3 className="text-[10px] uppercase tracking-wide text-[var(--ink-muted)]">
              Not publishable
            </h3>
            <ul className="space-y-1">
              {conflict.unsupported.map((entry) => (
                <li key={`${entry.key}:${entry.kind ?? ""}`} className="text-[11px] leading-5">
                  <span className="font-medium text-[var(--ink)]">{entry.label ?? entry.key}</span>
                  <span className="ml-1 text-[var(--ink-muted)]">{entry.message}</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[10px] text-[var(--ink-muted)]">
              {onlyUnsupported
                ? "Keep editing, or reload from the workspace to discard the draft."
                : "These changes cannot be published, so publishing stays blocked."}
            </p>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            data-testid="publish-close"
            className="rounded-md px-3 py-1.5 text-xs text-[var(--ink-muted)] transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            onClick={onClose}
          >
            {onlyUnsupported ? "Keep editing" : "Close"}
          </button>
          <button
            type="button"
            data-testid="publish-reload"
            disabled={reloading || publishing}
            className="rounded-md px-3 py-1.5 text-xs text-[var(--ink-muted)] transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
            onClick={onReload}
            title="Discard this draft and rebuild it from the workspace."
          >
            {reloading ? "Reloading\u2026" : "Reload from workspace"}
          </button>
          {onlyUnsupported ? null : (
            <button
              type="button"
              data-testid="publish-selected"
              disabled={publishing || blocked}
              className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-xs text-[var(--surface)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => onPublishSelected([...selected])}
              title={
                blocked
                  ? "Resolve the changes that cannot be published first."
                  : "Publish the checked fields and keep the workspace for the rest."
              }
            >
              {publishing ? "Publishing\u2026" : "Publish selected"}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
