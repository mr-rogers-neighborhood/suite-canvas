import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { AuthAvailability } from "./availability";
import { emailProblem, type SignInActions, type SignInMethod, signInOffers } from "./signIn";

/**
 * The front door: passkey, magic link, Google
 * (ADR-0067 §11).
 *
 * Three honest states, and the honesty is the feature:
 *
 * - `unknown`      — we asked the deployment and it has not answered yet.
 * - `unavailable`  — there is no account service on this deployment. The panel
 *                    says so plainly and offers no buttons, because a magic-link
 *                    form that can never send anything is a lie with a cursor.
 * - `available`    — the three ways in, with the method that worked last first.
 *
 * It never gate-keeps the workspace: closing the dialog leaves the device exactly
 * as it was, still local, still editable.
 */

export interface SignInDialogProps {
  availability: AuthAvailability;
  /** The method that worked last, from the server's cookie. */
  last: SignInMethod | null;
  actions: SignInActions;
  onClose: () => void;
  /** Re-read the session: a passkey signs in without leaving the page. */
  onSignedIn: () => void;
}

const TITLES: Record<SignInMethod, string> = {
  passkey: "Passkey",
  "magic-link": "Magic link",
  google: "Google",
};

export function SignInDialog({
  availability,
  last,
  actions,
  onClose,
  onSignedIn,
}: SignInDialogProps) {
  const [busy, setBusy] = useState<SignInMethod | null>(null);
  const [emailing, setEmailing] = useState(false);
  const [email, setEmail] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const offers = useMemo(() => signInOffers(last), [last]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const passkey = useCallback(async () => {
    setBusy("passkey");
    setProblem(null);
    const result = await actions.passkey();
    setBusy(null);
    if (result.ok) {
      onSignedIn();
      onClose();
      return;
    }
    setProblem(result.message);
  }, [actions, onClose, onSignedIn]);

  const google = useCallback(async () => {
    setBusy("google");
    setProblem(null);
    const result = await actions.google();
    setBusy(null);
    if (result.ok) {
      setNotice(result.message);
      return;
    }
    setProblem(result.message);
  }, [actions]);

  const sendLink = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const invalid = emailProblem(email);
      if (invalid !== null) {
        setProblem(invalid);
        return;
      }
      setBusy("magic-link");
      setProblem(null);
      const result = await actions.magicLink(email);
      setBusy(null);
      if (result.ok) {
        setNotice(result.message);
        return;
      }
      setProblem(result.message);
    },
    [actions, email],
  );

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close sign-in"
        className="absolute inset-0 cursor-default border-0 bg-black/25 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sign in"
        data-testid="sign-in-dialog"
        data-availability={availability}
        className="relative w-[min(360px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl"
      >
        <h2 className="text-sm font-semibold">Sign in</h2>

        {availability === "unknown" ? (
          <p
            data-testid="sign-in-checking"
            className="mt-2 text-[12px] leading-5 text-[var(--ink-muted)]"
          >
            Asking this deployment whether it has accounts…
          </p>
        ) : null}

        {availability === "unavailable" ? (
          <div data-testid="auth-unavailable" className="mt-2 text-[12px] leading-5">
            <p className="text-[var(--ink)]">Accounts are not available on this deployment.</p>
            <p className="mt-1.5 text-[var(--ink-muted)]">
              Nothing here changes: this workspace is saved in this browser, and editing, import and
              export keep working without an account.
            </p>
          </div>
        ) : null}

        {availability === "available" ? (
          <>
            <p className="mt-1.5 text-[12px] leading-5 text-[var(--ink-muted)]">
              Signing in keeps this workspace yours across devices. No passwords.
            </p>

            {notice === null ? null : (
              <p
                data-testid="sign-in-notice"
                role="status"
                className="mt-2 rounded-lg border border-[var(--hairline)] bg-black/[0.03] px-2 py-1.5 text-[12px] leading-5 dark:bg-white/[0.06]"
              >
                {notice}
              </p>
            )}

            <div className="mt-3 flex flex-col gap-2">
              {offers.map((offer) => {
                if (offer.method === "magic-link") {
                  return (
                    <div key={offer.method}>
                      <button
                        type="button"
                        data-testid="sign-in-magic-link"
                        data-recent={offer.recent ? "true" : undefined}
                        disabled={busy !== null}
                        onClick={() => {
                          setEmailing(true);
                          setProblem(null);
                        }}
                        className={`w-full rounded-lg border px-2.5 py-1.5 text-[12px] disabled:opacity-50 ${
                          offer.recent
                            ? "border-[var(--ink)] bg-[var(--ink)] font-medium text-[var(--surface)]"
                            : "border-[var(--hairline)] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
                        }`}
                      >
                        {offer.label}
                      </button>
                      {emailing ? (
                        <form onSubmit={sendLink} className="mt-2 flex flex-col gap-1.5">
                          <label
                            className="text-[11px] text-[var(--ink-muted)]"
                            htmlFor="sign-in-email"
                          >
                            Email address
                          </label>
                          <input
                            id="sign-in-email"
                            data-testid="sign-in-email"
                            type="email"
                            autoComplete="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            className="rounded-lg border border-[var(--hairline)] bg-transparent px-2 py-1 text-[12px]"
                          />
                          <button
                            type="submit"
                            data-testid="sign-in-email-submit"
                            disabled={busy !== null}
                            className="self-start rounded-lg border border-[var(--hairline)] px-2.5 py-1 text-[11px] disabled:opacity-50"
                          >
                            {busy === "magic-link" ? "Sending…" : "Email me a link"}
                          </button>
                        </form>
                      ) : null}
                    </div>
                  );
                }
                const run = offer.method === "passkey" ? passkey : google;
                return (
                  <button
                    key={offer.method}
                    type="button"
                    data-testid={`sign-in-${offer.method}`}
                    data-recent={offer.recent ? "true" : undefined}
                    disabled={busy !== null}
                    onClick={() => void run()}
                    className={`rounded-lg border px-2.5 py-1.5 text-[12px] disabled:opacity-50 ${
                      offer.recent
                        ? "border-[var(--ink)] bg-[var(--ink)] font-medium text-[var(--surface)]"
                        : "border-[var(--hairline)] text-[var(--ink)] hover:bg-black/5 dark:hover:bg-white/10"
                    }`}
                  >
                    {busy === offer.method ? `${TITLES[offer.method]}…` : offer.label}
                  </button>
                );
              })}
            </div>

            {problem === null ? null : (
              <p
                data-testid="sign-in-problem"
                role="alert"
                className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[12px] leading-5 text-red-800 dark:text-red-200"
              >
                {problem}
              </p>
            )}

            <p className="mt-3 border-t border-[var(--hairline)] pt-2 text-[11px] leading-5 text-[var(--ink-muted)]">
              Signing in claims the workspaces this device already holds. Same workspace, same link.
            </p>
          </>
        ) : null}

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            data-testid="sign-in-close"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[11px] text-[var(--ink-muted)] hover:bg-black/5 dark:hover:bg-white/10"
          >
            {availability === "available" ? "Not now" : "Close"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
