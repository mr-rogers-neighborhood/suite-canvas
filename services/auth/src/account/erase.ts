import { AuthError } from "../http/errors.js";
import { type AccountStore, relayDeleteCommand, type WorkspaceDataStore } from "./store.js";
import type {
  AccountErasureReport,
  AccountSnapshot,
  AccountWorkspace,
  ErasureCounts,
  ErasureStore,
  ErasureStoreReport,
  OrganizationErasure,
  WorkspaceErasure,
} from "./types.js";

/**
 * The account erase, in the order that makes a retry converge.
 *
 * ## The order
 *
 * 1. Read the snapshot once. It decides which organizations are the account's to
 *    delete (the ones where it is the only member) and therefore which workspaces go
 *    with them. Nothing is written yet.
 * 2. Delete the relay-owned data for those workspaces: the document and its
 *    projections, the share rows and baselines, the attachment rows and bytes. Those
 *    deletes are idempotent by contract, and they are the only irreversible part.
 * 3. Delete every control-plane row in **one Postgres transaction**, organizations
 *    first, then the account's remaining member rows, then sessions and credentials,
 *    and the `user` row last.
 *
 * ## Why that order converges
 *
 * The two halves fail differently, so the order is chosen for the failure. Anything
 * that fails in step 2 leaves step 3 untouched: the account still exists, still signs
 * in, and still owns everything it did before, so the caller can call the same route
 * again and the idempotent relay deletes finish the job. Anything that fails in step 3
 * rolls back as a whole, because it is one transaction, so the account is equally
 * intact. A retry recomputes the same plan from the same rows.
 *
 * The `user` row goes last for the same reason. It is the row that authenticates the
 * retry, so deleting it before the rest would strand the account in the one state this
 * ordering exists to prevent: no way in, and rows still there.
 *
 * ## Why the account is never usable and half-deleted
 *
 * Every control-plane row leaves in one transaction, so the account is either whole or
 * absent, never whole with some of its rows gone. The relay half is the one part that
 * cannot join that transaction, which is why it runs first and why its outcome is
 * reported per store instead of assumed.
 */

export interface AccountEraseDeps {
  accounts: AccountStore;
  /** The relay's per-workspace stores, or null when the deployment did not wire one. */
  workspaceData: WorkspaceDataStore | null;
  now?: () => number;
}

const RELAY_STORES = ["documents", "shares", "attachments"] as const;

const CONTROL_PLANE_STORES: readonly { store: ErasureStore; count: keyof ErasureCounts }[] = [
  { store: "organizations", count: "organizations" },
  { store: "members", count: "members" },
  { store: "workspaces", count: "workspaces" },
  { store: "invitations", count: "invitations" },
  { store: "invites", count: "invites" },
  { store: "licences", count: "licences" },
  { store: "subscriptions", count: "subscriptions" },
  { store: "sessions", count: "sessions" },
  { store: "accounts", count: "accounts" },
  { store: "verifications", count: "verifications" },
  { store: "passkeys", count: "passkeys" },
  { store: "twoFactor", count: "twoFactor" },
  { store: "users", count: "users" },
];

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function controlPlaneReports(
  build: (store: ErasureStore) => ErasureStoreReport,
): ErasureStoreReport[] {
  return CONTROL_PLANE_STORES.map((entry) => build(entry.store));
}

interface Orphaned {
  organizations: readonly string[];
  workspaces: readonly AccountWorkspace[];
}

/**
 * What goes with the account: organizations it is the only member of, and the
 * workspaces those organizations own.
 *
 * An organization with another member is left alone, and so are its workspaces: they
 * belong to that person, and their data is not the caller's to delete. The caller's own
 * `member` row there is deleted, which is the part that is theirs.
 */
function orphansOf(snapshot: AccountSnapshot): Orphaned {
  const organizations = snapshot.organizations.filter((org) => org.otherMembers === 0);
  const ids = new Set(organizations.map((org) => org.organizationId));
  return {
    organizations: organizations.map((org) => org.organizationId),
    workspaces: snapshot.workspaces.filter(
      (workspace) => workspace.organizationId !== null && ids.has(workspace.organizationId),
    ),
  };
}

function retainedOrganization(organizationId: string): OrganizationErasure {
  return {
    organizationId,
    outcome: "retained",
    reason: "another member still holds a seat here; only this account's member row is removed",
  };
}

export async function eraseAccount(
  input: { userId: string },
  deps: AccountEraseDeps,
): Promise<AccountErasureReport> {
  const at = (deps.now ?? Date.now)();
  const snapshot = await deps.accounts.read(input.userId);
  if (snapshot === null) {
    throw new AuthError("unauthorized", "the account no longer exists");
  }

  const orphaned = orphansOf(snapshot);
  const doomed = new Set(orphaned.organizations);
  const organizations: OrganizationErasure[] = snapshot.organizations.map((organization) =>
    doomed.has(organization.organizationId)
      ? { organizationId: organization.organizationId, outcome: "removed" }
      : retainedOrganization(organization.organizationId),
  );

  const workspaces: WorkspaceErasure[] = snapshot.workspaces.map((workspace) =>
    workspace.organizationId !== null && doomed.has(workspace.organizationId)
      ? {
          workspaceId: workspace.workspaceId,
          organizationId: workspace.organizationId,
          outcome: "removed",
        }
      : {
          workspaceId: workspace.workspaceId,
          organizationId: workspace.organizationId,
          outcome: "retained",
          reason: "the workspace belongs to an organization another member still uses",
        },
  );
  const workspaceOf = (workspaceId: string): WorkspaceErasure | undefined =>
    workspaces.find((entry) => entry.workspaceId === workspaceId);
  const followUp =
    orphaned.workspaces[0] === undefined
      ? undefined
      : relayDeleteCommand(orphaned.workspaces[0].workspaceId);

  // ---------------------------------------------------------------- relay half

  const relay = new Map<ErasureStore, ErasureStoreReport>();
  /** The workspaces whose relay data this call removed, so a later failure cannot
   * mark one of them as never attempted. */
  const erased = new Set<string>();
  let relayFailure: string | null = null;

  if (deps.workspaceData === null) {
    // No port is not the same as a failed port. The account erase still runs, because
    // refusing to close an account over a store this deployment never had would leave
    // every self-hoster unable to use the route; the three stores say they were not
    // configured and name the command that finishes them.
    const reason = "no relay store is wired into this deployment";
    for (const store of RELAY_STORES) {
      relay.set(store, {
        store,
        status: "not-configured",
        removed: 0,
        reason,
        ...(followUp === undefined ? {} : { followUp }),
      });
    }
    for (const workspace of orphaned.workspaces) {
      const entry = workspaceOf(workspace.workspaceId);
      if (entry !== undefined) {
        entry.outcome = "not-removed";
        entry.reason = reason;
        if (followUp !== undefined) entry.followUp = followUp;
      }
    }
  } else {
    const store = deps.workspaceData;
    const totals = { documents: 0, shares: 0, attachments: 0 };
    for (const workspace of orphaned.workspaces) {
      const entry = workspaceOf(workspace.workspaceId);
      try {
        const counts = await store.erase(workspace.workspaceId);
        totals.documents += counts.documents;
        totals.shares += counts.shares;
        totals.attachments += counts.attachments;
        erased.add(workspace.workspaceId);
      } catch (error) {
        relayFailure = `the relay refused to erase ${workspace.workspaceId}: ${messageOf(error)}`;
        if (entry !== undefined) {
          entry.outcome = "not-removed";
          entry.reason = relayFailure;
        }
        break;
      }
    }
    for (const name of RELAY_STORES) {
      relay.set(
        name,
        relayFailure === null
          ? { store: name, status: "removed", removed: totals[name] }
          : {
              store: name,
              status: "not-removed",
              removed: totals[name],
              reason: relayFailure,
              ...(followUp === undefined ? {} : { followUp }),
            },
      );
    }
  }

  if (relayFailure !== null) {
    // Stop before Postgres. The account stays whole and can be deleted again, which is
    // only true while all of its rows are still there.
    const reason = `${relayFailure}, so the control-plane transaction never ran`;
    for (const entry of workspaces) {
      if (entry.outcome === "removed" && !erased.has(entry.workspaceId)) {
        entry.outcome = "not-attempted";
        entry.reason = "the relay delete failed before this workspace was reached";
      }
    }
    return {
      ok: true,
      deleted: false,
      complete: false,
      userId: input.userId,
      completedAt: at,
      organizations: organizations.map((entry) => ({ ...entry, outcome: "not-attempted", reason })),
      workspaces,
      stores: [
        ...controlPlaneReports((name) => ({
          store: name,
          status: "not-attempted",
          removed: 0,
          reason,
        })),
        ...RELAY_STORES.map((name) => relay.get(name) as ErasureStoreReport),
      ],
      retry:
        "call DELETE /api/account again with the same confirmation: the relay deletes already applied are idempotent, and the account itself was not touched",
    };
  }

  // ---------------------------------------------------------- control-plane half

  let counts: ErasureCounts;
  try {
    counts = await deps.accounts.erase({
      userId: input.userId,
      organizations: orphaned.organizations,
      workspaces: orphaned.workspaces.map((workspace) => workspace.workspaceId),
      email: snapshot.profile.email,
    });
  } catch (error) {
    const reason = `the control-plane transaction rolled back: ${messageOf(error)}`;
    return {
      ok: true,
      deleted: false,
      complete: false,
      userId: input.userId,
      completedAt: at,
      organizations: organizations.map((entry) => ({ ...entry, outcome: "not-attempted", reason })),
      workspaces: workspaces.map((entry) =>
        entry.outcome === "removed"
          ? {
              ...entry,
              outcome: "not-removed",
              reason: "its document and share rows are gone; the control-plane row was not removed",
            }
          : entry,
      ),
      stores: [
        ...controlPlaneReports((name) => ({
          store: name,
          status: "not-attempted",
          removed: 0,
          reason,
        })),
        ...RELAY_STORES.map((name) => relay.get(name) as ErasureStoreReport),
      ],
      retry:
        "call DELETE /api/account again with the same confirmation: the transaction rolled back, so nothing is half-deleted and every step repeats",
    };
  }

  const stores: ErasureStoreReport[] = [
    ...CONTROL_PLANE_STORES.map((entry) => ({
      store: entry.store,
      status: "removed" as const,
      removed: counts[entry.count],
    })),
    ...RELAY_STORES.map((name) => relay.get(name) as ErasureStoreReport),
  ];
  const complete = stores.every((entry) => entry.status === "removed");

  return {
    ok: true,
    deleted: counts.users > 0,
    complete,
    userId: input.userId,
    completedAt: at,
    organizations,
    workspaces,
    stores,
    retry: complete
      ? "nothing: every store the account owned reported what it removed"
      : "the account row is gone; a store reported above as not configured is finished by an operator with the relay's own workspace delete",
  };
}
