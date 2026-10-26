/**
 * The one tagged error every boundary in this service answers with.
 *
 * It lives at the package root rather than inside `stripe/` because both halves raise
 * it: issuing a licence fails with `unknown-price` or `email-failed`, and opening the
 * store fails with `invalid-config`. One type, one place that maps it to a status —
 * `failureOf` in `handler/handler.ts` — so the webhook's retry contract cannot drift
 * between the two.
 */
export type BillingFailure =
  | "invalid-config"
  | "unknown-price"
  | "no-email"
  | "malformed-event"
  | "manual-request"
  | "signing-failed"
  | "email-failed"
  /** A Stripe API call from the checkout front door failed; see `stripe/checkout.ts`. */
  | "stripe-error"
  /**
   * A fault nobody modelled: a driver that threw, a store that vanished. It is a
   * member here because the webhook already reports it as `unexpected` in the body,
   * and a code the tests can see is better than a string built at the edge.
   */
  | "unexpected";

/** A failure the handler turns into a 500, with a token-free `code` for logs. */
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
