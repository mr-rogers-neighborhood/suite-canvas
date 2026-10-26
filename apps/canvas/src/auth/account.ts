import { probeAuth } from "./availability";
import { lastUsedMethod, readSession, signOut } from "./client";
import { forgetCredential } from "./credential";
import { ensureOrganization, ORGANIZATION_NAME, setActiveOrganization } from "./organization";
import { type AccountSummary, useAccountStore } from "./useAccountStore";

/**
 * The session, and the tenant it acts in.
 *
 * The order is: probe, read the session, make sure the account has an
 * organization, then let the screen decide. A browser with no session stops at
 * step two and stays local: no identity is created for it, and the relay is never
 * asked about it.
 *
 * The organization step is not cosmetic. A workspace belongs to an organization,
 * and the relay's token carries the organization it acts in. Better Auth's
 * `createOrganization` does not make the new organization active, so an account
 * without that second call holds an organization it never acts in and every join
 * is refused. Both calls are idempotent, so this is safe to run on every boot.
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

/**
 * What an account's first organization is called.
 *
 * Named after the person, because it is their space and the name shows in the plan
 * and member panels. `name` is what they typed at sign-up; the part before the
 * `@` is the fallback for a method that never asked for one.
 */
export function personalOrganizationName(account: AccountSummary): string {
  const named = account.name?.trim();
  if (named !== undefined && named.length > 0) return named;
  const local = account.email?.split("@")[0]?.trim();
  if (local !== undefined && local.length > 0) return local;
  return ORGANIZATION_NAME;
}

/**
 * The organization this session acts in, made and selected when the account has
 * none. Returns the id, or `null` when the account service refused, which leaves
 * the account signed in and the board local.
 */
export async function ensureActiveOrganization(
  account: AccountSummary,
  activeOrganizationId: string | null,
  deps: { ensure?: typeof ensureOrganization; activate?: typeof setActiveOrganization } = {},
): Promise<string | null> {
  if (activeOrganizationId !== null) return activeOrganizationId;
  const ensure = deps.ensure ?? ensureOrganization;
  const activate = deps.activate ?? setActiveOrganization;
  const answer = await ensure(personalOrganizationName(account));
  if (!answer.ok) return null;
  const activated = await activate(answer.organizationId);
  return activated ? answer.organizationId : null;
}

/** Applies "no session", which is a normal state and not a failure. */
function applySignedOut(availability: "available" | "unavailable"): void {
  useAccountStore.getState().applySession({ availability, account: null, organizationId: null });
}

let bootstrapped: Promise<void> | null = null;

/**
 * Reads the deployment and the session once per page. Idempotent: `App` and the
 * dialog host both want the answer, and the answer costs one request.
 *
 * A browser with no session is left alone. It keeps working entirely from
 * IndexedDB, and the board says so in its own words rather than reporting a
 * refusal from a server it never held a credential for.
 */
export function bootstrapAccount(): Promise<void> {
  bootstrapped ??= (async () => {
    const availability = await probeAuth();
    if (availability === "unavailable") {
      applySignedOut("unavailable");
      return;
    }
    const session = await readSession();
    const account = accountFromUser(session?.user);
    if (account === null) {
      applySignedOut("available");
      return;
    }
    const organizationId = await ensureActiveOrganization(
      account,
      session?.activeOrganizationId ?? null,
    );
    useAccountStore.getState().applySession({ availability, account, organizationId });
  })().catch(() => {
    // A probe that failed for an unforeseen reason is "no accounts here", not a crash.
    applySignedOut("unavailable");
  });
  return bootstrapped;
}

/** Re-reads the session after an action that may have created one (sign-in). */
export async function refreshAccount(): Promise<void> {
  const availability = await probeAuth();
  if (availability === "unavailable") {
    applySignedOut("unavailable");
    return;
  }
  const session = await readSession();
  const account = accountFromUser(session?.user);
  // A fresh sign-in invalidates any token minted for the previous session.
  forgetCredential();
  if (account === null) {
    applySignedOut("available");
    return;
  }
  const organizationId = await ensureActiveOrganization(
    account,
    session?.activeOrganizationId ?? null,
  );
  useAccountStore.getState().applySession({ availability, account, organizationId });
  // A room refused at boot because there was no credential is joinable now, and
  // the provider re-mints on join. Loaded on demand: the account module must not
  // pull the document store in at import time.
  const { useCanvasStore } = await import("../store/useCanvasStore");
  useCanvasStore.getState().rejoin();
}

/** Ends the session locally and forgets the account, leaving the workspace alone. */
export async function signOutAccount(): Promise<void> {
  await signOut();
  bootstrapped = null;
  useAccountStore.getState().clear();
}

/** The last method that worked, for the dialog's leading offer. */
export { lastUsedMethod };
