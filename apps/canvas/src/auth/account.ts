import {
  forgetAnonymousSession,
  hadAnonymousSession,
  linkPrompt,
  localWorkspaceIds,
  rememberAnonymousSession,
} from "./anonymous";
import { probeAuth } from "./availability";
import { lastUsedMethod, readSessionUser, signInAnonymously, signOut } from "./client";
import { forgetCredential } from "./credential";
import { type AccountSummary, useAccountStore } from "./useAccountStore";

/**
 * The session, and the one thing that happens after it appears.
 *
 * The order is: **probe, read the session, give an anonymous session if there is
 * none, then let the screen decide**. No claim route runs here — a device that
 * worked without an account is linked by the server's `onLinkAccount` on the
 * first real sign-in (ADR-0076), and all this side does is say so once.
 */

/** The session user, narrowed from whatever the server returned. */
export function accountFromUser(user: unknown): AccountSummary | null {
  if (user === null || typeof user !== "object") return null;
  const record = user as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  return {
    userId: record.id,
    email: typeof record.email === "string" && record.email.length > 0 ? record.email : null,
    name: typeof record.name === "string" && record.name.length > 0 ? record.name : null,
    admittedAt: typeof record.admittedAt === "number" ? record.admittedAt : null,
  };
}

let bootstrapped: Promise<void> | null = null;

/**
 * Reads the deployment and the session once per page. Idempotent: `App` and the
 * dialog host both want the answer, and the answer costs one request.
 *
 * With no session and accounts available, this browser is given an anonymous one.
 * That is what makes "sign up later and keep your work" real: the server has a
 * user id to move the workspaces from.
 */
export function bootstrapAccount(): Promise<void> {
  bootstrapped ??= (async () => {
    const availability = await probeAuth();
    if (availability === "unavailable") {
      useAccountStore.getState().applySession({ availability, account: null });
      return;
    }
    const user = await readSessionUser();
    const account = accountFromUser(user);
    if (account !== null) {
      useAccountStore.getState().applySession({ availability, account });
      announceLink(account);
      return;
    }
    // No session: mint an anonymous one, which is also the flag that says this
    // device may have work to hand over at sign-up.
    const anonymous = await signInAnonymously();
    const created = accountFromUser(await readSessionUser());
    if (anonymous.ok && created !== null) rememberAnonymousSession();
    useAccountStore.getState().applySession({ availability, account: created });
  })().catch(() => {
    // A probe that failed for an unforeseen reason is "no accounts here", not a crash.
    useAccountStore.getState().applySession({ availability: "unavailable", account: null });
  });
  return bootstrapped;
}

/**
 * The one prompt, once: this device worked anonymously and now belongs to an
 * account. The server already moved the rows (`onLinkAccount`), so this is a
 * sentence rather than a protocol — nothing here retries or reconciles.
 */
function announceLink(account: AccountSummary): void {
  if (!hadAnonymousSession()) return;
  const prompt = linkPrompt({
    email: account.email,
    workspaceIds: localWorkspaceIds(),
    wasAnonymous: true,
  });
  forgetAnonymousSession();
  useAccountStore.getState().noteLinked(prompt);
}

/** Re-reads the session after an action that may have created one (sign-in). */
export async function refreshAccount(): Promise<void> {
  const availability = await probeAuth();
  if (availability === "unavailable") {
    useAccountStore.getState().applySession({ availability, account: null });
    return;
  }
  const account = accountFromUser(await readSessionUser());
  useAccountStore.getState().applySession({ availability, account });
  // A fresh sign-in invalidates any token minted for the previous session.
  forgetCredential();
  if (account === null) return;
  announceLink(account);
  // A room refused at boot because there was no credential is joinable now, and
  // the provider re-mints on join. Loaded on demand: the account module must not
  // pull the document store in at import time.
  const { useCanvasStore } = await import("../store/useCanvasStore");
  useCanvasStore.getState().rejoin();
}

/** Ends the session locally and forgets the account, leaving the workspace alone. */
export async function signOutAccount(): Promise<void> {
  await signOut();
  forgetAnonymousSession();
  bootstrapped = null;
  useAccountStore.getState().clear();
}

/** The last method that worked, for the dialog's leading offer. */
export { lastUsedMethod };
