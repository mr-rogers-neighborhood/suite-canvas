import {
  type AuthDatabase,
  type AuthServiceDeps,
  createAuthService,
} from "../identity/betterAuth.js";
import { type EnrollmentRedemption, enrollmentRedemption } from "../invitations/enrollment.js";
import { databaseUrlProblem, postgresDatabase, type Queryable } from "../store/postgres.js";
import { postgresRepositories } from "../store/postgresRepositories.js";
import type { AuthEnvironment } from "../types.js";
import { authEnabled } from "./env.js";

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

export interface AuthEntryDeps
  extends Pick<
    AuthServiceDeps,
    "licences" | "memberships" | "sendMagicLink" | "sendInvitation" | "onPublicInvitation"
  > {
  /**
   * An adapter to use instead of building a pool: the memory adapter in tests, a
   * caller-owned pool in a deployment that wants to share one.
   */
  database?: AuthDatabase;
  /** Promise resolved on shutdown; absent when the caller owns the pool. */
  close?: () => Promise<void>;
  /** Slack for `onLinkAccount`. */
  transferAnonymousWorkspaces?: AuthServiceDeps["transferAnonymousWorkspaces"];
  now?: AuthServiceDeps["now"];
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
  close: () => Promise<void>;
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
    ...(deps.sendInvitation === undefined ? {} : { sendInvitation: deps.sendInvitation }),
    ...(deps.onPublicInvitation === undefined
      ? {}
      : { onPublicInvitation: deps.onPublicInvitation }),
    ...(deps.transferAnonymousWorkspaces === undefined
      ? {}
      : { transferAnonymousWorkspaces: deps.transferAnonymousWorkspaces }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });

  return {
    handler: (request) => instance.handler(request),
    redeem: enrollmentRedemption({ baseURL, handler: instance.handler }),
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
 * `queryable` exists for tests and for a deployment that already owns a pool — the
 * memory adapter satisfies it. Without it, the pool is built from
 * `SUITE_AUTH_DATABASE_URL` and closed by this function on shutdown.
 */
export interface PostgresAuthEntryDeps
  extends Pick<AuthServiceDeps, "sendMagicLink" | "sendInvitation" | "onPublicInvitation">,
    Pick<AuthEntryDeps, "transferAnonymousWorkspaces" | "now"> {
  /** An adapter/pool to share instead of building one. */
  queryable?: Queryable;
}

export function createPostgresAuthEntry(
  env: AuthEnvironment,
  deps: PostgresAuthEntryDeps,
): AuthEntry {
  if (deps.queryable !== undefined) {
    const repositories = postgresRepositories(deps.queryable);
    return createAuthEntry(env, {
      ...repositories,
      sendMagicLink: deps.sendMagicLink,
      ...(deps.sendInvitation === undefined ? {} : { sendInvitation: deps.sendInvitation }),
      ...(deps.onPublicInvitation === undefined
        ? {}
        : { onPublicInvitation: deps.onPublicInvitation }),
      database: deps.queryable as unknown as AuthDatabase,
      ...(deps.transferAnonymousWorkspaces === undefined
        ? {}
        : { transferAnonymousWorkspaces: deps.transferAnonymousWorkspaces }),
      ...(deps.now === undefined ? {} : { now: deps.now }),
    });
  }

  const problem = databaseUrlProblem(env.SUITE_AUTH_DATABASE_URL);
  if (problem !== null && authEnabled(env)) {
    throw new Error(`SUITE_AUTH_DATABASE_URL ${problem}`);
  }
  const opened = postgresDatabase({
    connectionString: env.SUITE_AUTH_DATABASE_URL?.trim() ?? "",
  });
  const repositories = postgresRepositories(opened.database as unknown as Queryable);
  return createAuthEntry(env, {
    ...repositories,
    sendMagicLink: deps.sendMagicLink,
    ...(deps.sendInvitation === undefined ? {} : { sendInvitation: deps.sendInvitation }),
    ...(deps.onPublicInvitation === undefined
      ? {}
      : { onPublicInvitation: deps.onPublicInvitation }),
    database: opened.database,
    close: opened.close,
    ...(deps.transferAnonymousWorkspaces === undefined
      ? {}
      : { transferAnonymousWorkspaces: deps.transferAnonymousWorkspaces }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
}
