/**
 * The one tagged error every boundary in this service answers with.
 *
 * It lives at the package root because both halves raise it: building the auth plugin
 * fails on an unreadable Stripe configuration, and reading an entitlement fails on a
 * request the caller can fix. One type, so an HTTP module maps it to one status.
 */
export type BillingFailure =
  | "invalid-config"
  | "invalid-request"
  | "not-configured"
  /** A fault nobody modelled: a driver that threw, a pool that vanished. */
  | "unexpected";

/** A failure a caller turns into a status code, with a token-free `code` for logs. */
export class BillingError extends Error {
  readonly code: BillingFailure;

  constructor(code: BillingFailure, message: string) {
    super(message);
    this.name = "BillingError";
    this.code = code;
  }
}

/** A thrown value, as this service's tagged failure. Anything unmodelled is `unexpected`. */
export function billingFailureOf(error: unknown): BillingError {
  if (error instanceof BillingError) return error;
  if (error instanceof Error)
    return new BillingError("unexpected", `${error.name}: ${error.message}`);
  return new BillingError("unexpected", String(error));
}
