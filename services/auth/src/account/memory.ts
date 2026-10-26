import type { OrganizationRole } from "../types.js";
import type { AccountStore, WorkspaceDataStore } from "./store.js";
import type {
  AccountShare,
  AccountSnapshot,
  AccountWorkspace,
  ErasureCounts,
  ErasurePlan,
  WorkspaceDataErasure,
} from "./types.js";

/**
 * The account store in process.
 *
 * It is the double the route tests run against, and the development backend when no
 * database is configured, the same pair `memoryControlPlane` serves. The erase here
 * obeys the contract the Postgres one has: it applies as a whole or throws with nothing
 * changed, and it re-checks the plan against the rows it currently holds. A fake that
 * deleted first and validated later would let a route test pass that the SQL would
 * fail, which is the failure this double exists to avoid.
 */

interface UserRow {
  id: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  createdAt: number;
  admittedAt: number | null;
}

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  createdAt: number;
}

interface MemberRow {
  id: string;
  organizationId: string;
  userId: string;
  role: OrganizationRole;
  createdAt: number;
}

interface WorkspaceRow {
  id: string;
  organizationId: string | null;
  name: string;
  createdAt: number;
  archivedAt: number | null;
}

interface ShareRow extends AccountShare {
  workspaceId: string;
}

interface OwnedRow {
  id: string;
  userId: string;
  referenceId?: string;
}

/** A relay failure a test asks for, and how far the store got before it hit. */
export interface WorkspaceEraseFailure {
  workspaceId: string;
  /** `documents` models the partial case: the bytes are gone, the rest is not. */
  after: "nothing" | "documents";
  reason: string;
}

export interface MemoryAccountStore extends AccountStore {
  /** The relay half, kept separate because `erase` means two different things. */
  workspaceData: WorkspaceDataStore;
  addUser: (input: Partial<Omit<UserRow, "id">> & { id: string }) => void;
  addOrganization: (input: {
    id: string;
    name?: string;
    slug?: string;
    createdAt?: number;
  }) => void;
  addMember: (
    organizationId: string,
    userId: string,
    role: OrganizationRole,
    joinedAt?: number,
  ) => void;
  addWorkspace: (input: {
    id: string;
    organizationId: string | null;
    name?: string;
    createdAt?: number;
    archivedAt?: number | null;
  }) => void;
  addShare: (workspaceId: string, input: Partial<AccountShare> & { shareId: string }) => void;
  /** A session, a credential, a passkey or a second factor, for the per-store counts. */
  addSession: (userId: string) => void;
  addCredential: (userId: string) => void;
  addPasskey: (userId: string) => void;
  addSecondFactor: (userId: string) => void;
  addInvitation: (organizationId: string, inviterId: string) => void;
  /** An enrollment `invite` row, as the plugin writes one. */
  addInvite: (organizationId: string, createdByUserId: string) => void;
  /** A magic-link or address-verification row, keyed by the address it names. */
  addVerification: (identifier: string) => void;
  addLicence: (organizationId: string) => void;
  addSubscription: (referenceId: string) => void;
  addAttachment: (workspaceId: string) => void;
  /** Makes the next control-plane transaction throw with nothing changed. */
  failErase: (reason: string) => void;
  /** Makes one workspace's relay erase throw at the named point. */
  failWorkspaceErase: (failure: WorkspaceEraseFailure) => void;
  /** Every workspace the relay port was asked to erase, in order. */
  erasedWorkspaces: () => readonly string[];
  /** The rows that survived, for the assertions a route test cannot make. */
  rows: () => {
    users: readonly string[];
    organizations: readonly string[];
    members: readonly MemberRow[];
    workspaces: readonly AccountWorkspace[];
    sessions: readonly string[];
    credentials: readonly string[];
    passkeys: readonly string[];
    secondFactors: readonly string[];
    invitations: readonly string[];
    invites: readonly string[];
    verifications: readonly string[];
    licences: readonly string[];
    subscriptions: readonly string[];
    shares: readonly ShareRow[];
    attachments: readonly string[];
    documents: readonly string[];
  };
}

function sequenceOf(prefix: string): () => string {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

export function memoryAccountStore(): MemoryAccountStore {
  const users = new Map<string, UserRow>();
  const organizations = new Map<string, OrganizationRow>();
  const members: MemberRow[] = [];
  const workspaces = new Map<string, WorkspaceRow>();
  const shares: ShareRow[] = [];
  const sessions: OwnedRow[] = [];
  const credentials: OwnedRow[] = [];
  const passkeys: OwnedRow[] = [];
  const secondFactors: OwnedRow[] = [];
  const invitations: OwnedRow[] = [];
  const invites: OwnedRow[] = [];
  const verifications: OwnedRow[] = [];
  const licences: OwnedRow[] = [];
  const subscriptions: OwnedRow[] = [];
  const attachments: string[] = [];
  const documents = new Set<string>();
  const erased: string[] = [];

  let eraseFailure: string | null = null;
  let workspaceFailure: WorkspaceEraseFailure | null = null;

  const memberId = sequenceOf("member");
  const sessionId = sequenceOf("session");
  const credentialId = sequenceOf("account");
  const passkeyId = sequenceOf("passkey");
  const secondFactorId = sequenceOf("twoFactor");
  const invitationId = sequenceOf("invitation");
  const inviteId = sequenceOf("invite");
  const verificationId = sequenceOf("verification");
  const subscriptionId = sequenceOf("subscription");

  const membersOf = (organizationId: string): MemberRow[] =>
    members.filter((member) => member.organizationId === organizationId);

  return {
    addUser: (input) => {
      users.set(input.id, {
        id: input.id,
        email: input.email ?? `${input.id}@example.com`,
        name: input.name ?? null,
        emailVerified: input.emailVerified ?? true,
        twoFactorEnabled: input.twoFactorEnabled ?? false,
        createdAt: input.createdAt ?? 1,
        admittedAt: input.admittedAt ?? 1,
      });
    },
    addOrganization: (input) => {
      organizations.set(input.id, {
        id: input.id,
        name: input.name ?? input.id,
        slug: input.slug ?? input.id,
        createdAt: input.createdAt ?? 1,
      });
    },
    addMember: (organizationId, userId, role, joinedAt = 1) => {
      members.push({ id: memberId(), organizationId, userId, role, createdAt: joinedAt });
    },
    addWorkspace: (input) => {
      workspaces.set(input.id, {
        id: input.id,
        organizationId: input.organizationId,
        name: input.name ?? input.id,
        createdAt: input.createdAt ?? 1,
        archivedAt: input.archivedAt ?? null,
      });
      documents.add(input.id);
    },
    addShare: (workspaceId, input) => {
      shares.push({
        shareId: input.shareId,
        workspaceId,
        scope: input.scope ?? "workspace",
        role: input.role ?? "viewer",
        createdAt: input.createdAt ?? 1,
        expiresAt: input.expiresAt ?? null,
        revokedAt: input.revokedAt ?? null,
      });
    },
    addSession: (userId) => {
      sessions.push({ id: sessionId(), userId });
    },
    addCredential: (userId) => {
      credentials.push({ id: credentialId(), userId });
    },
    addPasskey: (userId) => {
      passkeys.push({ id: passkeyId(), userId });
    },
    addSecondFactor: (userId) => {
      secondFactors.push({ id: secondFactorId(), userId });
    },
    addInvitation: (organizationId, inviterId) => {
      invitations.push({ id: invitationId(), userId: inviterId, referenceId: organizationId });
    },
    addInvite: (organizationId, createdByUserId) => {
      invites.push({ id: inviteId(), userId: createdByUserId, referenceId: organizationId });
    },
    addVerification: (identifier) => {
      verifications.push({ id: verificationId(), userId: "", referenceId: identifier });
    },
    addLicence: (organizationId) => {
      licences.push({ id: organizationId, userId: "", referenceId: organizationId });
    },
    addSubscription: (referenceId) => {
      subscriptions.push({ id: subscriptionId(), userId: "", referenceId });
    },
    addAttachment: (workspaceId) => {
      attachments.push(workspaceId);
    },

    failErase: (reason) => {
      eraseFailure = reason;
    },
    failWorkspaceErase: (failure) => {
      workspaceFailure = failure;
    },

    erasedWorkspaces: () => [...erased],

    read: async (userId): Promise<AccountSnapshot | null> => {
      const user = users.get(userId);
      if (user === undefined) return null;
      const memberships = members.filter((member) => member.userId === userId);
      const organizationIds = new Set(memberships.map((member) => member.organizationId));
      return {
        profile: {
          userId: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
          twoFactorEnabled: user.twoFactorEnabled,
          createdAt: user.createdAt,
          admittedAt: user.admittedAt,
        },
        organizations: memberships.flatMap((member) => {
          const organization = organizations.get(member.organizationId);
          if (organization === undefined) return [];
          return [
            {
              organizationId: organization.id,
              name: organization.name,
              slug: organization.slug,
              createdAt: organization.createdAt,
              role: member.role,
              joinedAt: member.createdAt,
              otherMembers: membersOf(organization.id).filter((row) => row.userId !== userId)
                .length,
            },
          ];
        }),
        workspaces: [...workspaces.values()]
          .filter(
            (workspace) =>
              workspace.organizationId !== null && organizationIds.has(workspace.organizationId),
          )
          .map((workspace) => ({
            workspaceId: workspace.id,
            organizationId: workspace.organizationId,
            name: workspace.name,
            createdAt: workspace.createdAt,
            archivedAt: workspace.archivedAt,
          })),
      };
    },

    erase: async (plan: ErasurePlan): Promise<ErasureCounts> => {
      if (eraseFailure !== null) {
        const reason = eraseFailure;
        eraseFailure = null;
        throw new Error(reason);
      }
      // The same re-check the SQL does inside its transaction: an organization is only
      // deleted while this account is its only member.
      const doomed = new Set(
        plan.organizations.filter(
          (organizationId) =>
            membersOf(organizationId).length === 1 &&
            membersOf(organizationId)[0]?.userId === plan.userId,
        ),
      );
      const counts: ErasureCounts = {
        organizations: 0,
        members: 0,
        workspaces: 0,
        invitations: 0,
        invites: 0,
        licences: 0,
        subscriptions: 0,
        sessions: 0,
        accounts: 0,
        verifications: 0,
        passkeys: 0,
        twoFactor: 0,
        users: 0,
      };
      const removeWhere = <Row extends OwnedRow>(
        rows: Row[],
        predicate: (row: Row) => boolean,
      ): number => {
        let removed = 0;
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          const row = rows[index];
          if (row === undefined || !predicate(row)) continue;
          rows.splice(index, 1);
          removed += 1;
        }
        return removed;
      };
      const doomedWorkspaces = [...workspaces.values()].filter(
        (workspace) => workspace.organizationId !== null && doomed.has(workspace.organizationId),
      );

      for (const workspace of doomedWorkspaces) {
        workspaces.delete(workspace.id);
        counts.workspaces += 1;
        for (let index = shares.length - 1; index >= 0; index -= 1) {
          if (shares[index]?.workspaceId === workspace.id) shares.splice(index, 1);
        }
        for (let index = attachments.length - 1; index >= 0; index -= 1) {
          if (attachments[index] === workspace.id) attachments.splice(index, 1);
        }
      }
      counts.invites = removeWhere(
        invites,
        (row) => doomed.has(row.referenceId ?? "") || row.userId === plan.userId,
      );
      counts.licences = removeWhere(licences, (row) => doomed.has(row.referenceId ?? ""));
      counts.subscriptions = removeWhere(subscriptions, (row) => doomed.has(row.referenceId ?? ""));
      counts.invitations = removeWhere(invitations, (row) => doomed.has(row.referenceId ?? ""));
      counts.members = removeWhere(members, (row) => doomed.has(row.organizationId));
      for (const organizationId of doomed) {
        if (organizations.delete(organizationId)) counts.organizations += 1;
      }
      counts.members += removeWhere(members, (row) => row.userId === plan.userId);
      counts.invitations += removeWhere(invitations, (row) => row.userId === plan.userId);
      counts.sessions = removeWhere(sessions, (row) => row.userId === plan.userId);
      counts.accounts = removeWhere(credentials, (row) => row.userId === plan.userId);
      if (plan.email !== null) {
        counts.verifications = removeWhere(verifications, (row) => row.referenceId === plan.email);
      }
      counts.passkeys = removeWhere(passkeys, (row) => row.userId === plan.userId);
      counts.twoFactor = removeWhere(secondFactors, (row) => row.userId === plan.userId);
      if (users.delete(plan.userId)) counts.users = 1;
      return counts;
    },

    workspaceData: {
      shares: async (workspaceId) =>
        shares
          .filter((share) => share.workspaceId === workspaceId)
          .map((share) => ({
            shareId: share.shareId,
            scope: share.scope,
            role: share.role,
            createdAt: share.createdAt,
            expiresAt: share.expiresAt,
            revokedAt: share.revokedAt,
          })),

      erase: async (workspaceId): Promise<WorkspaceDataErasure> => {
        erased.push(workspaceId);
        const failure = workspaceFailure?.workspaceId === workspaceId ? workspaceFailure : null;
        // One shot, like `failErase`: the point of the second call is that it succeeds.
        if (failure !== null) workspaceFailure = null;
        if (failure !== null && failure.after === "nothing") {
          throw new Error(failure.reason);
        }
        let documentsRemoved = 0;
        if (documents.delete(workspaceId)) documentsRemoved = 1;
        if (failure !== null) {
          throw new Error(failure.reason);
        }
        let sharesRemoved = 0;
        for (let index = shares.length - 1; index >= 0; index -= 1) {
          if (shares[index]?.workspaceId === workspaceId) {
            shares.splice(index, 1);
            sharesRemoved += 1;
          }
        }
        let attachmentsRemoved = 0;
        for (let index = attachments.length - 1; index >= 0; index -= 1) {
          if (attachments[index] === workspaceId) {
            attachments.splice(index, 1);
            attachmentsRemoved += 1;
          }
        }
        return {
          documents: documentsRemoved,
          shares: sharesRemoved,
          attachments: attachmentsRemoved,
        };
      },
    },

    rows: () => ({
      users: [...users.keys()],
      organizations: [...organizations.keys()],
      members: [...members],
      workspaces: [...workspaces.values()].map((workspace) => ({
        workspaceId: workspace.id,
        organizationId: workspace.organizationId,
        name: workspace.name,
        createdAt: workspace.createdAt,
        archivedAt: workspace.archivedAt,
      })),
      sessions: sessions.map((row) => row.id),
      credentials: credentials.map((row) => row.id),
      passkeys: passkeys.map((row) => row.id),
      secondFactors: secondFactors.map((row) => row.id),
      invitations: invitations.map((row) => row.id),
      invites: invites.map((row) => row.id),
      verifications: verifications.map((row) => row.id),
      licences: licences.map((row) => row.id),
      subscriptions: subscriptions.map((row) => row.id),
      shares: [...shares],
      attachments: [...attachments],
      documents: [...documents],
    }),
  };
}
