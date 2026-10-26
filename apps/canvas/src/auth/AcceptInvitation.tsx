import { useCallback, useState } from "react";
import { authClient } from "./client";
import { useAccountStore } from "./useAccountStore";

/**
 * The page an invitation email lands on (ADR-0077).
 *
 * The server mails `${origin}/accept-invitation?id=<invitation>`, and the plugin
 * binds the invitation to the address it was sent to: holding the link is not
 * enough, the signed-in account has to be that person. So this screen asks for a
 * sign-in first and only then spends the invitation — which is exactly why an
 * invitation is safe to forward by accident.
 *
 * Accepting a first invitation also creates the membership; a second one from the
 * same organization is answered as already accepted, and the screen says so
 * instead of failing.
 */

export type AcceptResult = { ok: true } | { ok: false; message: string };

export interface AcceptInvitationProps {
  invitationId: string;
  /** The call itself; tests and stories replace it. */
  accept?: (invitationId: string) => Promise<AcceptResult>;
}

async function acceptWithPlugin(invitationId: string): Promise<AcceptResult> {
  try {
    const result = await authClient.organization.acceptInvitation({ invitationId });
    if (result.error) {
      const message = (result.error as { message?: unknown }).message;
      return {
        ok: false,
        message:
          typeof message === "string" && message.length > 0
            ? message
            : "That invitation could not be accepted.",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "The account service did not answer, so nothing changed." };
  }
}

export function AcceptInvitation({
  invitationId,
  accept = acceptWithPlugin,
}: AcceptInvitationProps) {
  const phase = useAccountStore((state) => state.phase);
  const account = useAccountStore((state) => state.account);
  const openSignIn = useAccountStore((state) => state.openSignIn);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await accept(invitationId);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setDone(true);
  }, [accept, invitationId]);

  return (
    <section
      data-testid="accept-invitation"
      className="mb-4 rounded-xl border border-[var(--hairline)] bg-[var(--surface)] px-4 py-3 text-[12px]"
    >
      <h2 className="text-[13px] font-semibold">An invitation</h2>
      {done ? (
        <p data-testid="accept-invitation-done" className="mt-1 leading-5">
          You are in. Open a workspace from the list below, or create one; the invitation added this
          account to the team.
        </p>
      ) : phase !== "signed-in" ? (
        <>
          <p className="mt-1 leading-5 text-[var(--ink-muted)]">
            Sign in with the address the invitation was sent to. It only works for that address.
          </p>
          <button
            type="button"
            data-testid="accept-invitation-sign-in"
            onClick={() => openSignIn("sign-in")}
            className="mt-2 rounded-lg bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-[var(--surface)]"
          >
            Sign in to accept
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 leading-5">
            Accepting adds {account?.email ?? "this account"} to the team that sent it.
          </p>
          <button
            type="button"
            data-testid="accept-invitation-submit"
            disabled={busy}
            onClick={() => void submit()}
            className="mt-2 rounded-lg bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-[var(--surface)] disabled:opacity-50"
          >
            {busy ? "Accepting…" : "Accept invitation"}
          </button>
        </>
      )}
      {error === null ? null : (
        <p
          role="alert"
          data-testid="accept-invitation-error"
          className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-800 dark:text-red-200"
        >
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * The invitation id in the page URL, when this page *is* the invitation landing.
 * Read from the address bar rather than a router: the app has no routes, and this
 * is the one path a mail link can name.
 */
export function invitationIdFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url, "http://suite.invalid");
    if (!/\/accept-invitation\/?$/u.test(parsed.pathname)) return null;
    const id = parsed.searchParams.get("id");
    return id !== null && id.trim().length > 0 ? id.trim() : null;
  } catch {
    return null;
  }
}
