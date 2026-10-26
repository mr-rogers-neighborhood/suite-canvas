import { type AuthDatabase, type AuthServiceDeps, createAuthService } from "./betterAuth.js";
import { authEnabled } from "./env.js";
import { databaseUrlProblem, postgresDatabase } from "./postgres.js";
import type { AuthEnvironment } from "./types.js";

/**
 * The one function a deployment calls
 * ([ADR-0067](../../../docs/decisions/0067-the-account-is-the-identity.md) §1).
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
  extends Pick<AuthServiceDeps, "licences" | "memberships" | "sendMagicLink"> {
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

  const instance = createAuthService({
    env,
    database,
    licences: deps.licences,
    memberships: deps.memberships,
    sendMagicLink: deps.sendMagicLink,
    ...(deps.transferAnonymousWorkspaces === undefined
      ? {}
      : { transferAnonymousWorkspaces: deps.transferAnonymousWorkspaces }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });

  return {
    handler: (request) => instance.handler(request),
    close: async () => {
      await deps.close?.();
      // Only close a pool this function opened.
      if (!injected) await owned?.close();
    },
  };
}
