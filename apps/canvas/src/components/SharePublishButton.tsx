import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { getSession } from "../session/session";
import {
  publishShare,
  reloadShare,
  type SharePublishConflict,
  SharePublishConflictError,
  sharePublishErrorMessage,
} from "../session/shares";
import { useCanvasStore } from "../store/useCanvasStore";
import { useUiStore } from "../store/useUiStore";

/** The slice of the publish API the button needs; tests may replace it. */
export interface PublishClient {
  publishShare: (token: string, version: Record<string, number>) => Promise<unknown>;
  reloadShare: (token: string) => Promise<void>;
}

const defaultClient: PublishClient = { publishShare, reloadShare };

export interface SharePublishButtonProps {
  /** Capability token; defaults to the share this page was opened with. */
  token?: string | null;
  client?: PublishClient;
}

const PUBLISHED_MS = 2000;

/**
 * Publishes an editor share's draft to the owner's workspace. A conflict is
 * not an error to retry blindly: the only offered path is discarding the draft
 * by reloading the projection from the workspace.
 */
export function SharePublishButton({ token: tokenProp, client }: SharePublishButtonProps) {
  const canPublish = useUiStore((state) => state.canPublish);
  const flush = useCanvasStore((state) => state.flush);
  const api = client ?? defaultClient;
  const token = tokenProp ?? getSession().share?.token ?? null;

  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [conflict, setConflict] = useState<SharePublishConflict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const publishedTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (publishedTimer.current !== null) window.clearTimeout(publishedTimer.current);
    },
    [],
  );

  if (!canPublish || !token) return null;

  const flashPublished = () => {
    setPublished(true);
    if (publishedTimer.current !== null) window.clearTimeout(publishedTimer.current);
    publishedTimer.current = window.setTimeout(() => {
      publishedTimer.current = null;
      setPublished(false);
    }, PUBLISHED_MS);
  };

  const publish = async () => {
    if (publishing) return;
    setError(null);
    setConflict(null);
    setPublished(false);
    setPublishing(true);
    try {
      // Capture the version before flushing so the worker can wait for exactly
      // the edits this click saw; flushing first could race a later keystroke.
      const version = Object.fromEntries(
        useCanvasStore.getState().workspace.doc.version().toJSON() as Map<string, number>,
      );
      await flush();
      await api.publishShare(token, version);
      flashPublished();
    } catch (cause) {
      if (cause instanceof SharePublishConflictError) setConflict(cause.conflict);
      else setError(sharePublishErrorMessage(cause));
    } finally {
      setPublishing(false);
    }
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
      setPublished(false);
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
      {published ? (
        <span
          data-testid="publish-status"
          className="text-[11px] text-[var(--ink-muted)]"
          role="status"
        >
          Published
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
          reloading={reloading}
          onReload={() => void reload()}
          onClose={() => setConflict(null)}
        />
      ) : null}
    </div>
  );
}

function ConflictDialog({
  conflict,
  reloading,
  onReload,
  onClose,
}: {
  conflict: SharePublishConflict;
  reloading: boolean;
  onReload: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

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
        aria-label="Publish blocked"
        data-testid="publish-conflict"
        className="relative w-[min(420px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl"
      >
        <h2 className="text-sm font-semibold">Publish blocked</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--ink-muted)]">
          The workspace changed since this draft started. Reload from the workspace to pick up the
          owner&rsquo;s version; your unpublished changes will be discarded.
        </p>
        {conflict.reason ? (
          <p className="mt-2 text-[11px] text-[var(--ink-muted)]">{conflict.reason}</p>
        ) : null}
        {conflict.conflicts.length > 0 ? (
          <ul className="mt-2 space-y-1" data-testid="publish-conflict-keys">
            {conflict.conflicts.map((entry) => (
              <li key={`${entry.key}:${entry.kind ?? ""}`} className="text-[11px] leading-5">
                <span className="font-medium text-[var(--ink)]">{entry.key}</span>
                <span className="ml-1 text-[var(--ink-muted)]">{entry.message}</span>
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
                  <span className="font-medium text-[var(--ink)]">{entry.key}</span>
                  <span className="ml-1 text-[var(--ink-muted)]">{entry.message}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            data-testid="publish-close"
            className="rounded-md px-3 py-1.5 text-xs text-[var(--ink-muted)] transition-colors hover:bg-black/5 dark:hover:bg-white/10"
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="button"
            data-testid="publish-reload"
            disabled={reloading}
            className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-xs text-[var(--surface)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onReload}
          >
            {reloading ? "Reloading\u2026" : "Reload from workspace"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
