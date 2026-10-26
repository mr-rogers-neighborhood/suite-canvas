import type { LicenceStore, MembershipReader } from "./licences.js";
import type { MemberRecord, OrganizationRole, SeatLicence, WorkspaceRecord } from "./types.js";
import type { WorkspaceRepository } from "./workspaces.js";

/**
 * The in-memory control plane.
 *
 * Two jobs, both real. It is the test double that lets the rules be asserted
 * without Postgres, and it is what the service falls back to in development so
 * a contributor can click through the routes without a database. It is *not*
 * a production backend, and the SQL in `sql/0001_control_plane.sql` is the
 * production contract: the comments below name the statement each method
 * mirrors, so the two cannot quietly disagree about atomicity.
 *
 * Atomicity here comes from the event loop: the mutating methods contain no
 * `await`, so no other request can interleave between the conditional check and
 * the write. That is exactly the guarantee `FOR UPDATE` / conditional `UPDATE`
 * gives Postgres, and it is why the conditional form is used even in memory —
 * a test that passes because the fake used a mutex proves nothing about the SQL.
 */

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  members: MemberRecord[];
}

interface WorkspaceRow {
  id: string;
  organizationId: string | null;
  name: string | null;
  createdAt: number;
  archivedAt: number | null;
}

export interface MemoryControlPlane {
  workspaces: WorkspaceRepository;
  licences: LicenceStore;
  memberships: MembershipReader;
  /** Seeds an organization with its members (owner included); returns its id. */
  addOrganization: (input: {
    name?: string;
    slug?: string;
    id?: string;
    members?: readonly { userId: string; role: OrganizationRole }[];
  }) => string;
  addMember: (organizationId: string, userId: string, role: OrganizationRole) => MemberRecord;
  /** Seeds a workspace row; used to model a workspace that exists before it is claimed. */
  addWorkspace: (input: {
    id: string;
    organizationId?: string | null;
    name?: string | null;
    createdAt?: number;
  }) => void;
  recordLicence: (organizationId: string, licence: SeatLicence) => void;
  /** Raw `member` rows, for assertions about writes a route must not make. */
  memberRows: () => readonly MemberRecord[];
  workspaceRow: (workspaceId: string) => WorkspaceRow | null;
}

function toWorkspace(
  row: WorkspaceRow,
  organization: OrganizationRow | undefined,
): WorkspaceRecord {
  return {
    organizationId: row.organizationId,
    workspaceId: row.id,
    name: row.name ?? row.id,
    createdAt: row.createdAt,
    members: organization?.members ?? [],
  };
}

export function memoryControlPlane(): MemoryControlPlane {
  const organizations = new Map<string, OrganizationRow>();
  const workspaces = new Map<string, WorkspaceRow>();
  const licences = new Map<string, SeatLicence>();
  let sequence = 0;

  const memberRow = (
    organizationId: string,
    userId: string,
    role: OrganizationRole,
    now: number,
  ): MemberRecord => ({
    id: `member-${++sequence}`,
    organizationId,
    userId,
    role,
    createdAt: now,
  });

  const publicWorkspace = (row: WorkspaceRow): WorkspaceRecord =>
    toWorkspace(
      row,
      row.organizationId === null ? undefined : organizations.get(row.organizationId),
    );

  return {
    addOrganization: (input) => {
      const id = input.id ?? `org-${++sequence}`;
      organizations.set(id, {
        id,
        name: input.name ?? id,
        slug: input.slug ?? id,
        members: (input.members ?? []).map((member) =>
          memberRow(id, member.userId, member.role, 0),
        ),
      });
      return id;
    },

    addMember: (organizationId, userId, role) => {
      const organization = organizations.get(organizationId);
      if (organization === undefined) throw new Error(`no organization ${organizationId}`);
      const member = memberRow(organizationId, userId, role, 0);
      organization.members.push(member);
      return member;
    },

    addWorkspace: (input) => {
      workspaces.set(input.id, {
        id: input.id,
        organizationId: input.organizationId ?? null,
        name: input.name ?? null,
        createdAt: input.createdAt ?? 0,
        archivedAt: null,
      });
    },

    recordLicence: (organizationId, licence) => {
      licences.set(organizationId, licence);
    },

    memberRows: () => [...organizations.values()].flatMap((organization) => organization.members),
    workspaceRow: (workspaceId) => workspaces.get(workspaceId) ?? null,

    workspaces: {
      find: async (workspaceId) => {
        const row = workspaces.get(workspaceId);
        return row === undefined ? null : publicWorkspace(row);
      },

      // Mirrors CLAIM_WORKSPACE_SQL: the write only fires when the row is
      // unowned. An owned row returns null, which `claimWorkspace` reports as
      // `workspace-already-claimed` rather than as a silent success.
      claim: async ({ workspaceId, organizationId, name, now }) => {
        const row = workspaces.get(workspaceId);
        if (row === undefined) {
          workspaces.set(workspaceId, {
            id: workspaceId,
            organizationId,
            name,
            createdAt: now,
            archivedAt: null,
          });
          return publicWorkspace(workspaces.get(workspaceId) as WorkspaceRow);
        }
        if (row.organizationId !== null) return null;
        row.organizationId = organizationId;
        if (row.name === null) row.name = name;
        return publicWorkspace(row);
      },

      countForOrganization: async (organizationId) =>
        [...workspaces.values()].filter(
          (row) => row.organizationId === organizationId && row.archivedAt === null,
        ).length,
    },

    licences: {
      forOrganization: async (organizationId) => licences.get(organizationId) ?? null,
    },

    memberships: {
      countForOrganization: async (organizationId) =>
        organizations.get(organizationId)?.members.length ?? 0,
      countForUser: async (userId) =>
        [...organizations.values()].filter((organization) =>
          organization.members.some((member) => member.userId === userId),
        ).length,
      roleFor: async (organizationId, userId) =>
        organizations.get(organizationId)?.members.find((member) => member.userId === userId)
          ?.role ?? null,
      listForOrganization: async (organizationId) => [
        ...(organizations.get(organizationId)?.members ?? []),
      ],
    },
  };
}
