import { err, ok, type Result } from "neverthrow";
import { BillingError } from "../errors.ts";

/**
 * The Stripe HTTP seam: two form posts, no SDK.
 *
 * A Checkout Session and a Billing Portal session are two `application/x-www-form-urlencoded`
 * posts; that does not justify a dependency bundled into a Lambda, and `fetch` is in the
 * runtime already. Everything that talks to Stripe goes through an injected `StripeFetch`,
 * so the tests can assert the exact form Stripe will parse — `line_items[0][price]` is a
 * name a plausible typo does not survive — without a network.
 */

/** One HTTP call, narrowed to the two things this service sends. */
export interface StripeHttpRequest {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface StripeHttpResponse {
  ok: boolean;
  status: number;
  /** The body as text: a Stripe error is not always JSON, and that must not throw. */
  text(): Promise<string>;
}

/** The seam tests replace. `globalFetch` is the production value. */
export type StripeFetch = (url: string, init: StripeHttpRequest) => Promise<StripeHttpResponse>;

/** The runtime's `fetch`, narrowed to this service's two calls. */
export const globalFetch: StripeFetch = (url, init) => fetch(url, init);

const STRIPE_API = "https://api.stripe.com/v1";
export const CHECKOUT_SESSIONS = "/checkout/sessions";
export const PORTAL_SESSIONS = "/billing_portal/sessions";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readJson(text: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Stripe's own `{error:{type,message}}`, flattened for one log line. */
function problemOf(body: string): string {
  const error = asRecord(readJson(body)?.error);
  const type = typeof error?.type === "string" ? error.type : null;
  const message = typeof error?.message === "string" ? error.message : null;
  if (type === null && message === null) return "Stripe answered without an error body";
  return [type, message].filter((part) => part !== null).join(": ");
}

/** The url on the answered object; Stripe sends `{url}` on both endpoints. */
function urlOf(body: string): string | null {
  const url = readJson(body)?.url;
  return typeof url === "string" && url.trim().length > 0 ? url.trim() : null;
}

/**
 * Stripe writes the mode into the key. A surface needs it, because a test-mode
 * session charges nothing and a page that implies otherwise is a lie. An
 * unrecognised prefix counts as `test`: under-promising is the safe direction.
 */
export function stripeMode(secretKey: string): "test" | "live" {
  return secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_") ? "live" : "test";
}

/**
 * POSTs one form to Stripe and returns the url from the answer.
 *
 * A refusal is a `Result` carrying `BillingError("stripe-error")` with Stripe's own
 * type in the message, which the route logs and the caller does not receive: a stable
 * code is what a surface can render, and an operator is who can fix a wrong key.
 */
export async function postStripeForm(
  fetch: StripeFetch,
  secretKey: string,
  path: string,
  form: URLSearchParams,
): Promise<Result<string, BillingError>> {
  const response = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const body = await response.text();
  if (!response.ok) {
    return err(
      new BillingError("stripe-error", `${path} answered ${response.status}: ${problemOf(body)}`),
    );
  }
  const url = urlOf(body);
  if (url === null) {
    return err(new BillingError("stripe-error", `${path} answered without a url`));
  }
  return ok(url);
}
