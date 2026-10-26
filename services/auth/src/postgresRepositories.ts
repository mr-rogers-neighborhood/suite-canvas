import type { LicenceStore, MembershipReader } from "./licences.js";
import type { Queryable } from "./postgres.js";
import type { MemberRecord, OrganizationRole, SeatLicence, WorkspaceRecord } from "./types.js";
import {
  CLAIM_WORKSPACE_SQL,
  COUNT_ORGANIZATION_WORKSPACES_SQL,
  FIND_WORKSPACE_SQL,
  type WorkspaceRepository,
} from "./workspaces.js";

/**
 * The control plane, for real
 * ([ADR-0070](../../../docs/decisions/0070-one-postgres-control-plane.md) §1, §4).
 *
 * Three repositories, one pool, SQL beside the interface each implements. No ORM: the
 * schema is checked in and small, and every statement here is one that a person can
 * read in a code review and run in `psql`.
 *
 * Two habits run through the module, both learned from the bugs the memory stores
 * could not have:
 *
 * - **Nothing reads before it writes.** A claim is an `INSERT … ON CONFLICT` whose
 *   `RETURNING` decides the outcome, because two requests land in different processes.
 * - **Timestamps are epoch milliseconds at the seam and `Date` nowhere else.** The app
 *   stores millis everywhere; `pg` hands a `timestamptz` back as a `Date`, so the
 *   boundary converts once, here, in both directions.
 */

/** Postgres may hand a bigint back as a string; the app wants a number. */
function millis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`control plane holds a non-numeric time: ${value}`);
  return parsed;
}

/**
 * A `bigint` byte ceiling as a number, or `null` when the column is NULL.
 *
 * Separate from `millis` because the two mean different things: a NULL ceiling is
 * "this row never recorded one" (it predates `0004`, or a writer did not project
 * it), which is not an error and must not become zero.
 */
function ceiling(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const ROLE = new Set<OrganizationRole>(["owner", "admin", "member"]);

function role(value: unknown): OrganizationRole | null {
  return typeof value === "string" && ROLE.has(value as OrganizationRole)
    ? (value as OrganizationRole)
    : null;
}

// ---------------------------------------------------------------- memberships

const COUNT_MEMBERS_SQL = `SELECT count(*)::int AS count FROM member WHERE "organizationId" = $1`;
const COUNT_ORGS_SQL = `SELECT count(*)::int AS count FROM member WHERE "userId" = $1`;
const ROLE_SQL = `
  SELECT role FROM member WHERE "organizationId" = $1 AND "userId" = $2 LIMIT 1
`;
const LIST_MEMBERS_SQL = `
  SELECT id, "organizationId", "userId", role, "createdAt"
  FROM member
  WHERE "organizationId" = $1
  ORDER BY "createdAt" ASC, id ASC
`;

export function postgresMemberships(client: Queryable): MembershipReader {
  return {
    async countForOrganization(organizationId) {
      const { rows } = await client.query(COUNT_MEMBERS_SQL, [organizationId]);
      return millis((rows[0] as { count?: unknown } | undefined)?.count ?? 0);
    },
    async countForUser(userId) {
      const { rows } = await client.query(COUNT_ORGS_SQL, [userId]);
      return millis((rows[0] as { count?: unknown } | undefined)?.count ?? 0);
    },
    async roleFor(organizationId, userId) {
      const { rows } = await client.query(ROLE_SQL, [organizationId, userId]);
      // A role we do not recognise is treated as no role: fail closed rather than
      // hand a capability to a string someone typed into the table.
      return role((rows[0] as { role?: unknown } | undefined)?.role);
    },
    async listForOrganization(organizationId) {
      const { rows } = await client.query(LIST_MEMBERS_SQL, [organizationId]);
      return (rows as Array<Record<string, unknown>>).flatMap((row) => {
        const parsed = role(row.role);
        if (parsed === null) return [];
        return [
          {
            id: String(row.id),
            organizationId: String(row.organizationId),
            userId: String(row.userId),
            role: parsed,
            createdAt: millis(row.createdAt),
          } satisfies MemberRecord,
        ];
      });
    },
  };
}

// ------------------------------------------------------------------- licences

const LICENCE_SQL = `
  SELECT licence_id, tier, workspaces, seats, document_bytes, attachment_bytes, expires_at
  FROM organization_licences
  WHERE organization_id = $1
`;

export function postgresLicences(client: Queryable): LicenceStore {
  return {
    async forOrganization(organizationId) {
      const { rows } = await client.query(LICENCE_SQL, [organizationId]);
      const row = rows[0] as Record<string, unknown> | undefined;
      // No row means no licence — which the seat check already treats as "fail
      // closed for an owned workspace", so returning null is the honest answer
      // rather than a permissive default.
      if (row === undefined) return null;
      const documentBytes = ceiling(row.document_bytes);
      const attachmentBytes = ceiling(row.attachment_bytes);
      const licence: SeatLicence = {
        claims: {
          v: 1,
          id: String(row.licence_id),
          tier: String(row.tier),
          workspaces: millis(row.workspaces),
          // The signed ceilings, projected by `0004_licence_limits.sql`. A NULL is a
          // row written before those columns existed, and `LicenceClaims` has no
          // "unknown": it becomes the "this layer imposes no byte ceiling" value,
          // because the relay enforces the real cap from the token it verified and
          // nothing in `@suite/auth` reads either field.
          documentBytes: documentBytes ?? Number.POSITIVE_INFINITY,
          attachmentBytes: attachmentBytes ?? Number.POSITIVE_INFINITY,
          // The row records when the licence was *received* (`recorded_at`), not when
          // it was signed, so there is no honest issue time to report here.
          issuedAt: 0,
          expiresAt: millis(row.expires_at),
        },
        seats: millis(row.seats),
      };
      return licence;
    },
  };
}

// ----------------------------------------------------------------- workspaces

interface WorkspaceRow {
  id: string;
  organization_id: string | null;
  name: string | null;
  created_at: unknown;
}

export function postgresWorkspaces(
  client: Queryable,
  memberships: MembershipReader,
): WorkspaceRepository {
  const toRecord = async (row: WorkspaceRow): Promise<WorkspaceRecord> => ({
    workspaceId: row.id,
    organizationId: row.organization_id,
    // A row with no name predates naming; the id is the only honest fallback.
    name: row.name ?? row.id,
    createdAt: millis(row.created_at),
    members:
      row.organization_id === null
        ? []
        : await memberships.listForOrganization(row.organization_id),
  });

  return {
    async find(workspaceId) {
      const { rows } = await client.query(FIND_WORKSPACE_SQL, [workspaceId]);
      const row = rows[0] as WorkspaceRow | undefined;
      return row === undefined ? null : toRecord(row);
    },

    async claim({ workspaceId, organizationId, name, now }) {
      // Every statement comes from `workspaces.ts` rather than being rewritten here:
      // its conflict clause *is* the claim promise, and two copies would drift. Note
      // that `find` does not filter archived rows — claiming is about ownership, not
      // resurrection, and hiding an archived row would turn "already claimed by
      // another organization" into a silent attempt to claim it.
      //
      // `now` is epoch milliseconds and `created_at` is a `timestamptz`, so the
      // conversion happens here: bound as a bare number, Postgres reads it as a
      // timestamp literal and refuses the statement ("date/time field value out of
      // range"), which is how the claim was broken against a real database.
      const { rows } = await client.query(CLAIM_WORKSPACE_SQL, [
        workspaceId,
        organizationId,
        name,
        new Date(now),
      ]);
      const row = rows[0] as WorkspaceRow | undefined;
      return row === undefined ? null : toRecord(row);
    },

    async countForOrganization(organizationId) {
      const { rows } = await client.query(COUNT_ORGANIZATION_WORKSPACES_SQL, [organizationId]);
      return millis((rows[0] as { count?: unknown } | undefined)?.count ?? 0);
    },
  };
}

/** All three, over one pool: what a deployment actually injects. */
export function postgresRepositories(client: Queryable): {
  memberships: MembershipReader;
  licences: LicenceStore;
  workspaces: WorkspaceRepository;
} {
  const memberships = postgresMemberships(client);
  return {
    memberships,
    licences: postgresLicences(client),
    workspaces: postgresWorkspaces(client, memberships),
  };
}
