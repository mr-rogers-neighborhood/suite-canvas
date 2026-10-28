import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { credentialAuthorization } from "../auth/credential";
import { authServiceBase } from "../auth/endpoints";
import { useEscapeLayer } from "../shell/escapeLayers";
import { useFocusTrap } from "./useFocusTrap";

/** The account's own support-access row, as the route returns it. */
export interface SupportAccessState {
  granted: boolean;
  grantedAt: number | null;
}

export interface SupportAccessDialogProps {
  onClose: () => void;
  /** Tests replace the two calls; the real ones are the account route. */
  read?: () => Promise<SupportAccessState>;
  write?: (granted: boolean) => Promise<SupportAccessState>;
}

const URL_BASE = `${authServiceBase()}/api/account/support-access`;

async function call(method: "GET" | "PUT" | "DELETE"): Promise<SupportAccessState> {
  const authorization = await credentialAuthorization();
  const response = await fetch(URL_BASE, {
    method,
    headers: { ...authorization },
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Sign in to change your support access."
        : "The server did not answer; nothing changed.",
    );
  }
  const body = (await response.json()) as { granted?: unknown; grantedAt?: unknown };
  return {
    granted: body.granted === true,
    grantedAt: typeof body.grantedAt === "number" ? body.grantedAt : null,
  };
}

/**
 * Support access: the account's own consent, and the only place it can be given.
 *
 * An operator can end this at any time, but cannot start it: the row below is the whole
 * permission, and it is written from this session. While it is on, an operator can open
 * this account and see what it sees; the banner in the app says when that is happening.
 * Turning it off takes one click and needs nothing from support.
 */
export function SupportAccessDialog({
  onClose,
  read = () => call("GET"),
  write = (granted) => call(granted ? "PUT" : "DELETE"),
}: SupportAccessDialogProps) {
  const [state, setState] = useState<SupportAccessState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);

  useEscapeLayer(onClose);
  useFocusTrap(panel);

  useEffect(() => {
    let live = true;
    read()
      .then((next) => {
        if (live) setState(next);
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : "The server did not answer.");
      });
    return () => {
      live = false;
    };
  }, [read]);

  const toggle = async () => {
    if (state === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      setState(await write(!state.granted));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The change did not save.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Support access"
        tabIndex={-1}
        data-testid="support-access-dialog"
        className="relative w-[min(440px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl"
      >
        <h2 className="text-sm font-semibold">Support access</h2>
        <p className="mt-2 text-xs leading-relaxed text-[var(--ink)]">
          While this is on, someone running this deployment can open your account to see what you
          see, so they can answer a question about your boards. They cannot start on their own: this
          switch is yours, they are told when they do it, and turning it off needs nothing from
          them.
        </p>
        {state === null ? (
          <p className="mt-3 text-xs text-[var(--ink-muted)]">
            {error ?? "Checking your setting…"}
          </p>
        ) : (
          <p
            className="mt-3 text-xs text-[var(--ink-muted)]"
            data-testid="support-access-state"
            data-granted={state.granted ? "true" : "false"}
          >
            {state.granted
              ? "Support access is on. An operator can open your account until you turn this off."
              : "Support access is off. Nobody can open your account."}
          </p>
        )}
        {error !== null && state !== null ? (
          <p role="alert" className="mt-2 text-xs text-red-600 dark:text-red-300">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-lg border border-[var(--hairline)] px-2.5 py-1 text-xs"
            onClick={onClose}
          >
            Close
          </button>
          <button
            type="button"
            data-testid="support-access-toggle"
            className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs text-white disabled:opacity-50"
            disabled={state === null || busy}
            onClick={() => void toggle()}
          >
            {state?.granted === true ? "Turn support access off" : "Turn support access on"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
