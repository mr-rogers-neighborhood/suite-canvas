import { type FormEvent, useCallback, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../dialogs/useFocusTrap";
import { useEscapeLayer } from "../shell/escapeLayers";
import type { AuthAvailability } from "./availability";
import {
  emailProblem,
  passwordProblem,
  type SignInActions,
  type SignInMethod,
  signInOffers,
} from "./signIn";
import { TurnstileWidget } from "./TurnstileWidget";

/**
 * The front door: passkey, password, magic link, Google — and sign-up (ADR-0077).
 *
 * Three honest states, and the honesty is the feature:
 *
 * - `unknown`      — we asked the deployment and it has not answered yet.
 * - `unavailable`  — there is no account service on this deployment. The panel
 *                    says so plainly and offers no buttons, because a magic-link
 *                    form that can never send anything is a lie with a cursor.
 * - `available`    — the ways in, with the method that worked last first, and a
 *                    switch to create an account.
 *
 * It never gate-keeps the workspace: closing the dialog leaves the device exactly
 * as it was, still local, still editable.
 */

export interface SignInDialogProps {
  availability: AuthAvailability;
  /** The method that worked last, from the server's cookie. */
  last: SignInMethod | null;
  actions: SignInActions;
  /**
   * Opens on the sign-up form instead of the sign-in list. The launcher offers
   * both, and a stranger arriving from a pricing page has no account to sign in
   * to.
   */
  initialMode?: "sign-in" | "sign-up";
  /** Turnstile site key. Absent means the deployment did not turn the challenge on. */
  captchaSiteKey?: string | null;
  onClose: () => void;
  /** Re-read the session: a passkey signs in without leaving the page. */
  onSignedIn: () => void;
}

const TITLES: Record<SignInMethod, string> = {
  passkey: "Passkey",
  password: "Password",
  "magic-link": "Magic link",
};

export function SignInDialog({
  availability,
  last,
  actions,
  initialMode = "sign-in",
  captchaSiteKey = null,
  onClose,
  onSignedIn,
}: SignInDialogProps) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">(initialMode);
  const [busy, setBusy] = useState<SignInMethod | "sign-up" | null>(null);
  /**
   * The password path, folded away by default.
   *
   * A link needs nothing but an address and a passkey needs nothing at all, so the two
   * doors that ask the reader to remember something are behind one press. It is a
   * disclosure rather than a hidden feature: the copy names it, so a reader who wants a
   * password is not hunting for the door.
   */
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const offers = useMemo(() => signInOffers(last), [last]);
  const panel = useRef<HTMLDivElement | null>(null);

  useEscapeLayer(onClose);
  useFocusTrap(panel);

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

  const signInWithPassword = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const invalid = emailProblem(email) ?? passwordProblem(password);
      if (invalid !== null) {
        setProblem(invalid);
        return;
      }
      setBusy("password");
      setProblem(null);
      const result = await actions.password({ email, password });
      setBusy(null);
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      onSignedIn();
      onClose();
    },
    [actions, email, onClose, onSignedIn, password],
  );

  const createAccount = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const invalid = emailProblem(email) ?? passwordProblem(password);
      if (invalid !== null) {
        setProblem(invalid);
        return;
      }
      setBusy("sign-up");
      setProblem(null);
      const result = await actions.signUp({ name, email, password, captchaToken: captcha });
      setBusy(null);
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      setNotice(result.message);
    },
    [actions, captcha, email, name, password],
  );

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

  /**
   * Creating an account with a link.
   *
   * The address is the account, and following the link is what proves it — so this is the
   * same call the sign-in screen makes. Better Auth creates the user on first use, which
   * is why "sign up" and "sign in" are one path here: a reader should not have to know
   * which of the two they are.
   */
  const createWithLink = useCallback(
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

  const feedback = (
    <>
      {notice === null ? null : (
        <p
          data-testid="sign-in-notice"
          role="status"
          className="mt-2 rounded-lg border border-[var(--hairline)] bg-black/[0.03] px-2 py-1.5 text-[12px] leading-5 dark:bg-white/[0.06]"
        >
          {notice}
        </p>
      )}
      {problem === null ? null : (
        <p
          data-testid="sign-in-problem"
          role="alert"
          className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[12px] leading-5 text-red-800 dark:text-red-200"
        >
          {problem}
        </p>
      )}
    </>
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
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "sign-up" ? "Create an account" : "Sign in"}
        tabIndex={-1}
        data-testid="sign-in-dialog"
        data-availability={availability}
        data-mode={mode}
        className="relative w-[min(380px,calc(100vw-2rem))] rounded-xl border border-[var(--hairline)] bg-[var(--surface)] p-4 shadow-xl"
      >
        <h2 className="text-sm font-semibold">
          {mode === "sign-up" ? "Create an account" : "Sign in"}
        </h2>

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

        {availability === "available" && mode === "sign-in" ? (
          <>
            <p className="mt-1.5 text-[12px] leading-5 text-[var(--ink-muted)]">
              Signing in keeps this workspace yours across devices.
            </p>

            {feedback}

            {/*
              One field, one press: a link is the shortest path from "I have an account" to
              being in it, and it costs the reader no new secret. The passkey button sits
              beside it for a device that already holds one, and the password is the
              exception behind the disclosure at the bottom.
            */}
            <form onSubmit={sendLink} className="mt-3 flex flex-col gap-1.5">
              <label className="text-[11px] text-[var(--ink-muted)]" htmlFor="sign-in-email">
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
                className="self-start rounded-lg bg-[var(--ink)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--surface)] disabled:opacity-50"
              >
                {busy === "magic-link" ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>

            {offers.some((offer) => offer.method === "passkey") ? (
              <button
                type="button"
                data-testid="sign-in-passkey"
                disabled={busy !== null}
                onClick={() => void passkey()}
                className="mt-2 w-full rounded-lg border border-[var(--hairline)] px-2.5 py-1.5 text-left text-[12px] text-[var(--ink)] hover:bg-black/5 disabled:opacity-50 dark:hover:bg-white/10"
              >
                {busy === "passkey" ? `${TITLES.passkey}…` : "Use a passkey instead"}
              </button>
            ) : null}

            {passwordOpen ? (
              <form onSubmit={signInWithPassword} className="mt-2 flex flex-col gap-1.5">
                <input
                  data-testid="sign-in-password-value"
                  type="password"
                  aria-label="Password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="rounded-lg border border-[var(--hairline)] bg-transparent px-2 py-1 text-[12px]"
                />
                <button
                  type="submit"
                  data-testid="sign-in-password-submit"
                  disabled={busy !== null}
                  className="self-start rounded-lg border border-[var(--hairline)] px-2.5 py-1 text-[11px] disabled:opacity-50"
                >
                  {busy === "password" ? "Signing in…" : "Sign in with the password above"}
                </button>
              </form>
            ) : (
              <button
                type="button"
                data-testid="sign-in-password"
                onClick={() => {
                  setPasswordOpen(true);
                  setProblem(null);
                }}
                className="mt-2 text-[11px] text-[var(--ink-muted)] underline decoration-dotted"
              >
                Use a password instead
              </button>
            )}

            <p className="mt-3 border-t border-[var(--hairline)] pt-2 text-[11px] leading-5 text-[var(--ink-muted)]">
              Signing in keeps the workspaces this device already holds: same workspace, same link.
            </p>

            <button
              type="button"
              data-testid="sign-in-to-sign-up"
              onClick={() => {
                setMode("sign-up");
                setProblem(null);
                setNotice(null);
                setPasswordOpen(false);
              }}
              className="mt-2 text-[11px] text-[var(--ink)] underline decoration-dotted"
            >
              No account yet? Create one
            </button>
          </>
        ) : null}

        {availability === "available" && mode === "sign-up" ? (
          <form
            onSubmit={passwordOpen ? createAccount : createWithLink}
            className="mt-2 flex flex-col gap-1.5"
          >
            <p className="text-[12px] leading-5 text-[var(--ink-muted)]">
              An account syncs this workspace, and the workspaces this device already holds come
              with you.
            </p>
            {feedback}
            <label className="mt-1 text-[11px] text-[var(--ink-muted)]" htmlFor="sign-up-name">
              Name
            </label>
            <input
              id="sign-up-name"
              data-testid="sign-up-name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded-lg border border-[var(--hairline)] bg-transparent px-2 py-1 text-[12px]"
            />
            <label className="text-[11px] text-[var(--ink-muted)]" htmlFor="sign-up-email">
              Email address
            </label>
            <input
              id="sign-up-email"
              data-testid="sign-up-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded-lg border border-[var(--hairline)] bg-transparent px-2 py-1 text-[12px]"
            />
            {/*
              Creating an account needs no password either: the link proves the address, and
              the address is the account. A password is offered for a reader who wants one —
              the same disclosure the sign-in screen uses, so the two read alike.
            */}
            {passwordOpen ? (
              <>
                <label className="text-[11px] text-[var(--ink-muted)]" htmlFor="sign-up-password">
                  Password
                </label>
                <input
                  id="sign-up-password"
                  data-testid="sign-up-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="rounded-lg border border-[var(--hairline)] bg-transparent px-2 py-1 text-[12px]"
                />
                {captchaSiteKey ? (
                  <TurnstileWidget siteKey={captchaSiteKey} onToken={setCaptcha} />
                ) : null}
                <button
                  type="submit"
                  data-testid="sign-up-submit"
                  disabled={busy !== null}
                  className="mt-1 rounded-lg bg-[var(--ink)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--surface)] disabled:opacity-50"
                >
                  {busy === "sign-up" ? "Creating…" : "Create account"}
                </button>
              </>
            ) : (
              <button
                type="submit"
                data-testid="sign-up-link-submit"
                disabled={busy !== null}
                className="mt-1 rounded-lg bg-[var(--ink)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--surface)] disabled:opacity-50"
              >
                {busy === "magic-link" ? "Sending…" : "Create the account with an email link"}
              </button>
            )}
            {passwordOpen ? (
              <button
                type="button"
                onClick={() => {
                  setPasswordOpen(false);
                  setProblem(null);
                }}
                className="self-start text-[11px] text-[var(--ink-muted)] underline decoration-dotted"
              >
                Use an email link instead
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPasswordOpen(true);
                  setProblem(null);
                }}
                className="self-start text-[11px] text-[var(--ink-muted)] underline decoration-dotted"
              >
                Use a password instead
              </button>
            )}
            <button
              type="button"
              data-testid="sign-up-to-sign-in"
              onClick={() => {
                setMode("sign-in");
                setProblem(null);
                setNotice(null);
                setPasswordOpen(false);
              }}
              className="self-start text-[11px] text-[var(--ink-muted)] underline decoration-dotted"
            >
              I already have an account
            </button>
          </form>
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
