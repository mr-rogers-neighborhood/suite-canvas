import type { Queryable, QueryConnection } from "../store/postgres.js";
import type { OrganizationRole } from "../types.js";
import type { AccountStore } from "./store.js";
import type {
  AccountOrganization,
  AccountProfile,
  AccountSnapshot,
  AccountWorkspace,
  ErasureCounts,
  ErasurePlan,
} from "./types.js";

/**
 * The account store over the control-plane Postgres.
 *
 * Two habits from `store/postgresRepositories.ts` are kept: epoch milliseconds at the
 * seam and `Date` nowhere else, and every statement readable in a review. The erase is
 * the one operation here that must be all-or-nothing, so it runs on a single checked-out
 * connection inside `BEGIN … COMMIT`; `BEGIN` on a pool would land on one connection and
 * `COMMIT` on another.
 */

/** Postgres hands `timestamptz` back as a `Date`; the app stores epoch milliseconds. */
function millis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed))
    throw new Error(`the account row holds a non-numeric time: ${value}`);
  return parsed;
}

/** A `bigint` column as a number, or null when it is NULL. */
function nullableMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return millis(value);
}

const ROLES = new Set<OrganizationRole>(["owner", "admin", "member"]);

function roleOf(value: unknown): OrganizationRole | null {
  return typeof value === "string" && ROLES.has(value as OrganizationRole)
    ? (value as OrganizationRole)
    : null;
}

function countOf(rows: readonly unknown[]): number {
  return rows.length;
}

const PROFILE_SQL = `
  SELECT id, email, name, "emailVerified", "twoFactorEnabled", "createdAt", "admittedAt"
  FROM "user"
  WHERE id = $1
`;

const ORGANIZATIONS_SQL = `
  SELECT
    o.id,
    o.name,
    o.slug,
    o."createdAt",
    m.role,
    m."createdAt" AS "joinedAt",
    (SELECT count(*)::int
       FROM member others
      WHERE others."organizationId" = o.id AND others."userId" <> $1) AS "otherMembers"
  FROM member m
  JOIN organization o ON o.id = m."organizationId"
  WHERE m."userId" = $1
  ORDER BY o."createdAt" ASC, o.id ASC
`;

const WORKSPACES_SQL = `
  SELECT w.id, w.organization_id, w.name, w.created_at, w.archived_at
  FROM workspaces w
  JOIN member m ON m."organizationId" = w.organization_id
  WHERE m."userId" = $1
  ORDER BY w.created_at ASC, w.id ASC
`;

/**
 * The organizations this account may delete, re-derived inside the transaction.
 *
 * A plan is computed from a read that another request could have raced, so the SQL
 * decides again: the account must still be a member, and it must still be the only
 * one. An organization that gained a member between the read and the write is left
 * alone, and the report says so because its row survives.
 */
const DOOMED_SQL = `
  SELECT o.id
  FROM organization o
  WHERE o.id = ANY($2::text[])
    AND EXISTS (SELECT 1 FROM member m WHERE m."organizationId" = o.id AND m."userId" = $1)
    AND (SELECT count(*) FROM member m WHERE m."organizationId" = o.id) = 1
`;

const DELETE_WORKSPACES_SQL = `DELETE FROM workspaces WHERE organization_id = ANY($1::text[]) RETURNING id`;
/**
 * The enrollment engine's invitations: the ones written for a doomed organization and
 * the ones this account sent anywhere else. `invite_keys` is retired (0005); `invite`
 * is the row that replaced it, and its `createdByUserId` is `SET NULL` on a user
 * delete, which would leave the inviter's name and address behind. So it is deleted
 * explicitly instead.
 */
const DELETE_INVITES_SQL = `DELETE FROM "invite" WHERE "organizationId" = ANY($1::text[]) OR "createdByUserId" = $2 RETURNING id`;
const DELETE_LICENCES_SQL = `DELETE FROM organization_licences WHERE organization_id = ANY($1::text[]) RETURNING organization_id`;
const DELETE_SUBSCRIPTIONS_SQL = `DELETE FROM subscription WHERE "referenceId" = ANY($1::text[]) RETURNING id`;
const DELETE_ORG_INVITATIONS_SQL = `DELETE FROM invitation WHERE "organizationId" = ANY($1::text[]) RETURNING id`;
const DELETE_ORG_MEMBERS_SQL = `DELETE FROM member WHERE "organizationId" = ANY($1::text[]) RETURNING id`;
const DELETE_ORGANIZATIONS_SQL = `DELETE FROM organization WHERE id = ANY($1::text[]) RETURNING id`;
const DELETE_MEMBERS_SQL = `DELETE FROM member WHERE "userId" = $1 RETURNING id`;
const DELETE_INVITATIONS_SQL = `DELETE FROM invitation WHERE "inviterId" = $1 RETURNING id`;
const DELETE_SESSIONS_SQL = `DELETE FROM session WHERE "userId" = $1 RETURNING id`;
const DELETE_CREDENTIALS_SQL = `DELETE FROM account WHERE "userId" = $1 RETURNING id`;
const DELETE_TWO_FACTOR_SQL = `DELETE FROM "twoFactor" WHERE "userId" = $1 RETURNING id`;
/**
 * A magic link or address-verification token names the address, not the user, so the
 * `user` row's email is the only key that reaches it. It is deleted before the user row,
 * because after that the address is gone from this database.
 */
const DELETE_VERIFICATIONS_SQL = `DELETE FROM verification WHERE identifier = $1 RETURNING id`;
const DELETE_PASSKEYS_SQL = `DELETE FROM passkey WHERE "userId" = $1 RETURNING id`;
const DELETE_USER_SQL = `DELETE FROM "user" WHERE id = $1 RETURNING id`;

/**
 * True when `connect` hands out a pooled connection, which is our adapter's meaning.
 *
 * `pg`'s own `Client` also has a `connect()`, and its job is to open the socket, not to
 * check a connection out of anything. Calling it on a client that is already connected
 * throws "Client has already been connected". `connectionParameters` is the public field
 * that tells the two apart, and it is checked here rather than trusted: a caller that
 * passes a bare client is already on one connection, so the transaction runs on it.
 */
function handsOutConnections(client: Queryable): boolean {
  if (client.connect === undefined) return false;
  return !("connectionParameters" in client);
}

/** Runs `work` on one connection inside a transaction, rolling back on any throw. */
async function transaction<T>(client: Queryable, work: (tx: Queryable) => Promise<T>): Promise<T> {
  const connection: QueryConnection = handsOutConnections(client)
    ? await (client.connect as () => Promise<QueryConnection>)()
    : client;
  try {
    await connection.query("BEGIN");
    const value = await work(connection);
    await connection.query("COMMIT");
    return value;
  } catch (error) {
    try {
      await connection.query("ROLLBACK");
    } catch {
      // The connection is being released either way; a rollback that fails cannot
      // leave a committed transaction behind, because nothing was committed.
    }
    throw error;
  } finally {
    connection.release?.();
  }
}

function profileOf(row: Record<string, unknown>): AccountProfile {
  return {
    userId: String(row.id),
    email: row.email === null || row.email === undefined ? null : String(row.email),
    name: row.name === null || row.name === undefined ? null : String(row.name),
    emailVerified: row.emailVerified === true,
    twoFactorEnabled: row.twoFactorEnabled === true,
    createdAt: millis(row.createdAt),
    admittedAt: nullableMillis(row.admittedAt),
  };
}

export function postgresAccountStore(client: Queryable): AccountStore {
  return {
    async read(userId): Promise<AccountSnapshot | null> {
      const profile = await client.query(PROFILE_SQL, [userId]);
      const user = profile.rows[0] as Record<string, unknown> | undefined;
      if (user === undefined) return null;

      const organizations = await client.query(ORGANIZATIONS_SQL, [userId]);
      const workspaces = await client.query(WORKSPACES_SQL, [userId]);

      return {
        profile: profileOf(user),
        organizations: (organizations.rows as Array<Record<string, unknown>>).flatMap((row) => {
          const role = roleOf(row.role);
          // A role this build does not know is no membership: the same fail-closed
          // read `postgresMemberships.roleFor` makes, so a hand-edited row cannot
          // grant a delete of an organization.
          if (role === null) return [];
          return [
            {
              organizationId: String(row.id),
              name: String(row.name),
              slug: String(row.slug),
              createdAt: millis(row.createdAt),
              role,
              joinedAt: millis(row.joinedAt),
              otherMembers: millis(row.otherMembers),
            } satisfies AccountOrganization,
          ];
        }),
        workspaces: (workspaces.rows as Array<Record<string, unknown>>).map((row) => ({
          workspaceId: String(row.id),
          organizationId:
            row.organization_id === null || row.organization_id === undefined
              ? null
              : String(row.organization_id),
          name: row.name === null || row.name === undefined ? String(row.id) : String(row.name),
          createdAt: millis(row.created_at),
          archivedAt: nullableMillis(row.archived_at),
        })) satisfies AccountWorkspace[],
      };
    },

    async erase(plan: ErasurePlan): Promise<ErasureCounts> {
      return transaction(client, async (tx) => {
        const doomedRows = await tx.query(DOOMED_SQL, [plan.userId, [...plan.organizations]]);
        const doomed = (doomedRows.rows as Array<Record<string, unknown>>).map((row) =>
          String(row.id),
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

        // Explicit child deletes rather than a cascade, so every number in the report
        // is a number this function saw. The order is children before parents, and the
        // `user` row is last because it is the row a retry authenticates with.
        const removed = async (sql: string, values: readonly unknown[]): Promise<number> => {
          try {
            return countOf((await tx.query(sql, values)).rows);
          } catch (error) {
            // A rolled-back transaction says "the erase failed" and nothing about
            // where. Naming the statement is the difference between a bug report and a
            // log line an operator can act on.
            throw new Error(
              `${sql.replace(/\s+/gu, " ").trim()} — ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        };

        // Every statement is given exactly the parameters it names: Postgres cannot infer
        // a type for one that appears nowhere, and refuses the whole transaction for it.
        counts.workspaces = await removed(DELETE_WORKSPACES_SQL, [doomed]);
        counts.invites = await removed(DELETE_INVITES_SQL, [doomed, plan.userId]);
        counts.licences = await removed(DELETE_LICENCES_SQL, [doomed]);
        counts.subscriptions = await removed(DELETE_SUBSCRIPTIONS_SQL, [doomed]);
        counts.invitations = await removed(DELETE_ORG_INVITATIONS_SQL, [doomed]);
        counts.members = await removed(DELETE_ORG_MEMBERS_SQL, [doomed]);
        counts.organizations = await removed(DELETE_ORGANIZATIONS_SQL, [doomed]);

        // What is left of the account in organizations another member keeps.
        counts.members += await removed(DELETE_MEMBERS_SQL, [plan.userId]);
        counts.invitations += await removed(DELETE_INVITATIONS_SQL, [plan.userId]);
        counts.sessions = await removed(DELETE_SESSIONS_SQL, [plan.userId]);
        counts.accounts = await removed(DELETE_CREDENTIALS_SQL, [plan.userId]);
        if (plan.email !== null && plan.email.length > 0) {
          counts.verifications = await removed(DELETE_VERIFICATIONS_SQL, [plan.email]);
        }
        counts.twoFactor = await removed(DELETE_TWO_FACTOR_SQL, [plan.userId]);
        counts.passkeys = await removed(DELETE_PASSKEYS_SQL, [plan.userId]);
        counts.users = await removed(DELETE_USER_SQL, [plan.userId]);

        return counts;
      });
    },
  };
}
