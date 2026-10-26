/**
 * Named refusals, so no caller has to match on a message.
 *
 * Every code here is part of the HTTP contract: the handler returns it verbatim
 * as `{ ok: false, error: code }`, and a test can assert the reason a request
 * was refused without pinning a sentence. A bare `throw new Error("...")` is
 * deliberately absent: strings are not a type, and the browser has to render
 * something precise for each case.
 */
export const authErrorCodes = [
  /** No session, owner key or share token — the request has no identity at all. */
  "unauthorized",
  /** A known principal whose role cannot perform this action. */
  "forbidden",
  /** The body did not validate. `field` names the offending member. */
  "invalid-request",
  /** The workspace is already owned by a different account; ownership never moves. */
  "workspace-already-claimed",
  /** No organization mirrors this workspace id. */
  "workspace-not-found",
  /** No invitation matches the presented token (it is compared by hash). */
  "invite-not-found",
  /** The invitation existed and was revoked by an owner or admin. */
  "invite-revoked",
  /** The invitation's expiry has passed. */
  "invite-expired",
  /** Every use is spent, including a single-use invitation that was already accepted. */
  "invite-exhausted",
  /** The account service is off or its secrets are missing. */
  "auth-not-configured",
  /** The licence refuses this principal a seat. `reason` carries the seat refusal. */
  "seat-refused",
  /** Too many attempts on a guessable route (a password, an invitation token). */
  "rate-limited",
  /** A malformed or ambiguous route (unknown path, unsupported method). */
  "not-found",
  "method-not-allowed",
] as const;

export type AuthErrorCode = (typeof authErrorCodes)[number];

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AuthError";
    this.code = code;
  }
}

export function isAuthError(value: unknown): value is AuthError {
  return value instanceof AuthError;
}
