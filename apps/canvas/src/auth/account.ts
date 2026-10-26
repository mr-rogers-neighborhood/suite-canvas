import { getSession } from "../session/session";
import { readRecentWorkspaces } from "../session/workspaceTransfer";
import { probeAuth } from "./availability";
import { claimLocalWorkspaces } from "./claimOnSignIn";
import {
  claimWorkspace,
  ensureOrganization,
  lastUsedMethod,
  readSessionUser,
  signOut,
} from "./client";
import { type AccountSummary, useAccountStore } from "./useAccountStore";

/**
 * The session, the claim, and the order they happen in.
 *
 * The sequence is the ADR's, not ours: **probe, read the session, claim, then let
 * the screen decide**. Claiming runs after a session exists and never before, so
 * a device with no account is not touched at all — no request is made, no local
 * metadata is rewritten, and the storage ladder stays on its anonymous rung.
 */

/** The tenant name for an account that is getting its first organization. */
const ORGANIZATION_NAME = "My workspaces";

/** The session user, narrowed from whatever the server returned. */
export function accountFromUser(user: unknown): AccountSummary | null {
  if (user === null || typeof user !== "object") return null;
  const record = user as Record<string, unknown>;
  if (typeof record.id !== "string" || record.id.length === 0) return null;
  return {
    userId: record.id,
    email: typeof record.email === "string" && record.email.length > 0 ? record.email : null,
    admittedAt: typeof record.admittedAt === "number" ? record.admittedAt : null,
  };
}

/**
 * The workspace ids this device already holds: the recents list the launcher
 * writes, plus the workspace in the URL. Nothing new is persisted to make the
 * claim possible.
 */
export function localWorkspaceIds(): string[] {
  const ids = readRecentWorkspaces().map((entry) => entry.id);
  const open = getSession().workspaceId;
  if (open) ids.unshift(open);
  return [...new Set(ids)];
}

let bootstrapped: Promise<void> | null = null;

/**
 * Probes the deployment and reads the session. Idempotent: `App` and the dialog
 * host both want the answer, and the answer costs one request.
 */
export function bootstrapAccount(): Promise<void> {
  bootstrapped ??= (async () => {
    const availability = await probeAuth();
    if (availability === "unavailable") {
      useAccountStore.getState().applySession({ availability, account: null });
      return;
    }
    const account = accountFromUser(await readSessionUser());
    useAccountStore.getState().applySession({ availability, account });
    if (account !== null) await claimLocalWorkspacesInto(account);
  })().catch(() => {
    // A probe that failed for an unforeseen reason is "no accounts here", not a crash.
    useAccountStore.getState().applySession({ availability: "unavailable", account: null });
  });
  return bootstrapped;
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
  if (account !== null) await claimLocalWorkspacesInto(account);
}

/** The account whose claim already ran in this page, so it runs once, not per render. */
let claimedFor: string | null = null;

/**
 * Claims every workspace this device holds. Runs once per page load per session:
 * the outcome is remembered once, and the claim is idempotent server-side anyway.
 *
 * `localWorkspaceIds` is reachable — the launcher's recents list plus the id in
 * the URL — so this claims the set on sign-in rather than lazily, one workspace at
 * a time. A workspace created later is claimed at the next load, because creating
 * one navigates: the list is written before the URL changes.
 */
async function claimLocalWorkspacesInto(account: AccountSummary): Promise<void> {
  if (claimedFor === account.userId) return;
  claimedFor = account.userId;
  const store = useAccountStore.getState();
  store.beginClaim();
  const report = await claimLocalWorkspaces({
    workspaceIds: localWorkspaceIds,
    organization: () => ensureOrganization(ORGANIZATION_NAME),
    claim: claimWorkspace,
  });
  useAccountStore.getState().finishClaim(report);
}

/** Ends the session locally and forgets the account, leaving the workspace alone. */
export async function signOutAccount(): Promise<void> {
  await signOut();
  claimedFor = null;
  bootstrapped = null;
  useAccountStore.getState().clear();
}

/** The last method that worked, for the dialog's leading offer. */
export { lastUsedMethod };
