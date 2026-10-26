/**
 * HTTP: the shell. One handler in, one JSON response out, plus the entry point that
 * composes a deployment and the environment/error vocabulary the wire contract is
 * written in.
 *
 * Everything in this folder may depend on the other folders; nothing in them depends on
 * this one except for the error codes, which live here because every code in them is
 * part of the HTTP contract.
 */
export {
  type AuthEntry,
  type AuthEntryDeps,
  createAuthEntry,
  createMigratedAuthEntry,
  createPostgresAuthEntry,
  type PostgresAuthEntryDeps,
} from "./entry.js";
export { authConfigProblems, authEnabled, authEnvironment, googleConfigured } from "./env.js";
export { AuthError, type AuthErrorCode, authErrorCodes, isAuthError } from "./errors.js";
export {
  type AuthHandlerDeps,
  type AuthHttpEvent,
  type AuthHttpResponse,
  createAuthHandler,
} from "./handler.js";
