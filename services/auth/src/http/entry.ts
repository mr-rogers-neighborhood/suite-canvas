import { postgresAccountStore } from "../account/postgres.js";
import type { AccountStore, WorkspaceDataStore } from "../account/store.js";
import {
  type AuthDatabase,
  type AuthServiceDeps,
  createAuthService,
  sessionReader,
} from "../identity/betterAuth.js";
import { type EnrollmentRedemption, enrollmentRedemption } from "../invitations/enrollment.js";
import type { LicenceStore, MembershipReader } from "../licensing/licences.js";
import type { WorkspaceRepository } from "../organizations/workspaces.js";
import { migrateAtBoot } from "../store/migrate.js";
import { databaseUrlProblem, postgresDatabase, type Queryable } from "../store/postgres.js";
import { postgresRepositories } from "../store/postgresRepositories.js";
import type { AuthEnvironment } from "../types.js";
import { authEnabled } from "./env.js";
import type { AuthSessionReader } from "./handler.js";

/**
 * The one function a deployment calls
 * (ADR-0067 §1).
 *
 * It exists so the composition order is written once and is testable without a
 * database: environment first, then the pool, then Better Auth, then the handler.
 * Every refusal happens before the pool is built, because a broken deployment must
 * fail at start-up — a session that silently does not exist is worse than an
 * obvious outage, since the relay would read an account request as anonymous.
 *
 * The repositories stay injected. They are SQL against the same control-plane
 * database, but they are *ours*, and a service that built its own would be a
 * service that could not be tested with a memory store.
 */

/** What the deployment contributes: mail, repositories, and the two seams still landing. */
export interface AuthEntryDeps
  extends Pick<
    AuthServiceDeps,
    | "licences"
    | "memberships"
    | "sendMagicLink"
    | "sendVerificationEmail"
    | "sendInvitation"
    | "sendOrganizationInvitation"
    | "onPublicInvitation"
    | "entitlements"
    | "billingPlugin"
  > {
  /** The workspace rows the claim and members routes read. */
  workspaces: WorkspaceRepository;
  /**
   * An adapter to use instead of building a pool: the memory adapter in tests, a
   * caller-owned Kysely adapter in a deployment that shares one.
   */
  database?: AuthDatabase;
  /** Promise resolved on shutdown; absent when the caller owns the pool. */
  close?: () => Promise<void>;
  /** Slack for `onLinkAccount`. */
  transferAnonymousWorkspaces?: AuthServiceDeps["transferAnonymousWorkspaces"];
  now?: AuthServiceDeps["now"];
  /**
   * The account store, when the caller owns it. `createPostgresAuthEntry` builds one
   * over the pool it already has, so only a test or a second backend passes this.
   */
  account?: AccountStore;
  /**
   * The relay's per-workspace stores, for the account erase. Omitted, the report names
   * those three stores as not configured.
   */
  workspaceData?: WorkspaceDataStore | null;
}

export interface AuthEntry {
  /** Hand this straight to the HTTP layer: Better Auth's own `Request` handler. */
  handler: (request: Request) => Promise<Response>;
  /**
   * The redemption port `createAuthHandler` takes. It is built here because this is
   * the one place that holds both the instance and the origin its cookies are scoped
   * to; a deployment should pass this in rather than reaching into the plugin.
   */
  redeem: EnrollmentRedemption;
  /** Session lookup over the same instance, for the routes that are not Better Auth's. */
  sessions: AuthSessionReader;
  /** The repositories the account routes read, from the same pool Better Auth writes. */
  repositories: {
    licences: LicenceStore;
    memberships: MembershipReader;
    workspaces: WorkspaceRepository;
    /**
     * The account's own rows. `createAuthEntry` always sets it; a fixture that mounts
     * only the workspace routes may leave it out, and the account routes then refuse as
     * unconfigured.
     */
    account?: AccountStore | null;
    /** The relay's stores, or null when this deployment did not wire one. */
    workspaceData?: WorkspaceDataStore | null;
  };
  close: () => Promise<void>;
}

/** Optional dependencies are passed on only when the caller set them. */
function optionalDeps(
  deps: Pick<
    AuthEntryDeps,
    | "sendInvitation"
    | "onPublicInvitation"
    | "transferAnonymousWorkspaces"
    | "entitlements"
    | "billingPlugin"
    | "now"
  >,
): Partial<AuthServiceDeps> {
  return {
    ...(deps.sendInvitation === undefined ? {} : { sendInvitation: deps.sendInvitation }),
    ...(deps.onPublicInvitation === undefined
      ? {}
      : { onPublicInvitation: deps.onPublicInvitation }),
    ...(deps.transferAnonymousWorkspaces === undefined
      ? {}
      : { transferAnonymousWorkspaces: deps.transferAnonymousWorkspaces }),
    ...(deps.entitlements === undefined ? {} : { entitlements: deps.entitlements }),
    ...(deps.billingPlugin === undefined ? {} : { billingPlugin: deps.billingPlugin }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  };
}

export function createAuthEntry(env: AuthEnvironment, deps: AuthEntryDeps): AuthEntry {
  // Order matters and is the point of this function: switch, then URL, then pool.
  if (!authEnabled(env)) {
    throw new Error("SUITE_AUTH_ENABLED is not 1");
  }
  const injected = deps.database !== undefined;
  let owned: ReturnType<typeof postgresDatabase> | null = null;
  if (!injected) {
    const problem = databaseUrlProblem(env.SUITE_AUTH_DATABASE_URL);
    if (problem !== null) {
      throw new Error(`SUITE_AUTH_DATABASE_URL ${problem}`);
    }
    owned = postgresDatabase({ connectionString: env.SUITE_AUTH_DATABASE_URL?.trim() ?? "" });
  }
  const database = deps.database ?? owned?.database;
  if (database === undefined) {
    throw new Error("no database adapter was built");
  }

  // Validated here, not on first use: an invitation link is built from this origin, and
  // a wrong one would hand out links that do not resolve.
  const baseURL = new URL(env.SUITE_AUTH_URL?.trim() ?? "").origin;

  const instance = createAuthService({
    env,
    database,
    licences: deps.licences,
    memberships: deps.memberships,
    sendMagicLink: deps.sendMagicLink,
    sendVerificationEmail: deps.sendVerificationEmail,
    sendOrganizationInvitation: deps.sendOrganizationInvitation,
    ...optionalDeps(deps),
  });

  return {
    handler: (request) => instance.handler(request),
    redeem: enrollmentRedemption({ baseURL, handler: instance.handler }),
    sessions: sessionReader(instance, deps.memberships),
    repositories: {
      licences: deps.licences,
      memberships: deps.memberships,
      workspaces: deps.workspaces,
      account: deps.account ?? null,
      workspaceData: deps.workspaceData ?? null,
    },
    close: async () => {
      await deps.close?.();
      // Only close a pool this function opened.
      if (!injected) await owned?.close();
    },
  };
}

/**
 * The deployment in one call: environment → pool → repositories → Better Auth.
 *
 * This is the composition a hosted deployment actually writes, and it exists so the
 * *order* and the *shared pool* are not something each deployment reassembles by
 * hand. The repositories come from the same `Queryable` as Better Auth, which is the
 * whole point of one control plane
 * (ADR-0070): a licence
 * check and a session lookup are the same database, so they cannot disagree.
 *
 * `queryable` and `database` are for tests and for a deployment that already owns a
 * pool — the memory adapter satisfies the first and the second together. Without
 * them, the pool is built from `SUITE_AUTH_DATABASE_URL` and closed on shutdown.
 */
export interface PostgresAuthEntryDeps
  extends Pick<
      AuthServiceDeps,
      | "sendMagicLink"
      | "sendVerificationEmail"
      | "sendInvitation"
      | "sendOrganizationInvitation"
      | "onPublicInvitation"
      | "entitlements"
      | "billingPlugin"
    >,
    Pick<AuthEntryDeps, "transferAnonymousWorkspaces" | "now" | "workspaceData"> {
  /** Raw SQL over a pool or client the caller owns. */
  queryable?: Queryable;
  /** Better Auth's adapter over that same pool. Required with `queryable`. */
  database?: AuthDatabase;
}

/**
 * The pair, or a refusal.
 *
 * They are one connection and must arrive together: a generated adapter over a
 * different pool is a licence check that reads rows nobody wrote, and that failure
 * looks like "the licence is missing", not like a wiring mistake.
 */
function injectedPair(deps: PostgresAuthEntryDeps): {
  queryable: Queryable;
  database: AuthDatabase;
} | null {
  if (deps.queryable === undefined && deps.database === undefined) return null;
  if (deps.queryable === undefined || deps.database === undefined) {
    throw new Error(
      "queryable and database must be injected together: they are one connection, and a split pair reads rows nobody wrote",
    );
  }
  return { queryable: deps.queryable, database: deps.database };
}

export function createPostgresAuthEntry(
  env: AuthEnvironment,
  deps: PostgresAuthEntryDeps,
): AuthEntry {
  const pair = injectedPair(deps);
  if (pair !== null) {
    return createAuthEntry(env, {
      ...postgresRepositories(pair.queryable),
      account: postgresAccountStore(pair.queryable),
      ...(deps.workspaceData === undefined ? {} : { workspaceData: deps.workspaceData }),
      database: pair.database,
      sendMagicLink: deps.sendMagicLink,
      sendVerificationEmail: deps.sendVerificationEmail,
      sendOrganizationInvitation: deps.sendOrganizationInvitation,
      ...optionalDeps(deps),
    });
  }

  const problem = databaseUrlProblem(env.SUITE_AUTH_DATABASE_URL);
  if (problem !== null && authEnabled(env)) {
    throw new Error(`SUITE_AUTH_DATABASE_URL ${problem}`);
  }
  const opened = postgresDatabase({
    connectionString: env.SUITE_AUTH_DATABASE_URL?.trim() ?? "",
  });
  return createAuthEntry(env, {
    ...postgresRepositories(opened.queryable),
    account: postgresAccountStore(opened.queryable),
    ...(deps.workspaceData === undefined ? {} : { workspaceData: deps.workspaceData }),
    database: opened.database,
    sendMagicLink: deps.sendMagicLink,
    sendVerificationEmail: deps.sendVerificationEmail,
    sendOrganizationInvitation: deps.sendOrganizationInvitation,
    close: opened.close,
    ...optionalDeps(deps),
  });
}

/**
 * The boot path: migrate, then serve.
 *
 * `createPostgresAuthEntry` composes the service; this wraps it with the one thing
 * a deployment must do *before* it accepts a request — apply `sql/` — because a
 * handler that answers against a schema one file behind fails inside a sign-in,
 * where the symptom is a session that silently does not exist.
 *
 * Order matches `createAuthEntry`: switch, then URL, then pool, then migration, then
 * the service. A failed migration closes the pool it opened and rethrows, so a
 * half-started deployment exits instead of serving a partial schema.
 *
 * `SUITE_AUTH_MIGRATE=0` skips the migration step and leaves the pool to the
 * service; nothing else changes, so an operator whose migration is run out of band
 * is not forced to migrate twice.
 */
export async function createMigratedAuthEntry(
  env: AuthEnvironment,
  deps: PostgresAuthEntryDeps,
): Promise<AuthEntry> {
  if (!authEnabled(env)) {
    throw new Error("SUITE_AUTH_ENABLED is not 1");
  }
  const pair = injectedPair(deps);
  if (pair !== null) {
    await migrateAtBoot(pair.queryable);
    return createPostgresAuthEntry(env, deps);
  }

  const problem = databaseUrlProblem(env.SUITE_AUTH_DATABASE_URL);
  if (problem !== null) {
    throw new Error(`SUITE_AUTH_DATABASE_URL ${problem}`);
  }
  const opened = postgresDatabase({
    connectionString: env.SUITE_AUTH_DATABASE_URL?.trim() ?? "",
  });
  try {
    await migrateAtBoot(opened.queryable);
  } catch (error) {
    await opened.close();
    throw error;
  }

  // The same pool that was migrated, so the schema and the queries cannot disagree.
  const entry = createPostgresAuthEntry(env, {
    ...deps,
    queryable: opened.queryable,
    database: opened.database,
  });
  return {
    ...entry,
    close: async () => {
      await entry.close();
      await opened.close();
    },
  };
}
